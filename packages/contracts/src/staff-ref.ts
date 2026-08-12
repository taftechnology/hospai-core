export const STAFF_REF_RE = /^staff_[A-Za-z0-9_-]+$/;

export function isStaffRef(value: string): boolean {
  return STAFF_REF_RE.test(value);
}
