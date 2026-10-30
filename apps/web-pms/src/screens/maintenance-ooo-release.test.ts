import { describe, expect, it } from 'vitest';
import { oooReleaseEdit } from './maintenance-ooo-release.js';

describe('oooReleaseEdit', () => {
  it('shrinks a range that started before the business date', () => {
    expect(oooReleaseEdit('2026-10-28', '2026-10-30')).toEqual({
      startDate: '2026-10-28',
      endDate: '2026-10-30',
    });
  });

  it('releases a range that starts on the business date', () => {
    expect(oooReleaseEdit('2026-10-30', '2026-10-30')).toEqual({
      startDate: '2026-10-30',
      endDate: '2026-10-30',
    });
  });

  it('releases a range that starts after the business date', () => {
    expect(oooReleaseEdit('2026-11-02', '2026-10-30')).toEqual({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
    });
  });
});
