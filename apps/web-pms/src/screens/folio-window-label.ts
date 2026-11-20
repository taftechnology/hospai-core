/** Operator words for a folio window — never the raw kind code. */
export function folioWindowLabel(w: { kind: string; billedParty?: string | null }): string {
  if (w.kind === 'GUEST') return 'Guest';
  if (w.kind === 'COMPANY') {
    const name = w.billedParty?.trim();
    return name ? `Company · ${name}` : 'Company';
  }
  if (w.kind === 'MASTER') return 'Master';
  return 'Other';
}
