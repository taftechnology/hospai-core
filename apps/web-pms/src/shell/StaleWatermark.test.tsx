import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StaleWatermark } from './StaleWatermark.js';

describe('StaleWatermark', () => {
  afterEach(() => cleanup());

  it('stale=true shows status copy from asOf', () => {
    render(<StaleWatermark asOf={Date.parse('2026-08-13T15:04:00.000Z')} stale timeZone="UTC" />);
    const el = screen.getByTestId('stale-watermark');
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(el.textContent).toMatch(/^Live updates paused — showing data from /);
    const formatted = new Intl.DateTimeFormat(undefined, {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(Date.parse('2026-08-13T15:04:00.000Z')));
    expect(el.textContent).toContain(formatted);
  });

  it('stale=false renders nothing', () => {
    render(<StaleWatermark asOf={1} stale={false} timeZone="UTC" />);
    expect(screen.queryByTestId('stale-watermark')).toBeNull();
  });
});
