import type { RecurringChargePattern } from '@hospai/client-core';
import { WEEKENDS_DAYS_MASK } from '@hospai/contracts';

/** Book / Folio “When” control values (UI). */
export const RECURRING_WHEN_OPTIONS = [
  { value: 'now', label: 'Now' },
  { value: 'every_night', label: 'Every night' },
  { value: 'arrival', label: 'Arrival night' },
  { value: 'last_night', label: 'Last night' },
  { value: 'weekends', label: 'Weekends' },
  { value: 'days_of_week', label: 'Chosen days of week' },
  { value: 'dates', label: 'Chosen dates' },
] as const;

export type RecurringWhenValue = (typeof RECURRING_WHEN_OPTIONS)[number]['value'];

/** Folio add form omits Now (always a schedule). */
export const FOLIO_RECURRING_WHEN_OPTIONS = RECURRING_WHEN_OPTIONS.filter((o) => o.value !== 'now');

export const WEEKDAY_BITS = [
  { bit: 0, label: 'Mon' },
  { bit: 1, label: 'Tue' },
  { bit: 2, label: 'Wed' },
  { bit: 3, label: 'Thu' },
  { bit: 4, label: 'Fri' },
  { bit: 5, label: 'Sat' },
  { bit: 6, label: 'Sun' },
] as const;

export type RecurringScheduleChoice =
  | { when: 'now' }
  | { when: 'every_night'; pattern: 'NIGHTLY' }
  | { when: 'arrival'; pattern: 'ARRIVAL' }
  | { when: 'last_night'; pattern: 'LAST_NIGHT' }
  | { when: 'weekends'; pattern: 'DAYS_OF_WEEK'; daysMask: typeof WEEKENDS_DAYS_MASK }
  | { when: 'days_of_week'; pattern: 'DAYS_OF_WEEK'; daysMask: number }
  | { when: 'dates'; pattern: 'DATES'; dates: string[] };

export function isNowChoice(choice: RecurringScheduleChoice): choice is { when: 'now' } {
  return choice.when === 'now';
}

export function choiceFromWhen(
  when: RecurringWhenValue,
  daysMask: number,
  dates: string[],
): RecurringScheduleChoice {
  switch (when) {
    case 'now':
      return { when: 'now' };
    case 'every_night':
      return { when: 'every_night', pattern: 'NIGHTLY' };
    case 'arrival':
      return { when: 'arrival', pattern: 'ARRIVAL' };
    case 'last_night':
      return { when: 'last_night', pattern: 'LAST_NIGHT' };
    case 'weekends':
      return { when: 'weekends', pattern: 'DAYS_OF_WEEK', daysMask: WEEKENDS_DAYS_MASK };
    case 'days_of_week':
      return { when: 'days_of_week', pattern: 'DAYS_OF_WEEK', daysMask };
    case 'dates':
      return { when: 'dates', pattern: 'DATES', dates };
  }
}

export function schedulePayload(choice: Exclude<RecurringScheduleChoice, { when: 'now' }>): {
  pattern: RecurringChargePattern;
  daysMask: number | null;
  dates: string[] | null;
} {
  if (choice.pattern === 'DAYS_OF_WEEK') {
    return { pattern: 'DAYS_OF_WEEK', daysMask: choice.daysMask, dates: null };
  }
  if (choice.pattern === 'DATES') {
    return { pattern: 'DATES', daysMask: null, dates: choice.dates };
  }
  return { pattern: choice.pattern, daysMask: null, dates: null };
}

export function patternWord(input: {
  pattern: RecurringChargePattern;
  daysMask?: number | null;
  dates?: string[] | null;
}): string {
  switch (input.pattern) {
    case 'NIGHTLY':
      return 'Every night';
    case 'ARRIVAL':
      return 'Arrival night';
    case 'LAST_NIGHT':
      return 'Last night';
    case 'DAYS_OF_WEEK':
      if (input.daysMask === WEEKENDS_DAYS_MASK) return 'Weekends';
      return 'Chosen days';
    case 'DATES':
      return 'Chosen dates';
    default: {
      const _exhaustive: never = input.pattern;
      return _exhaustive;
    }
  }
}

export function toggleDayMask(mask: number, bit: number): number {
  return mask ^ (1 << bit);
}

export function dayMaskHas(mask: number, bit: number): boolean {
  return (mask & (1 << bit)) !== 0;
}

export const MAX_RECURRING_DATES = 31;
