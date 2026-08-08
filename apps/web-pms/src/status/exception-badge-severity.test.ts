import { describe, expect, it } from 'vitest';
import { exceptionBadgeSeverity } from './exception-badge-severity.js';

describe('exceptionBadgeSeverity', () => {
  it('maps count to severity', () => {
    expect(exceptionBadgeSeverity(0)).toBe('neutral');
    expect(exceptionBadgeSeverity(1)).toBe('exception');
    expect(exceptionBadgeSeverity(3)).toBe('exception');
  });
});
