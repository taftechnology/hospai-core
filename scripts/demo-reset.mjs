#!/usr/bin/env node
/**
 * Wipe local wrangler state, start pms-core, seed demo hotel, keep Worker attached.
 *
 *   pnpm demo:reset
 *   pnpm demo:reset --profile us
 *   node scripts/demo-reset.mjs [--profile india|us] [--port 8787]
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  let profile = 'india';
  let port = 8787;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--profile') {
      profile = argv[i + 1] ?? profile;
      i += 1;
    } else if (arg === '--port') {
      port = Number(argv[i + 1] ?? port);
      i += 1;
    } else if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length);
    } else if (arg.startsWith('--port=')) {
      port = Number(arg.slice('--port='.length));
    }
  }
  if (profile !== 'india' && profile !== 'us') {
    console.error(`Unknown profile: ${profile}`);
    process.exit(1);
  }
  if (!Number.isFinite(port) || port <= 0) {
    console.error(`Invalid port: ${port}`);
    process.exit(1);
  }
  return { profile, port };
}

async function assertWranglerStatePathSafe() {
  const stateDir = path.resolve(REPO_ROOT, 'apps/pms-core/.wrangler/state');
  const real = await fs.realpath(stateDir).catch(() => stateDir);
  const rootReal = await fs.realpath(REPO_ROOT);
  const rel = path.relative(rootReal, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    console.error('Refusing to delete wrangler state outside repo root');
    process.exit(1);
  }
  return stateDir;
}

async function portIsListening(port) {
  const url = `http://127.0.0.1:${port}/v1/orgs`;
  try {
    await fetch(url, { headers: { 'x-dev-actor': 'user_owner' } });
    return true;
  } catch {
    return false;
  }
}

async function waitForWorker(port, child, timeoutMs) {
  const url = `http://127.0.0.1:${port}/v1/orgs`;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode != null) {
      throw new Error('pms-core dev exited before becoming ready');
    }
    try {
      await fetch(url, { headers: { 'x-dev-actor': 'user_owner' } });
      return;
    } catch {
      await new Promise((r) => globalThis.setTimeout(r, 500));
    }
  }
  throw new Error('timeout waiting for pms-core');
}

function runDemoSeed(profile, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(REPO_ROOT, 'scripts/demo-seed.mjs'),
        '--profile',
        profile,
        '--base-url',
        `http://127.0.0.1:${port}`,
      ],
      { cwd: REPO_ROOT, stdio: 'inherit' },
    );
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`demo-seed exited ${code}`));
    });
  });
}

function killChild(child) {
  if (child && child.exitCode == null && !child.killed) {
    child.kill('SIGTERM');
  }
}

async function main() {
  const { profile, port } = parseArgs(process.argv.slice(2));

  if (await portIsListening(port)) {
    console.error(`pms-core is already running on ${port}. Stop it, then run pnpm demo:reset again.`);
    process.exit(1);
  }

  const stateDir = await assertWranglerStatePathSafe();
  await fs.rm(stateDir, { recursive: true, force: true });

  const child = spawn('pnpm', ['--filter', '@hospai/pms-core', 'dev'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env },
  });

  let exiting = false;
  const forwardAndExit = (signal) => {
    if (exiting) return;
    exiting = true;
    if (child.exitCode == null && !child.killed) {
      child.kill(signal);
    }
  };
  process.on('SIGINT', () => forwardAndExit('SIGINT'));
  process.on('SIGTERM', () => forwardAndExit('SIGTERM'));

  child.on('exit', (code) => {
    if (!exiting) process.exit(code ?? 0);
  });

  try {
    await waitForWorker(port, child, 120_000);
  } catch (err) {
    killChild(child);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  try {
    await runDemoSeed(profile, port);
  } catch {
    killChild(child);
    process.exit(1);
  }

  console.log(
    `Demo ready (${profile}) at http://127.0.0.1:${port} — Worker keeps running (Ctrl+C stops it).`,
  );

  await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? 0));
  }).then((code) => process.exit(code));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
