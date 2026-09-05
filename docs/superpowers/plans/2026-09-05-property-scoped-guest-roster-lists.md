# Property-scoped guest and roster lists (R0.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-09-05)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit **S2** and **S7** — property-URL guest and roster reads return only rows associated with that property via OrgDO `guest_property` / `roster_property`; writes upsert association; Worker book success links `guestRef` to the booking property.

**Architecture:** Characterization tests land **first** and must fail on current `main`. OrgDO **v8** adds association tables (`ORG_SCHEMA_HEAD` 7 → 8). List/search **filter SQL to associated ids first, then decrypt the page** (P11 — no decrypt-then-filter). GET/batch unassociated → **404** / `guest_not_found`. Book linkage is **Worker → OrgDO only** (PropertyDO never calls OrgDO). **No new HTTP routes. No new catalog commands.**

**Tech Stack:** Cloudflare Workers + OrgDO (`apps/pms-core/src/org-do.ts`), `@hospai/do-runtime` org migrations, vitest + `cloudflare:test` HTTP route specs, `demo-seed.ts`, `v1-dispatch.ts`.

**Spec:** `docs/superpowers/specs/2026-09-05-property-scoped-guest-roster-lists-design.md` (Status: Approved — normative).

---

## Global Constraints

- **`COMMAND_CATALOG` length:** **89** — unchanged this vertical.
- **`V1_HTTP_ROUTE_AUDIT`:** length **144**; `[143].id === 'get_city_ledger_statement'` — unchanged.
- **`PROPERTY_SCHEMA_HEAD`:** **34** — unchanged.
- **`ORG_SCHEMA_HEAD`:** **7 → 8** (v8 `guest_property` + `roster_property`).
- **`NIGHT_AUDIT_STEPS`:** length **8**; `[3] === 'AUTO_TRANSFER'` — unchanged.
- **Tenancy:** keep property URLs; no org-wide CRM/roster routes; `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)` on touched handlers.
- **PropertyDO boundary:** PropertyDO **never** calls OrgDO for association.
- **No backfill migration** — tests use fresh two-property fixtures.
- **No `await` inside `transactionSync`** — association upserts are sync SQL inside existing blocks.
- **pms-core shards:** never put `--` before `--shard` (8 shards); full local suite via `pnpm test:local` on last task.

---

## Frozen heads (must not move except ORG)

