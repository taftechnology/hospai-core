/** Typecheck-only — Promise must not satisfy Sync. */
import type { Sync } from './sync.js';

function _compileTimeChecks(): void {
  const ok: Sync<number> = 1;
  void ok;
  // @ts-expect-error Promise is not Sync
  const bad: Sync<Promise<number>> = Promise.resolve(1);
  void bad;
}
void _compileTimeChecks;
