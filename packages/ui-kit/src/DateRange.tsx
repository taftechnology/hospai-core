import type { TestIdProps } from './types.js';
import { addCalendarDays } from './calendar-days.js';
import { Button } from './Button.js';
import { Input } from './Input.js';
import { VisuallyHidden } from './Layout.js';

export type DateRangeProps = TestIdProps & {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  stepDays: number;
  fromTestId?: string;
  toTestId?: string;
  label: string;
};

export function DateRange({
  from,
  to,
  onChange,
  stepDays,
  fromTestId,
  toTestId,
  label,
  'data-testid': dataTestId,
}: DateRangeProps) {
  function shift(delta: number) {
    const nextFrom = addCalendarDays(from, delta);
    const nextTo = addCalendarDays(to, delta);
    onChange(nextFrom, nextTo);
  }

  return (
    <div className="ui-date-range" role="group" aria-label={label} data-testid={dataTestId}>
      <Button type="button" intent="ghost" size="sm" aria-label="Earlier dates" onClick={() => shift(-stepDays)}>
        ‹
      </Button>
      <VisuallyHidden>
        <label htmlFor="ui-date-range-from">From</label>
      </VisuallyHidden>
      <Input
        id="ui-date-range-from"
        type="date"
        data-testid={fromTestId}
        autoComplete="off"
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
      />
      <VisuallyHidden>
        <label htmlFor="ui-date-range-to">To</label>
      </VisuallyHidden>
      <Input
        id="ui-date-range-to"
        type="date"
        data-testid={toTestId}
        autoComplete="off"
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
      />
      <Button type="button" intent="ghost" size="sm" aria-label="Later dates" onClick={() => shift(stepDays)}>
        ›
      </Button>
    </div>
  );
}
