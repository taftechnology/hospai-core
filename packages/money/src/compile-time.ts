/** Typecheck-only — cross-currency add must not compile when literals are distinct. */
import { add, currencyCode, money } from './index.js';

function _compileTimeChecks(): void {
  const eur = money(100, currencyCode('EUR'));
  const usd = money(100, currencyCode('USD'));
  // @ts-expect-error cross-currency add must not compile
  add(eur, usd);
}

void _compileTimeChecks;
