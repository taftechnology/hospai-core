import { RESERVATION_STATUSES as contractStatuses } from '@hospai/contracts/reservation-status';
import { RESERVATION_STATUSES as kitStatuses } from '@hospai/ui-kit';
import type { ReservationStatus as ContractStatus } from '@hospai/contracts/reservation-status';
import type { ReservationStatus as KitStatus } from '@hospai/ui-kit';
import { describe, expect, it } from 'vitest';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const _statusUnionMatchesContracts: Equal<ContractStatus, KitStatus> = true;
void _statusUnionMatchesContracts;

describe('reservation status pin', () => {
  it('ui-kit lists the same statuses as contracts', () => {
    expect([...kitStatuses]).toEqual([...contractStatuses]);
  });
});