| Pin | Value | This vertical |
|---|---|---|
| `COMMAND_CATALOG` length | **89** | **89** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` | **144** — unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — unchanged |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |
| `ORG_SCHEMA_HEAD` | **7** today | **8** after Task 2 |

Tree verified 2026-09-05 per spec. No catalog/route/property pin updates in any task.

---

## Locked behaviour (do not re-litigate)

| Lock | Decision |
|---|---|
| **Routes** | **No** new HTTP routes. **No** org-wide CRM/roster list routes. |
| **Catalog** | **No** new `COMMAND_CATALOG` ids. Association = private OrgDO SQL + Worker-callable `upsertGuestPropertyAssociation`. |
| **S2 reads** | `listGuests`, `searchGuests`, `readGuest`, `readGuests` filter by `guest_property.property_id = ?` before decrypt. |
| **S2 writes** | `tryCreateGuest`, `tryUpdateGuest` upsert `guest_property`; Worker `handlePostReservations` + `demo-seed.ts` call `upsertGuestPropertyAssociation`. |
| **S7 reads** | `listRoster`, `readRoster` filter by `roster_property.property_id = ?` before decrypt. |
| **S7 writes** | `tryCreateRoster` upserts `roster_property` only on add — PATCH/status/exit do not link. |
| **GET / batch** | Unassociated guest → **404** `not_found` on GET; batch `{ ok: false, guestId, error: 'guest_not_found' }`. Unlinked staff → **404** on GET; omitted from list. |
| **Search (P11)** | Blind-index hits → **intersect** with `guest_property` **before** sort/page/decrypt. **Forbidden:** decrypt-then-filter. |
| **T3 test shape** | Create guest at hotel **A**, book at hotel **B** with that `guestRef`. **Before book:** absent from B list. **After book:** present at B; still present at A. Do **not** use “create at B then book at B” for T3 — create already links B. |
| **Backfill** | **None.** |

**Out of scope:** org-wide CRM route, PropertyDO → OrgDO, SPA changes, Playwright, P11 parallel decrypt, R0.3/R0.5, tags/VIP/merge.

---

## Sequencing gate

```
Task 1 (red tests) → Task 2 (OrgDO v8 schema) → Task 3 (OrgDO production) → Task 4 (Worker + demo-seed + resolvePropertyContext) → Task 5 (full CI + R0.4 tick + CRM amend)
```

**TDD:** Task 1 commits tests-only (red on `main` for T1–T5, T7). Tasks 2–4 make focused specs green. Task 5 runs full CI `checks` job + `pnpm test:local`.

---

## Task 1 — Failing characterization tests (tests-only commit)

**Files:**
- Modify: `apps/pms-core/test/guests-routes.spec.ts`
- Modify: `apps/pms-core/test/roster-routes.spec.ts`

**Interfaces:** none (tests only). Reuse existing HTTP helpers (`postOrg`, `postProperty`, `postGuest`, `getGuests`, `postGuestsSearch`, `getGuest`, `postReservation`, `postRoster`, `getRosterList`, `getRosterOne`) already in those files; add `postGuestsBatch` (copy pattern from `front-desk-reads.spec.ts` ~63–71).

### Step 1 — Guest helper: `provisionTwoHotels` + `postGuestsBatch`

Add after `provisionHotel` in `guests-routes.spec.ts`:

```ts
async function provisionTwoHotels(actor: string) {
  const orgId = `org_guests2_${crypto.randomUUID()}`;
  const propertyA = `prop_guests_a_${crypto.randomUUID()}`;
  const propertyB = `prop_guests_b_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Two Hotel Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyA, actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyB, actor)).status).toBe(201);

  const roomTypeResA = await postRoomType(propertyA, actor);
  expect(roomTypeResA.status).toBe(201);
  const roomTypeDataA = (await roomTypeResA.json()) as { fromDate: string };

  const roomTypeResB = await postRoomType(propertyB, actor);
  expect(roomTypeResB.status).toBe(201);

  const resolvedA = await resolvePropertyFromRegistry(env, propertyA);
  const resolvedB = await resolvePropertyFromRegistry(env, propertyB);
  if (resolvedA) {
    await resolvedA.stub.flushOutbox();
    await seedBarRatesForHorizon(resolvedA.stub, 'rt_king', roomTypeDataA.fromDate);
  }
  if (resolvedB) {
    await resolvedB.stub.flushOutbox();
    await seedBarRatesForHorizon(resolvedB.stub, 'rt_king', roomTypeDataA.fromDate);
  }

  return { orgId, propertyA, propertyB, actor, arrival: roomTypeDataA.fromDate };
}

async function postGuestsBatch(propertyId: string, actor: string, refs: string[]) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ refs }),
    }),
    env,
  );
}
```

### Step 2 — T1/T2: two-property guest isolation (`guests-routes.spec.ts`)

Add new `describe('property-scoped guest lists (S2)')` at end of file:

```ts
describe('property-scoped guest lists (S2)', () => {
  it('T1: guest created at B only — absent from A list/search/GET/batch', async () => {
    const actor = 'user_guests_s2_t1';
    const { propertyA, propertyB } = await provisionTwoHotels(actor);
    const guestId = 'guest_b_only';
    await postGuest(propertyB, actor, {
      guestId,
      displayName: 'Hotel B Guest',
      email: 'bonly@ex.com',
    });

    const listA = (await (await getGuests(propertyA, actor)).json()) as {
      items: Array<{ guestId: string; profile?: { displayName: string } }>;
    };
    expect(listA.items.map((g) => g.guestId)).not.toContain(guestId);
    expect(listA.items.every((g) => g.guestId !== guestId)).toBe(true);

    const searchA = (await (
      await postGuestsSearch(propertyA, actor, { q: 'bonly@ex.com' })
    ).json()) as { items: Array<{ guestId: string }> };
    expect(searchA.items).toEqual([]);

    expect((await getGuest(propertyA, actor, guestId)).status).toBe(404);
    expect(await (await getGuest(propertyA, actor, guestId)).json()).toMatchObject({
      ok: false,
      error: GUEST_NOT_FOUND,
    });

    const batchA = (await (await postGuestsBatch(propertyA, actor, [guestId])).json()) as {
      ok: true;
      guests: Record<string, { ok: boolean; error?: string; profile?: unknown }>;
    };
    expect(batchA.guests[guestId]).toMatchObject({ ok: false, error: GUEST_NOT_FOUND });
    expect(batchA.guests[guestId]?.profile).toBeUndefined();
  });

  it('T2: same guest — present at B list/search/GET', async () => {
    const actor = 'user_guests_s2_t2';
    const { propertyB } = await provisionTwoHotels(actor);
    const guestId = 'guest_b_present';
    await postGuest(propertyB, actor, {
      guestId,
      displayName: 'Present At B',
      email: 'present@ex.com',
    });

    const listB = (await (await getGuests(propertyB, actor)).json()) as {
      items: Array<{ guestId: string }>;
    };
    expect(listB.items.map((g) => g.guestId)).toContain(guestId);

    const searchB = (await (
      await postGuestsSearch(propertyB, actor, { q: 'present@ex.com' })
    ).json()) as { items: Array<{ guestId: string }> };
    expect(searchB.items.map((g) => g.guestId)).toContain(guestId);

    expect((await getGuest(propertyB, actor, guestId)).status).toBe(200);
  });
});
```

**Red on `main`:** T1 list/search at A includes org-wide guest; GET/batch return profile.

### Step 3 — T3: create at A, book at B (`guests-routes.spec.ts`)

Same describe block:

```ts
  it('T3: create at A then book at B — absent from B before book; linked at both after', async () => {
    const actor = 'user_guests_s2_t3';
    const { propertyA, propertyB, arrival } = await provisionTwoHotels(actor);
    const departure = addDays(arrival, 2);
    const guestId = 'guest_cross_book';

    await postGuest(propertyA, actor, {
      guestId,
      displayName: 'Cross Property Guest',
      email: 'cross@ex.com',
    });

    const listBBefore = (await (await getGuests(propertyB, actor)).json()) as {
      items: Array<{ guestId: string }>;
    };
    expect(listBBefore.items.map((g) => g.guestId)).not.toContain(guestId);

    const bookRes = await postReservation(
      propertyB,
      actor,
      'res_cross_book',
      arrival,
      departure,
      guestId,
    );
    expect(bookRes.status).toBe(201);

    const listA = (await (await getGuests(propertyA, actor)).json()) as {
      items: Array<{ guestId: string }>;
    };
    expect(listA.items.map((g) => g.guestId)).toContain(guestId);

    const listBAfter = (await (await getGuests(propertyB, actor)).json()) as {
      items: Array<{ guestId: string }>;
    };
    expect(listBAfter.items.map((g) => g.guestId)).toContain(guestId);
  });
```

**Red on `main`:** `listBBefore` includes guest (org-wide list at B before book upsert).

### Step 4 — T7: blind-index search isolation (`guests-routes.spec.ts`)

```ts
  it('T7: search q matching guest at B returns empty at A', async () => {
    const actor = 'user_guests_s2_t7';
    const { propertyA, propertyB } = await provisionTwoHotels(actor);
    await postGuest(propertyB, actor, {
      guestId: 'guest_search_b',
      displayName: 'Searchable B',
      email: 'searchable-b@ex.com',
    });

    const hitB = (await (
      await postGuestsSearch(propertyB, actor, { q: 'searchable-b@ex.com' })
    ).json()) as { items: Array<{ guestId: string }> };
    expect(hitB.items.map((g) => g.guestId)).toContain('guest_search_b');

    const hitA = (await (
      await postGuestsSearch(propertyA, actor, { q: 'searchable-b@ex.com' })
    ).json()) as { items: unknown[] };
    expect(hitA.items).toEqual([]);
  });
```

**Red on `main`:** search at A returns cross-property hit.

### Step 5 — Roster helper: `provisionTwoHotels` (`roster-routes.spec.ts`)

Add after `provisionHotel`:

```ts
async function provisionTwoHotels(actor: string) {
  const orgId = `org_roster2_${crypto.randomUUID()}`;
  const propertyA = `prop_roster_a_${crypto.randomUUID()}`;
  const propertyB = `prop_roster_b_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Two Roster Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyA, actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyB, actor)).status).toBe(201);
  return { orgId, propertyA, propertyB, actor };
}
```

### Step 6 — T4/T5: two-property roster isolation (`roster-routes.spec.ts`)

Add new `describe('property-scoped roster lists (S7)')`:

```ts
describe('property-scoped roster lists (S7)', () => {
  it('T4: staff added at B only — absent from A list/GET', async () => {
    const actor = 'user_roster_s7_t4';
    const { propertyA, propertyB } = await provisionTwoHotels(actor);

    const created = (await (
      await postRoster(propertyB, actor, { displayName: 'Staff B', kinds: ['housekeeper'] })
    ).json()) as { ok: true; staffId: string };
    expect(created.ok).toBe(true);
    const { staffId } = created;

    const listA = (await (await getRosterList(propertyA, actor)).json()) as {
      ok: true;
      staff: Array<{ staffId: string; profile?: { displayName: string } }>;
    };
    expect(listA.staff.map((s) => s.staffId)).not.toContain(staffId);

    expect((await getRosterOne(propertyA, actor, staffId)).status).toBe(404);
  });

  it('T5: same staff — present at B list/GET', async () => {
    const actor = 'user_roster_s7_t5';
    const { propertyB } = await provisionTwoHotels(actor);

    const created = (await (
      await postRoster(propertyB, actor, { displayName: 'Staff Present B', kinds: ['housekeeper'] })
    ).json()) as { ok: true; staffId: string };
    const { staffId } = created;

    const listB = (await (await getRosterList(propertyB, actor)).json()) as {
      ok: true;
      staff: Array<{ staffId: string }>;
    };
    expect(listB.staff.map((s) => s.staffId)).toContain(staffId);

    expect((await getRosterOne(propertyB, actor, staffId)).status).toBe(200);
  });
});
```

**Red on `main`:** T4 list at A includes org-wide staff; GET at A returns 200 with decrypted name.

### Step 7 — Run vitest; confirm red

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/guests-routes.spec.ts \
  test/roster-routes.spec.ts
```

