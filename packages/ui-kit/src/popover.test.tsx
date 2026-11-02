import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Popover } from './Popover.js';

function Harness({ returnFocus = true }: { returnFocus?: boolean }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" ref={anchorRef} onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button">Outside</button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        label="Sample menu"
        returnFocus={returnFocus}
        data-testid="popover"
      >
        <button type="button">Inside</button>
      </Popover>
    </>
  );
}

describe('Popover', () => {
  it('renders nothing when closed and shows the panel when open', () => {
    render(<Harness />);
    expect(screen.queryByTestId('popover')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByTestId('popover')).toBeTruthy();
    expect(screen.getByLabelText('Sample menu')).toBeTruthy();
  });

  it('Escape closes and returns focus to the anchor', () => {
    render(<Harness />);
    const anchor = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(anchor);
    screen.getByRole('button', { name: 'Inside' }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('popover')).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it('an outside pointerdown closes and returns focus to the anchor', () => {
    render(<Harness />);
    const anchor = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(anchor);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByTestId('popover')).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it('a pointerdown inside the panel or on the anchor leaves it open', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Inside' }));
    expect(screen.getByTestId('popover')).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByTestId('popover')).toBeTruthy();
  });

  it('does not move focus when returnFocus is false', () => {
    render(<Harness returnFocus={false} />);
    const anchor = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(anchor);
    const inside = screen.getByRole('button', { name: 'Inside' });
    inside.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('popover')).toBeNull();
    expect(document.activeElement).not.toBe(anchor);
  });
});
