import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useClientKey } from './hooks.js';
import { opsKeys } from './keys.js';

describe('useClientKey', () => {
  it('reuses the key for an identical payload, changes it when the payload changes, and clears on success', () => {
    const { result } = renderHook(() => useClientKey());
    const a = result.current.keyFor({ planCode: 'growth', reason: 'x' });
    expect(result.current.keyFor({ planCode: 'growth', reason: 'x' })).toBe(a);
    const b = result.current.keyFor({ planCode: 'growth', reason: 'y' });
    expect(b).not.toBe(a);
    result.current.clear();
    expect(result.current.keyFor({ planCode: 'growth', reason: 'y' })).not.toBe(b);
  });
});

describe('customer list key', () => {
  it('includes the status and stays under the customersAll prefix', () => {
    expect(opsKeys.customers('closing', 'q', 2)).toEqual(['ops', 'customers', 'closing', 'q', 2]);
    expect(opsKeys.customers('closing', 'q', 2).slice(0, 2)).toEqual([...opsKeys.customersAll()]);
    expect(opsKeys.customers('current', '', 1)).not.toEqual(opsKeys.customers('all', '', 1));
  });
});
