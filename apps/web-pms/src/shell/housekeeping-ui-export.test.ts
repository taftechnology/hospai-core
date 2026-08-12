import { describe, expect, it } from 'vitest';
import { housekeepingUi } from '@hospai/pms-housekeeping/ui';

describe('@hospai/pms-housekeeping/ui export', () => {
  it('exposes housekeeping nav contribution', () => {
    expect(housekeepingUi.moduleId).toBe('pms.housekeeping');
    expect(housekeepingUi.nav).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'housekeeping',
          path: '/housekeeping',
          order: 25,
          permission: 'housekeeping:read',
        }),
      ]),
    );
  });
});
