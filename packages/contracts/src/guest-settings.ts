import { z } from 'zod';

/** OrgDO `operational_config` key. One row per org, `property_id = '*'`. */
export const GUEST_SETTINGS_KEY = 'pms.guests.settings' as const;

/**
 * Write schema. Every field is required. Unknown or missing fields fail
 * (`422 validation_error` at the PUT route).
 */
const CONSENT_NOTICE_VERSION = /^[A-Za-z0-9._-]+$/;

export const GuestSettingsSchema = z
  .object({
    requireEmail: z.boolean(),
    requirePhone: z.boolean(),
    matchOnEmail: z.boolean(),
    matchOnPhone: z.boolean(),
    requireIdAtCheckIn: z.boolean(),
    consentNoticeVersion: z.string().max(40).regex(CONSENT_NOTICE_VERSION).nullable(),
  })
  .strict();
export type GuestSettings = z.infer<typeof GuestSettingsSchema>;

export const DEFAULT_GUEST_SETTINGS: GuestSettings = {
  requireEmail: false,
  requirePhone: false,
  matchOnEmail: false,
  matchOnPhone: false,
  requireIdAtCheckIn: false,
  consentNoticeVersion: null,
};

/** Read path: missing fields fall back to defaults; unknown keys are ignored. */
const GuestSettingsReadSchema = z.object({
  requireEmail: z.boolean().default(DEFAULT_GUEST_SETTINGS.requireEmail),
  requirePhone: z.boolean().default(DEFAULT_GUEST_SETTINGS.requirePhone),
  matchOnEmail: z.boolean().default(DEFAULT_GUEST_SETTINGS.matchOnEmail),
  matchOnPhone: z.boolean().default(DEFAULT_GUEST_SETTINGS.matchOnPhone),
  requireIdAtCheckIn: z.boolean().default(DEFAULT_GUEST_SETTINGS.requireIdAtCheckIn),
  consentNoticeVersion: z
    .string()
    .max(40)
    .regex(CONSENT_NOTICE_VERSION)
    .nullable()
    .default(DEFAULT_GUEST_SETTINGS.consentNoticeVersion),
});

export function parseStoredGuestSettings(raw: unknown): GuestSettings {
  const parsed = GuestSettingsReadSchema.safeParse(raw);
  if (!parsed.success) return { ...DEFAULT_GUEST_SETTINGS };
  return parsed.data;
}