- [ ] T1–T5, T7 fail on current `main` for the asserted behaviour
- [ ] Existing single-property guest/roster tests (**T6 regression**) still pass
- [ ] Do **not** change production code in this task

### Step 8 — Commit (tests only)

```bash
git add \
  apps/pms-core/test/guests-routes.spec.ts \
  apps/pms-core/test/roster-routes.spec.ts
git commit -m "$(cat <<'EOF'
test(pms-core): property-scoped guest/roster list characterization (red)

Two-property same-org isolation for S2/S7 list, search, GET, batch, and
cross-property book linkage. Tests fail on main org-wide OrgDO reads.
EOF
)"
```

---

## Task 2 — OrgDO v8 migration + pin + generate:ddl

**Files:**
- Modify: `packages/do-runtime/src/org-migrations.ts`
- Modify: `packages/do-runtime/src/migrate.test.ts`
- Modify: generated org DDL (via `pnpm generate:ddl`)

**Interfaces:**
- Produces: OrgDO schema v8 tables `guest_property`, `roster_property` available after migrate.

### Step 1 — Add v8 migration statements

In `packages/do-runtime/src/org-migrations.ts`, after v7 block, add constant and migration entry:

```ts
const ORG_PROPERTY_PII_ASSOCIATION_STATEMENTS = [
  `CREATE TABLE guest_property (
  guest_id      TEXT NOT NULL,
  property_id   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (guest_id, property_id),
  FOREIGN KEY (guest_id) REFERENCES guest(guest_id)
);`,
  `CREATE INDEX guest_property_by_property
  ON guest_property (property_id, guest_id);`,
  `CREATE TABLE roster_property (
  staff_id      TEXT NOT NULL,
  property_id   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (staff_id, property_id),
  FOREIGN KEY (staff_id) REFERENCES roster(staff_id)
);`,
  `CREATE INDEX roster_property_by_property
  ON roster_property (property_id, staff_id);`,
] as const;
```

