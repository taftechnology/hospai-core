import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StayButton } from './StayButton.js';

afterEach(cleanup);

describe('StayButton', () => {
  it('renders the stay state, tracks and cut ends', () => {
    render(
      <StayButton state="overstay" colStart={2} colEnd={6} cutStart aria-label="Robert Hale, Overstay">
        R. Hale
      </StayButton>,
    );
    const btn = screen.getByRole('button', { name: 'Robert Hale, Overstay' });
    expect(btn.className).toBe('ui-stay ui-stay--overstay');
    expect(btn.style.getPropertyValue('--tape-col-start')).toBe('2');
    expect(btn.style.getPropertyValue('--tape-col-end')).toBe('6');
    expect(btn.hasAttribute('data-cut-start')).toBe(true);
    expect(btn.hasAttribute('data-cut-end')).toBe(false);
    expect(btn.tabIndex).toBe(-1);
  });

  it('forwards clicks', () => {
    const onClick = vi.fn();
    render(
      <StayButton state="confirmed" colStart={3} colEnd={7} tabIndex={0} onClick={onClick} aria-label="Meera Iyer, Confirmed">
        Meera Iyer
      </StayButton>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
