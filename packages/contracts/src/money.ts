/** Folio / ledger wire codes — map @hospai/money validation failures at DO boundary. */
export const MONEY_INVALID = 'money_invalid' as const;
export const FX_RATE_INVALID = 'fx_rate_invalid' as const;
export const LEDGER_AMOUNT_MISMATCH = 'ledger_amount_mismatch' as const;
export const CURRENCY_UNSET = 'currency_unset' as const;
export const CROSS_CURRENCY_UNSUPPORTED = 'cross_currency_unsupported' as const;
export const FX_RATE_MISSING = 'fx_rate_missing' as const;
export const FX_RATE_NOT_LEDGER = 'fx_rate_not_ledger' as const;
export const FX_RATE_OPEN_EXISTS = 'fx_rate_open_exists' as const;

export type { PostedLineAmount, FolioLineAmount, CurrencyCode, Money, FxRate, RemainderPolicy } from '@hospai/money';