Append to `ORG_MIGRATIONS`:

```ts
  {
    version: 8,
    name: '0008_property_pii_association',
    statements: ORG_PROPERTY_PII_ASSOCIATION_STATEMENTS,
  },
```

- [ ] No `property_id` on `guest` or `roster` parent tables
- [ ] **No backfill** statements in migration

### Step 2 — Bump pin

In `packages/do-runtime/src/migrate.test.ts`:

```ts
expect(ORG_SCHEMA_HEAD).toBe(8);
```

(was `7`)

### Step 3 — Regenerate DDL

```bash
pnpm generate:ddl
pnpm check:ddl
```

- [ ] Generated org DDL includes v8 `guest_property` and `roster_property`
- [ ] `PROPERTY_SCHEMA_HEAD` assertion still **34**

### Step 4 — Focused migrate test

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head"
```

Expected: PASS with `ORG_SCHEMA_HEAD === 8`.

### Step 5 — Commit

```bash
git add \
  packages/do-runtime/src/org-migrations.ts \
  packages/do-runtime/src/migrate.test.ts \
  migrations/do-org/
git commit -m "$(cat <<'EOF'
feat(do-runtime): OrgDO v8 guest_property and roster_property tables

Add property PII association linkage tables; bump ORG_SCHEMA_HEAD to 8.
EOF
)"
```

---

## Task 3 — OrgDO association helpers + read filters + write upserts + book RPC

**Files:**
- Modify: `apps/pms-core/src/org-do.ts` (~1443, ~1531, ~1713, ~2059, ~2103, ~2153, ~2186, ~2229, ~2301)

**Interfaces:**

```ts
// private sync helpers (org-do.ts)
private upsertGuestPropertySync(guestId: string, propertyId: string, now: number): void;
private upsertRosterPropertySync(staffId: string, propertyId: string, now: number): void;
private isGuestLinkedToPropertySync(guestId: string, propertyId: string): boolean;
private isStaffLinkedToPropertySync(staffId: string, propertyId: string): boolean;

