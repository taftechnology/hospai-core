import { z } from 'zod';

/** OrgDO `operational_config` key. One row per org, `property_id = '*'`. */
export const GUEST_SETTINGS_KEY = 'pms.guests.settings' as const;

/**
 * Write schema. Every field is required. Unknown or missing fields fail
 * (`422 validation_error` at the PUT route).
 */
export const GuestSettingsSchema = z
  .object({
    requireEmail: z.boolean(),
    requirePhone: z.boolean(),
    matchOnEmail: z.boolean(),
    matchOnPhone: z.boolean(),
  })
  .strict();
export type GuestSettings = z.infer<typeof GuestSettingsSchema>;

export const DEFAULT_GUEST_SETTINGS: GuestSettings = {
  requireEmail: false,
  requirePhone: false,
  matchOnEmail: false,
  matchOnPhone: false,
};

/** Read path: missing or non-boolean fields fall back to false; unknown keys are ignored. */
const GuestSettingsReadSchema = z.object({
  requireEmail: z.boolean().default(DEFAULT_GUEST_SETTINGS.requireEmail),
  requirePhone: z.boolean().default(DEFAULT_GUEST_SETTINGS.requirePhone),
  matchOnEmail: z.boolean().default(DEFAULT_GUEST_SETTINGS.matchOnEmail),
  matchOnPhone: z.boolean().default(DEFAULT_GUEST_SETTINGS.matchOnPhone),
});

export function parseStoredGuestSettings(raw: unknown): GuestSettings {
  const parsed = GuestSettingsReadSchema.safeParse(raw);
  if (!parsed.success) return { ...DEFAULT_GUEST_SETTINGS };
  return parsed.data;
}
