# Runbook: throw and clear a kill-switch

**Written:** 2026-11-24. **Owner:** the HospAI owner (the only person with Cloudflare KV write
access today). **Status:** interim. There is no audited command for this yet; R7.3 is the place
to add one ([ops spec §12](../superpowers/specs/2026-11-22-ops-platform-design.md)).

A kill-switch is a key in the `ENTITLEMENT_KV` namespace. While it holds any non-empty value, the
thing it names stops. It is global: every hotel on that environment is affected. To stop **one**
customer, use **Suspend** in the Ops Console instead; that is audited and the hotel sees it.

## Which switch

| Key | What stops | How fast | What keeps working |
|---|---|---|---|
| `kill:ops.write` | Every Ops Console write (create customer, add hotel, plan, add-on, suspend, reinstate, operators, copy setup, restore) returns `503 ops_writes_disabled` | At once (read uncached on each write) | Console reads; the hotel app is untouched |
| `kill:<featureKey>` | Every org and property HTTP route whose route or command declares that feature returns `503` with an empty body. Outbox queue consumers gated on that feature skip their events | Within 30 s (`cacheTtl` 30, KV's minimum; `ARCHITECTURE.md` §6.4) | `/v1/me` and other user-scope routes, Durable Object alarms (night audit runs), the Ops Console, guest erasure (never gated) |

`featureKey` is one of `FEATURE_KEYS` in `packages/contracts/src/entitlements.ts`. In practice:

- `kill:pms.core` takes down most of the hotel app, and also blocks org cancel and purge
  (`post_org_cancel`, `post_org_purge`), which the smoke test's last step uses.
- A narrower key (`kill:ai_ops.enabled`, `kill:accounting_export.enabled`, `kill:pms.housekeeping`,
  …) stops only the routes and consumers that declare it.

Use `kill:ops.write` when an operator's credentials may be compromised. Use a feature key when
that feature is writing bad data or misbehaving for every hotel and a fix is not minutes away.

**Before you throw a feature switch, know this:** a queue consumer that is skipped while the
switch is on marks the event as seen and never replays it
([outbox consumers spec](../superpowers/specs/2026-11-19-outbox-consumers-design.md), gate step).
Events published during the window are lost to that consumer; one that needs them must do a full
sync after the switch is cleared.

## Throw it

From the repository root, signed in to Wrangler on the HospAI Cloudflare account. Use
`--env staging` or `--env production`; without `--remote` Wrangler writes only to your local dev
store and nothing happens.

```bash
cd apps/pms-core
pnpm exec wrangler kv key put "kill:ops.write" "INC-<date>-<short reason>" --binding ENTITLEMENT_KV --env staging --remote
```

The value is free text; any non-empty value turns the switch on. Put the incident reference and a
short reason in it, never a guest's or staff member's name.

## Check what is on

```bash
cd apps/pms-core
pnpm exec wrangler kv key list --binding ENTITLEMENT_KV --env staging --remote --prefix "kill:"
```

An empty list means every switch is off. Then check the effect: for `kill:ops.write`, try a write
in the Ops Console (it should say "Operator changes are switched off right now. Reads still
work."); for a feature key, wait 30 seconds and
call one route that declares it (expect `503`).

## Clear it

```bash
cd apps/pms-core
pnpm exec wrangler kv key delete "kill:ops.write" --binding ENTITLEMENT_KV --env staging --remote
```

A feature switch can stay in effect for up to 30 seconds after the delete. Run the list command
again to confirm nothing is left on.

## Record it

Nothing in HospAI records a KV write: it does not appear in the operator log, and the hotel does
not see it. Until the audited command exists, keep one line per toggle in the incident record:

- when it went on and off (UTC), which environment, which key, the value written;
- who did it and why;
- for a feature key, which hotels were affected (all of them on that environment) and which
  consumers skipped events, from the `consumer.skipped` logs with `reason: killed`.

If a hotel noticed, tell it what was off and for how long.
