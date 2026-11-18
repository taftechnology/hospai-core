/**
 * Cancel every Durable Object alarm a spec file left armed, when that file ends.
 *
 * Why: the pool runs a whole shard in one workerd (`singleWorker`, and Workflows force
 * `isolatedStorage: false`). Every PropertyDO / OrgDO that takes a write arms the 30 s
 * outbox sweep (`OUTBOX_SWEEP_INTERVAL_MS`) and keeps re-arming it. On a CI runner a
 * shard takes 70–90 s, so DOs from earlier files wake in bursts during later files: each
 * wake resets the instance (the pool reloads `index.ts` per file), flushes to the Queue,
 * and the consumer replays the events — all on the same thread as the test under way.
 * That starved foreground requests past the 5 s test timeout (org-crypto-isolation T7,
 * products, roster ops, demo-seed) and could end in a workerd segfault.
 *
 * Nothing asserts on an alarm firing in a later file; specs that test alarms drive them
 * with `runDurableObjectAlarm` or the `run*AlarmForTest` helpers inside their own file.
 * Production code is untouched — this only clears the test runtime between files.
 */
import { env, listDurableObjectIds, runInDurableObject } from 'cloudflare:test';
import { afterAll } from 'vitest';

const NAMESPACES = ['PROPERTY_DO', 'ORG_DO', 'ORG_ENTITLEMENT_DO'] as const;

// Module state is re-evaluated per spec file; the isolate global is not. Remember which
// objects were already cleared so later files never touch (and so reset) them again.
const store = globalThis as { __hospaiAlarmsCancelled?: Set<string> };
const cancelled = (store.__hospaiAlarmsCancelled ??= new Set<string>());

afterAll(async () => {
  const bindings = env as unknown as Record<(typeof NAMESPACES)[number], DurableObjectNamespace>;
  for (const name of NAMESPACES) {
    const ns = bindings[name];
    for (const id of await listDurableObjectIds(ns)) {
      const key = `${name}:${id.toString()}`;
      if (cancelled.has(key)) continue;
      cancelled.add(key);
      try {
        await runInDurableObject(ns.get(id), (_instance, state) => state.storage.deleteAlarm());
      } catch {
        // A DO a spec deliberately broke (fault injection, reset) has nothing left to clear.
      }
    }
  }
}, 60_000);
