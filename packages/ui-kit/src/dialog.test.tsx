import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Button } from './Button.js';
import { Dialog } from './Dialog.js';

function OpenHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" data-testid="trigger">
        Open
      </button>
      <Dialog
        open={open}
        title="Test dialog"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button type="button" intent="default">
              First
            </Button>
            <Button type="button" intent="primary" data-testid="last-btn">
              Last
            </Button>
          </>
        }
      >
        <p>Body</p>
      </Dialog>
    </>
  );
}

function FocusHarness() {
  const focusRef = createRef<HTMLButtonElement>();
  return (
    <Dialog
      open
      title="Focus test"
      onClose={() => {}}
      initialFocus={focusRef}
      footer={
        <Button ref={focusRef} type="button" intent="default">
          Target
        </Button>
      }
    />
  );
}

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(
      <Dialog open={false} title="Hidden" onClose={() => {}}>
        Body
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape calls onClose', async () => {
    const user = userEvent.setup();
    render(<OpenHarness />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('backdrop click calls onClose', () => {
    const { baseElement } = render(<OpenHarness />);
    const backdrop = baseElement.querySelector('.ui-dialog__backdrop');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Tab and Shift+Tab wrap inside the panel', async () => {
    const user = userEvent.setup();
    render(<OpenHarness />);
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByTestId('last-btn');
    first.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
    await user.tab();
    expect(document.activeElement).toBe(first);
  });

  it('focus returns to the previously focused element on close', async () => {
    const user = userEvent.setup();
    function Closable() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
            Open
          </button>
          <Dialog open={open} title="T" onClose={() => setOpen(false)}>
            <Button type="button">Inside</Button>
          </Dialog>
        </>
      );
    }
    render(<Closable />);
    const trigger = screen.getByTestId('trigger');
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
  });

  it('initialFocus receives focus on open', () => {
    render(<FocusHarness />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Target' }));
  });
});
