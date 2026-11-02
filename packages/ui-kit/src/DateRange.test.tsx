import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DateRange } from './DateRange.js';

describe('DateRange', () => {
  it('shifts both dates by stepDays', () => {
    const onChange = vi.fn();
    render(
      <DateRange
        label="Range"
        from="2026-08-10"
        to="2026-08-16"
        stepDays={7}
        onChange={onChange}
        fromTestId="from"
        toTestId="to"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Later dates' }));
    expect(onChange).toHaveBeenCalledWith('2026-08-17', '2026-08-23');
  });
});