async upsertGuestPropertyAssociation(
  actor: ActorContext,
  propertyId: string,
  guestId: string,
): Promise<
  | { ok: true }
  | { ok: false; error: typeof GUEST_NOT_FOUND }
  | /* gate errors: FORBIDDEN, NOT_MEMBER, ENTITLEMENT_*, ORG_ID_UNSET */
>;
```

### Step 1 — Sync helpers

Add near other private sync helpers in `org-do.ts`:

```ts
private upsertGuestPropertySync(guestId: string, propertyId: string, now: number): void {
  this.ctx.storage.sql.exec(
    `INSERT INTO guest_property (guest_id, property_id, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT (guest_id, property_id) DO NOTHING`,
    guestId,
    propertyId,
    now,
  );
}

private upsertRosterPropertySync(staffId: string, propertyId: string, now: number): void {
  this.ctx.storage.sql.exec(
    `INSERT INTO roster_property (staff_id, property_id, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT (staff_id, property_id) DO NOTHING`,
    staffId,
    propertyId,
    now,
  );
}

private isGuestLinkedToPropertySync(guestId: string, propertyId: string): boolean {
  const rows = this.ctx.storage.sql
    .exec(
      `SELECT 1 AS one FROM guest_property WHERE guest_id = ? AND property_id = ? LIMIT 1`,
      guestId,
      propertyId,
    )
    .toArray();
  return rows.length > 0;
}

private isStaffLinkedToPropertySync(staffId: string, propertyId: string): boolean {
  const rows = this.ctx.storage.sql
    .exec(
      `SELECT 1 AS one FROM roster_property WHERE staff_id = ? AND property_id = ? LIMIT 1`,
      staffId,
      propertyId,
    )
    .toArray();
  return rows.length > 0;
}
```

- [ ] **No `await`** in these helpers

### Step 2 — Write upserts: `tryCreateGuest`, `tryUpdateGuest`, `tryCreateRoster`

In `tryCreateGuest` `transactionSync` block, after `replaceGuestBlindIndexSync`:

```ts
this.upsertGuestPropertySync(input.guestId, propertyId, now);
```

In `tryUpdateGuest` `transactionSync` block, after profile update + index replace:

```ts
this.upsertGuestPropertySync(input.guestId, propertyId, now);
```

In `tryCreateRoster` `transactionSync` block, after roster insert + kinds:

```ts
this.upsertRosterPropertySync(staffId, propertyId, now);
```

### Step 3 — `upsertGuestPropertyAssociation` RPC

Add public method (after guest write methods):

```ts
async upsertGuestPropertyAssociation(
  actor: ActorContext,
  propertyId: string,
  guestId: string,
): Promise<
  | { ok: true }
  | { ok: false; error: typeof GUEST_NOT_FOUND }
  | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
  | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER | typeof SCOPE_MISMATCH }
  | { ok: false; error: typeof ORG_ID_UNSET }
