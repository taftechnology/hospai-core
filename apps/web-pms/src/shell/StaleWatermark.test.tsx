import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('./property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

import { StaleWatermark } from './StaleWatermark.js';

describe('StaleWatermark', () => {
  afterEach(() => cleanup());

  it('stale=true shows status copy from asOf', () => {
    render(<StaleWatermark asOf={Date.parse('2026-08-13T15:04:00.000Z')} stale />);
    const el = screen.getByTestId('stale-watermark');
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(el.textContent).toBe('Live updates paused — showing data from 13 Aug 2026, 3:04 pm.');
  });

  it('stale=false renders nothing', () => {
    render(<StaleWatermark asOf={1} stale={false} />);
    expect(screen.queryByTestId('stale-watermark')).toBeNull();
  });
});
