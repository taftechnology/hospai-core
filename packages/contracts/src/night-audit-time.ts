/**
 * `pms.night_audit.audit_time` — strict 24-hour `HH:MM`, 00:00 to 11:59.
 *
 * The roll only advances once the business date has ended in the property timezone, so an
 * audit time at or after noon would fire while the day is still open on every single
 * night (2026-11-23 staging incident). Mornings only.
 */
const AUDIT_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidNightAuditTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = AUDIT_TIME_PATTERN.exec(value);
  if (!m) return false;
  return Number(m[1]) < 12;
}