> {
  this.assertRpcAvailable();
  this.lanes.touchInteractive();
  const orgId = this.getOrgIdSync();
  if (!orgId) return { ok: false, error: ORG_ID_UNSET };

  const resDenied = await this.gatePermission(actor, propertyId, 'reservations:write');
  if (resDenied) {
    const guestDenied = await this.gatePermission(actor, propertyId, 'guests:write');
    if (guestDenied) return guestDenied;
  }

  const denied = await this.gateCoreEntitlement(orgId);
  if (denied) return denied;

  const guest = this.ctx.storage.sql
    .exec(`SELECT erased_at FROM guest WHERE guest_id = ?`, guestId)
    .toArray() as Array<{ erased_at: number | null }>;
  if (!guest[0] || guest[0].erased_at != null) {
    return { ok: false, error: GUEST_NOT_FOUND };
  }

  this.ctx.storage.transactionSync(() => {
    this.upsertGuestPropertySync(guestId, propertyId, Date.now());
  });
  return { ok: true };
}
```

**Gate logic:** succeed if **either** `reservations:write` **or** `guests:write` passes (book actor has `reservations:write`).

### Step 4 — `listGuests` property filter

Replace org-wide `FROM guest` query (~2254+) with join (preserve cursor semantics):

```sql
SELECT g.guest_id, g.created_at
FROM guest g
INNER JOIN guest_property gp ON gp.guest_id = g.guest_id AND gp.property_id = ?
WHERE g.erased_at IS NULL
  [AND (g.created_at, g.guest_id) < (?, ?)  -- when cursor]
ORDER BY g.created_at DESC, g.guest_id DESC
LIMIT ?
```

Then decrypt page sequentially (unchanged P11 loop).

### Step 5 — `searchGuests` intersect before decrypt

After building `hitIds` from blind index (~2328–2339), filter:

```ts
const associatedIds: string[] = [];
for (const guestId of hitIds) {
  if (this.isGuestLinkedToPropertySync(guestId, propertyId)) {
    associatedIds.push(guestId);
  }
}
```

Use `associatedIds` (not raw `hitIds`) for `liveIds` / sort / page / decrypt loop.

### Step 6 — `readGuest` + `readGuests` association gate

In `readGuest`, after entitlement gate, before `readGuestEntry`:

```ts
if (!this.isGuestLinkedToPropertySync(guestId, propertyId)) {
  return { ok: false, error: GUEST_NOT_FOUND };
}
```

In `readGuests`, for each id:

```ts
if (!this.isGuestLinkedToPropertySync(guestId, propertyId)) {
  guests[guestId] = { ok: false, guestId, error: GUEST_NOT_FOUND };
  continue;
}
guests[guestId] = await this.readGuestEntry(guestId);
```

### Step 7 — `listRoster` + `readRoster` property filter

Replace `listRoster` org-wide query (~2129–2132):

```sql
SELECT r.staff_id, r.pii_key_id, r.profile_cipher, r.profile_iv, r.status, r.exited_at
FROM roster r
INNER JOIN roster_property rp ON rp.staff_id = r.staff_id AND rp.property_id = ?
ORDER BY r.staff_id
```

In `readRoster`, after gates, before `loadRosterRow`:

```ts
if (!this.isStaffLinkedToPropertySync(staffId, propertyId)) {
  return { ok: false, error: STAFF_NOT_FOUND };
}
```

### Step 8 — Focused test run (guest create/book upsert only — T3 still red until Task 4)

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/guests-routes.spec.ts \
  test/roster-routes.spec.ts
```

- [ ] T1, T2, T4, T5, T7 green after Task 3 (create/update/roster-add upserts)
- [ ] T3 may still fail until Task 4 book upsert — expected mid-vertical

```bash
pnpm typecheck
```

### Step 9 — Commit

```bash
git add apps/pms-core/src/org-do.ts
git commit -m "$(cat <<'EOF'
fix(pms-core): property-scope OrgDO guest and roster reads

Add guest_property/roster_property helpers; filter list/search/GET/batch;
upsert on create/update/roster-add; upsertGuestPropertyAssociation RPC.
EOF
)"
```

---

