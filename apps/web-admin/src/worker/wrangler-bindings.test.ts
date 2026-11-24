import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../wrangler.jsonc'), 'utf8');

/** JSONC to JSON: drops line and block comments outside strings, and trailing commas. */
function parseJsonc(text: string): Record<string, unknown> {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    const n = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1')) as Record<string, unknown>;
}

const config = parseJsonc(raw);
const envs = config.env as Record<string, Record<string, unknown>>;
const sections: Array<[string, Record<string, unknown>]> = [
  ['top level', config],
  ['staging', envs.staging!],
  ['production', envs.production!],
];

/** Keys that define a binding (or a resource that creates one). Everything else is plain config. */
const BINDING_KEYS = [
  'services',
  'assets',
  'd1_databases',
  'durable_objects',
  'kv_namespaces',
  'r2_buckets',
  'queues',
  'workflows',
  'ai',
  'vectorize',
  'hyperdrive',
  'analytics_engine_datasets',
  'browser',
  'send_email',
  'unsafe',
  'mtls_certificates',
  'dispatch_namespaces',
  'tail_consumers',
  'pipelines',
  'secrets_store_secrets',
  'version_metadata',
  'images',
  'vpc_services',
  'containers',
  'migrations',
];

describe('web-admin wrangler.jsonc bindings', () => {
  it.each(sections)('%s: only the PMS_OPS service binding and assets', (_name, section) => {
    for (const key of Object.keys(section)) {
      if (BINDING_KEYS.includes(key)) {
        expect(['services', 'assets'], `${key} is not an allowed binding`).toContain(key);
      }
    }
    const services = section.services as Array<Record<string, string>>;
    expect(services).toHaveLength(1);
    expect(services[0]!.binding).toBe('PMS_OPS');
    expect(services[0]!.entrypoint).toBe('OpsEntrypoint');
    const assets = section.assets as Record<string, unknown>;
    expect(assets.directory).toBe('./dist');
    expect(assets.not_found_handling).toBe('single-page-application');
  });

  it('staging and production point at the matching pms-core Worker', () => {
    const svc = (s: Record<string, unknown>) => (s.services as Array<{ service: string }>)[0]!.service;
    expect(svc(envs.staging!)).toBe('hospai-pms-core-staging');
    expect(svc(envs.production!)).toBe('hospai-pms-core');
  });

  it('is a Worker with static assets: no Pages config', () => {
    expect(config).not.toHaveProperty('pages_build_output_dir');
  });

  it('keeps the local-only dev operator flags out of every section, and out of the whole file', () => {
    for (const [, section] of sections) {
      const vars = (section.vars ?? {}) as Record<string, unknown>;
      expect(vars).not.toHaveProperty('HOSPAI_UNSAFE_LOCAL');
      expect(vars).not.toHaveProperty('OPS_ALLOW_DEV_OPERATOR');
    }
    // Comments may name the flags; no key or value may.
    expect(JSON.stringify(config)).not.toMatch(/HOSPAI_UNSAFE_LOCAL|OPS_ALLOW_DEV_OPERATOR/);
  });

  it('commits no Clerk secret: the secret key is never a var', () => {
    for (const [, section] of sections) {
      const vars = (section.vars ?? {}) as Record<string, string>;
      expect(vars).not.toHaveProperty('CLERK_SECRET_KEY');
      expect(vars).not.toHaveProperty('CLERK_JWT_KEY');
    }
    expect(raw).not.toMatch(/sk_(test|live)_[A-Za-z0-9]/);
  });

  it('staging trusts only its own workers.dev origin; top level and production stay fail-closed empty', () => {
    const vars = (s: Record<string, unknown>) => (s.vars ?? {}) as Record<string, string>;
    expect(vars(envs.staging!).CLERK_AUTHORIZED_PARTIES).toBe(
      'https://hospai-ops-console-staging.hospai.workers.dev',
    );
    expect(vars(config).CLERK_AUTHORIZED_PARTIES).toBe('');
    expect(vars(envs.production!).CLERK_AUTHORIZED_PARTIES).toBe('');
    expect(vars(config).CLERK_PUBLISHABLE_KEY).toBe('');
    expect(vars(envs.production!).CLERK_PUBLISHABLE_KEY).toBe('');
  });

  it('staging uses the ops Clerk instance, never the hotel instance', () => {
    const opsKey = ((envs.staging!.vars ?? {}) as Record<string, string>).CLERK_PUBLISHABLE_KEY!;
    expect(opsKey).toMatch(/^pk_test_[A-Za-z0-9]+$/);
    const here = dirname(fileURLToPath(import.meta.url));
    const pmsCore = readFileSync(join(here, '../../../pms-core/wrangler.jsonc'), 'utf8');
    expect(pmsCore).not.toContain(opsKey);
    // The staging deploy builds the SPA with the same ops key the Worker verifies against.
    const deploy = readFileSync(join(here, '../../../../.github/workflows/staging-deploy.yml'), 'utf8');
    expect(deploy).toContain(`VITE_CLERK_PUBLISHABLE_KEY: ${opsKey}`);
  });

  it('has no routes or custom domain yet (hostname is open question Q1)', () => {
    for (const [, section] of sections) {
      expect(section).not.toHaveProperty('routes');
      expect(section).not.toHaveProperty('route');
    }
  });
});
