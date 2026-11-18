/** Typecheck-only — FeatureKey stays a closed literal union. */
import type { FeatureKey } from './entitlements.js';

function _featureKeyClosed(): void {
  const ok: FeatureKey = 'pms.core';
  void ok;
  // @ts-expect-error unknown feature key is outside the closed union
  const bad: FeatureKey = 'not.a.feature';
  void bad;
}

void _featureKeyClosed;
