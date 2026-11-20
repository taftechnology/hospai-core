export const RATES_BULK_UPDATE_MAX = 500 as const;
/** Inclusion rows on `rates.create_plan` / `rates.update_plan`, at HTTP and in the try* RPC. */
export const RATE_PLAN_INCLUSION_MAX = 8 as const;
export const ROOMS_BULK_STATUS_MAX = 200 as const;
export const FOLIO_SPLIT_MAX = 20 as const;
export const ROSTER_KINDS_MAX = 16 as const;
/** Nights accepted by `reservations.override_night_rate`, at HTTP and in the RPC. */
export const RATE_OVERRIDE_NIGHTS_MAX = 90 as const;
/** Largest nightly override, in minor units (100_000_000.00). */
export const RATE_OVERRIDE_AMOUNT_MAX_MINOR = 10_000_000_000 as const;
/** Guest refs accepted by desk reservation search, at HTTP and in the PropertyDO RPC. */
export const RESERVATION_SEARCH_GUEST_REF_CAP = 5 as const;
/** Rows returned by every desk reservation-search branch. */
export const RESERVATION_SEARCH_ROW_LIMIT = 10 as const;
