export function permissionForForbidden(body: unknown): string | null {
  if (body !== null && typeof body === 'object') {
    const p = (body as Record<string, unknown>).permission;
    if (typeof p === 'string' && p.length > 0) return p;
  }
  return null;
}
