#!/usr/bin/env node
/**
 * Provision the local demo hotel against a running pms-core Worker.
 *
 *   pnpm demo:seed
 *   node scripts/demo-seed.mjs [--profile us|india] [--base-url http://127.0.0.1:8787] [--actor user_owner]
 *   [--currency INR] [--time-zone Asia/Kolkata]
 *
 * Profile sets org/property names and default currency/zone on first provision.
 * --currency and --time-zone override the profile when present.
 */

const ORG_ID = 'org_demo';
const PROPERTY_ID = 'prop_demo';
const PROFILES = {
  us: {
    orgName: 'Harborlight Hospitality',
    propertyName: 'The Meridian Seattle',
    timeZone: 'America/Los_Angeles',
    currency: 'USD',
  },
  india: {
    orgName: 'Amaltas Hospitality',
    propertyName: 'Amaltas Residency',
    timeZone: 'Asia/Kolkata',
    currency: 'INR',
  },
};

const WORKER_HINT = 'Start the Worker first: pnpm --filter @hospai/pms-core dev';

function parseArgs(argv) {
  let baseUrl = 'http://127.0.0.1:8787';
  let actor = 'user_owner';
  let profile = 'us';
  let currencyOverride;
  let timeZoneOverride;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-url') {
      baseUrl = argv[i + 1] ?? baseUrl;
      i += 1;
    } else if (arg === '--actor') {
      actor = argv[i + 1] ?? actor;
      i += 1;
    } else if (arg === '--profile') {
      profile = argv[i + 1] ?? profile;
      i += 1;
    } else if (arg === '--currency') {
      currencyOverride = argv[i + 1];
      i += 1;
    } else if (arg === '--time-zone') {
      timeZoneOverride = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--base-url=')) {
      baseUrl = arg.slice('--base-url='.length);
    } else if (arg.startsWith('--actor=')) {
      actor = arg.slice('--actor='.length);
    } else if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length);
    } else if (arg.startsWith('--currency=')) {
      currencyOverride = arg.slice('--currency='.length);
    } else if (arg.startsWith('--time-zone=')) {
      timeZoneOverride = arg.slice('--time-zone='.length);
    }
  }
  const preset = PROFILES[profile];
  if (!preset) fail(`Unknown profile: ${profile} (use us or india)`);
  const currency = currencyOverride ?? preset.currency;
  const timeZone = timeZoneOverride ?? preset.timeZone;
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    actor,
    orgName: preset.orgName,
    propertyName: preset.propertyName,
    currency,
    timeZone,
  };
}

function fail(message, detail) {
  if (detail) console.error(detail);
  console.error(message);
  process.exit(1);
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  const { baseUrl, actor, orgName, propertyName, currency, timeZone } = parseArgs(process.argv.slice(2));
  const headers = { 'content-type': 'application/json', 'x-dev-actor': actor };

  try {
    await fetch(`${baseUrl}/v1/orgs`, { headers: { 'x-dev-actor': actor } });
  } catch {
    fail(WORKER_HINT);
  }

  const orgRes = await fetch(`${baseUrl}/v1/orgs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ orgId: ORG_ID, name: orgName }),
  });
  const orgBody = await readJson(orgRes);
  if (orgRes.status !== 201 && !(orgRes.status === 409 && orgBody?.error === 'org_exists')) {
    fail(JSON.stringify(orgBody), `POST /v1/orgs failed (${orgRes.status})`);
  }

  const propRes = await fetch(`${baseUrl}/v1/orgs/${encodeURIComponent(ORG_ID)}/properties`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      propertyId: PROPERTY_ID,
      name: propertyName,
      timeZone,
      currency,
    }),
  });
  const propBody = await readJson(propRes);
  if (propRes.status === 409 && (propBody?.error === 'jurisdiction_conflict' || propBody?.error === 'tenant_not_active')) {
    fail(JSON.stringify(propBody), `POST /v1/orgs/${ORG_ID}/properties failed (${propRes.status})`);
  }
  if (propRes.status !== 201) {
    fail(JSON.stringify(propBody), `POST /v1/orgs/${ORG_ID}/properties failed (${propRes.status})`);
  }

  const getRes = await fetch(`${baseUrl}/v1/properties/${encodeURIComponent(PROPERTY_ID)}`, {
    headers: { 'x-dev-actor': actor },
  });
  const getBody = await readJson(getRes);
  if (getRes.status !== 200) {
    fail(JSON.stringify(getBody), `GET /v1/properties/${PROPERTY_ID} failed (${getRes.status})`);
  }
  if (getBody?.property?.name !== propertyName) {
    const patchRes = await fetch(`${baseUrl}/v1/properties/${encodeURIComponent(PROPERTY_ID)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: propertyName, idempotencyKey: 'demo-seed:v1:property-name' }),
    });
    const patchBody = await readJson(patchRes);
    if (patchRes.status !== 200) {
      fail(JSON.stringify(patchBody), `PATCH /v1/properties/${PROPERTY_ID} failed (${patchRes.status})`);
    }
  }

  const seedRes = await fetch(`${baseUrl}/v1/admin/demo-seed`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ orgId: ORG_ID, propertyId: PROPERTY_ID }),
  });
  const seedBody = await readJson(seedRes);
  if (seedRes.status !== 200) {
    fail(JSON.stringify(seedBody), `POST /v1/admin/demo-seed failed (${seedRes.status})`);
  }

  const board = seedBody.board ?? {};
  console.log(seedBody.propertyName ?? propertyName);
  console.log(`rooms: ${seedBody.rooms}`);
  console.log(`board: ${board.inHouse} in-house / ${board.arrivals} arrivals / ${board.departures} due out`);
  console.log(`today: ${seedBody.today}`);
  console.log(
    'Fresh wipe + seed: pnpm demo:reset (or stop pms-core, delete apps/pms-core/.wrangler/state, restart, pnpm demo:seed)',
  );
}

main().catch((err) => {
  if (err && (err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED')) {
    fail(WORKER_HINT);
  }
  fail(err instanceof Error ? err.message : String(err));
});
