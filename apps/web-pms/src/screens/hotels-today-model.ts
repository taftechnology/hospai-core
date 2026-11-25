import type { HeadOfficeRow } from '@hospai/contracts';

/** The one cache key of the head-office view: the org plus nothing else (no params). */
export function headOfficeQueryKey(orgId: string): readonly ['org-head-office', string] {
  return ['org-head-office', orgId];
}

/** `POST_ROOM_CHARGES` reads as `Post room charges`. */
export function auditStepLabel(step: string): string {
  const words = step.toLowerCase().split('_').filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type AuditBadge = {
  rung: 'settled' | 'neutral' | 'informational' | 'exception';
  /** Plain words: the state is never carried by colour alone. */
  text: string;
};

export function auditBadge(audit: HeadOfficeRow['audit'], formatDate: (iso: string) => string): AuditBadge {
  if (audit.state === 'halted') {
    return {
      rung: 'exception',
      text: audit.failedStep ? `Halted at ${auditStepLabel(audit.failedStep)}` : 'Halted',
    };
  }
  if (audit.state === 'running') return { rung: 'informational', text: 'Running' };
  if (audit.lastCompletedDate) {
    return { rung: 'settled', text: `Completed ${formatDate(audit.lastCompletedDate)}` };
  }
  return { rung: 'neutral', text: 'Not run yet' };
}

/** Whole-number percentage of sold over sellable, or null when nothing was sellable. */
export function occupancyPercent(sold: number, sellable: number): number | null {
  if (sellable <= 0) return null;
  return Math.round((sold * 100) / sellable);
}
