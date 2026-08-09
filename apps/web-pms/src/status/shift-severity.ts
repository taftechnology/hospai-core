import type { StatusSeverity } from './types.js';

export type ShiftSeverityInput =
  | { kind: 'idle' }
  | {
      kind: 'open';
      businessDate: string;
      propertyLocalToday: string | null;
    }
  | {
      kind: 'closed';
      variance: number | null;
      status: 'CLOSED' | 'FORCE_CLOSED';
    };

export function shiftSeverity(input: ShiftSeverityInput): StatusSeverity {
  switch (input.kind) {
    case 'idle':
      return 'neutral';
    case 'open': {
      if (input.propertyLocalToday == null) return 'neutral';
      if (input.businessDate < input.propertyLocalToday) return 'attention';
      return 'neutral';
    }
    case 'closed': {
      if (input.status === 'FORCE_CLOSED') return 'exception';
      if (input.variance === null) return 'neutral';
      if (input.variance === 0) return 'settled';
      return 'attention';
    }
    default: {
      const _exhaustive: never = input;
      return _exhaustive;
    }
  }
}