## Task 4 — Worker book linkage + demo-seed + resolvePropertyContext threading

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` (~1962, ~2039, ~2072, ~2293, ~3477, ~6939, ~6985)
- Modify: `apps/pms-core/src/demo-seed.ts` (~219+)

**Interfaces:**
- Consumes: `org.upsertGuestPropertyAssociation(actor, propertyId, guestId)` from Task 3
- Produces: book success path links guest to booking property; guest/roster read handlers pass `ctx.tenantProperty`

### Step 1 — `handlePostReservations` book upsert

In `handlePostReservations`, after successful `result.ok` (~2425) and **before** `return json(result, 201)`:

```ts
  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const link = await org.upsertGuestPropertyAssociation(actor, propertyId, body.guestRef);
    if (!link.ok && link.error !== GUEST_NOT_FOUND) {
      logError(ctx.observability, {
        msg: 'guest_property.link_failed',
        propertyId,
        guestRef: body.guestRef,
        error: link.error,
      });
    }
  } catch (e) {
    if (isOrgDoTransportFailure(e)) {
      logError(ctx.observability, {
        msg: 'guest_property.link_transport_failed',
        propertyId,
        guestRef: body.guestRef,
      });
    } else {
      throw e;
    }
  }

  return json(result, 201);
```

- [ ] Call only on `result.ok` — gateGuestRef already ran on PropertyDO
- [ ] **Forbidden:** PropertyDO `tryCreateReservation` calling OrgDO

Ensure `GUEST_NOT_FOUND` is imported in `v1-dispatch.ts` if not already.

### Step 2 — `demo-seed.ts` reservation loop

After successful `tryCreateReservation` (~219–226), add:

```ts
      const link = await org.upsertGuestPropertyAssociation(
        input.actor,
        input.propertyId,
        stay.guestId,
      );
      if (!link.ok) {
        throw new Error(`demo_seed_guest_link:${stay.reservationId}:${link.error}`);
      }
```

Use existing `org` stub already in scope from guest seed loop above.

### Step 3 — Thread `ctx.tenantProperty` on guest/roster read handlers

Replace two-arg calls with three-arg on these handlers only:

| Handler | Approx line |
|---|---|
| `handleGetGuest` | ~1967 |
| `handleGetRoster` | ~2043 area |
| `handleGetRosterOne` | ~2077 area |
| `handlePostGuestsBatch` | ~3489 pattern exists elsewhere — match |
| `handleGetGuests` | ~6957 |
| `handlePostGuestsSearch` | ~6993 area |
| `handlePostReservations` | ~2324 |

Pattern:

```ts
const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
```

- [ ] Do not skip `assertTenantActive` (helper handles via prefetch)
- [ ] Do not thread unrelated handlers in this vertical

### Step 4 — Focused test run (all slice tests green)

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/guests-routes.spec.ts \
  test/roster-routes.spec.ts
```

- [ ] T1–T5, T7 green
- [ ] T6: existing single-property tests in both files still green

```bash
pnpm --filter @hospai/pms-core exec vitest run test/demo-seed.spec.ts
pnpm typecheck
```

### Step 5 — Commit

```bash
git add \
  apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/src/demo-seed.ts
git commit -m "$(cat <<'EOF'
fix(pms-core): book links guest_property; thread tenantProperty on reads

Worker post_reservations and demo-seed call upsertGuestPropertyAssociation;
guest/roster read handlers pass ctx.tenantProperty to resolvePropertyContext.
EOF
)"
```

---

## Task 5 — Full CI + tick R0.4 + CRM spec amend

**Files:**
- Modify: `docs/roadmap.md` (~180)
- Modify: `docs/superpowers/specs/2026-08-13-guest-crm-directory-design.md` (~9 **Amends:** line)

### Step 1 — Named vitest files (slice)

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/guests-routes.spec.ts \
  test/roster-routes.spec.ts
```

- [ ] Green

### Step 2 — Full CI `checks` job sequence (copy in order)

```bash
pnpm build
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:class-resolution
pnpm check:ui-kit-adoption
pnpm check:spa-page-chrome
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
node scripts/module-manifests-check.mjs --self-test
node scripts/purge-check.mjs --self-test
node scripts/forbidden-body-check.mjs --self-test
node scripts/do-transport-guards-check.mjs --self-test
node scripts/web-pms-colors-check.mjs --self-test
node scripts/class-resolution-check.mjs --self-test
node scripts/ui-kit-adoption-check.mjs --self-test
node scripts/spa-page-chrome-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm test:coverage
pnpm lint
```

- [ ] All green

### Step 3 — pms-core shards (full local suite)

```bash
pnpm test:local
```

**Never put `--` before `--shard`.**

Alternative — match CI matrix exactly:

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/reservations-ledger.property.spec.ts test/reservations-ledger-virtual.property.spec.ts
```

- [ ] All shards green

### Step 4 — Pin freeze confirmation

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
```

- [ ] `COMMAND_CATALOG` length **89**
- [ ] `V1_HTTP_ROUTE_AUDIT` length **144**, last id `get_city_ledger_statement`
- [ ] `PROPERTY_SCHEMA_HEAD === 34`
- [ ] `ORG_SCHEMA_HEAD === 8`
- [ ] `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`

### Step 5 — Tick roadmap R0.4

In `docs/roadmap.md` ~180, change:

```markdown
- [ ] **R0.4** Audit V4 — S2, S7. property-scoped guest and roster lists (two-property test).
```

to:

```markdown
- [x] **R0.4** Audit V4 — S2, S7. property-scoped guest and roster lists (two-property test).
```

### Step 6 — CRM spec one-sentence amend

Append to `docs/superpowers/specs/2026-08-13-guest-crm-directory-design.md` line ~9 **Amends:** paragraph:

> **Amended by [2026-09-05 property-scoped lists](./2026-09-05-property-scoped-guest-roster-lists-design.md):** `GET …/guests` and `POST …/guests-search` on a property URL return only guests associated with that property via `guest_property`, not the org-wide vault.

### Step 7 — Commit

```bash
git add \
  docs/roadmap.md \
  docs/superpowers/specs/2026-08-13-guest-crm-directory-design.md
git commit -m "$(cat <<'EOF'
chore: tick R0.4 after property-scoped guest/roster lists

Full CI checks and pms-core shards green; amend CRM spec list scope; S2/S7 closed.
EOF
)"
```

---

## Test matrix (spec §4 — mapped to tasks)

| # | File | Task | Expect on fixed code | Red on `main`? |
|---|---|---|---|---|
| T1 | `guests-routes.spec.ts` | 1 | Guest at B only → absent from A list/search/GET/batch | Yes |
| T2 | `guests-routes.spec.ts` | 1 | Same guest present at B | No (sanity; may pass on main) |
| T3 | `guests-routes.spec.ts` | 1 | Create A, absent B before book, both after book | Yes (`listBBefore`) |
| T4 | `roster-routes.spec.ts` | 1 | Staff at B only → absent from A list/GET | Yes |
| T5 | `roster-routes.spec.ts` | 1 | Same staff present at B | No (sanity) |
| T6 | both | 1–4 | Existing single-property cases green | No (regression) |
| T7 | `guests-routes.spec.ts` | 1 | Search q at A empty when guest only at B | Yes |

---

## Success criteria (spec §9)

1. Two-property test: guest at B only → **absent** from A list, search, GET, batch (**S2** closed).
2. Same test: staff at B only → **absent** from A roster list/GET (**S7** closed).
3. Hotel B list/search/GET includes the guest/staff.
4. Create at A + book at B → guest visible at both properties after book.
5. Roster add at property creates `roster_property` row.
6. List/search decrypt only the filtered page (SQL filter before decrypt — **P11**).
7. `ORG_SCHEMA_HEAD === 8`; catalog/route/property/night-audit pins unchanged.
8. Existing single-property guest/roster route tests green.
9. `pnpm test:local` green.

---

## Plan vs codebase notes (reviewer)

| Item | Notes |
|---|---|
| `guests-routes.spec.ts` has no `postGuestsBatch` today | Task 1 adds helper copied from `front-desk-reads.spec.ts` ~63–71. |
| `resolvePropertyContext` third arg | `ctx.tenantProperty` optional prefetch — only guest/roster read handlers + book in Task 4. |
| T3 red assertion | **`listBBefore` absent** is the red gate on org-wide `main`; after-book presence guards book upsert (Task 4). |
| Spec §3.1 “book without POST /guests” | **Not T3** per reviewer — create-at-A + book-at-B replaces it. |
| `upsertGuestPropertyAssociation` gate | Either `reservations:write` or `guests:write` must pass. |
| Generated DDL path | Run `pnpm generate:ddl`; stage whatever paths `check:ddl` expects (same as prior org migrations). |
| `demo-seed.ts` | Guest create loop already calls `tryCreateGuest` (links property); reservation loop needs explicit book upsert for idempotent re-runs where guest existed but link missing. |
