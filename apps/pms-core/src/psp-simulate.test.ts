import { describe, expect, it } from 'vitest';
import { simulateRefund, simulateVoid } from './psp-simulate.js';

describe('psp-simulate void / refund', () => {
  it('simulateVoid defaults to approved', async () => {
    const result = await simulateVoid(
      { paymentId: 'pay_1', gatewayReference: 'sim_pay_1' },
      null,
    );
    expect(result).toEqual({ outcome: 'approved', gatewayReference: 'sim_pay_1' });
  });

  it('simulateVoid declined / timeout levers', async () => {
    expect(
      await simulateVoid({ paymentId: 'pay_d', gatewayReference: 'g' }, { void: 'declined' }),
    ).toEqual({ outcome: 'declined', reason: 'simulated_decline' });
    expect(
      await simulateVoid({ paymentId: 'pay_t', gatewayReference: 'g' }, { void: 'timeout' }),
    ).toEqual({ outcome: 'timeout' });
  });

  it('simulateRefund defaults to approved with capturedAmountMinor = input.amountMinor', async () => {
    const result = await simulateRefund(
      { paymentId: 'pay_1', amountMinor: 2500, gatewayReference: 'sim_pay_1', currency: 'USD' },
      null,
    );
    expect(result).toEqual({
      outcome: 'approved',
      gatewayReference: 'sim_pay_1',
      capturedAmountMinor: 2500,
    });
  });

  it('simulateRefund declined / timeout levers', async () => {
    expect(
      await simulateRefund(
        { paymentId: 'pay_d', amountMinor: 100, gatewayReference: 'g', currency: 'USD' },
        { refund: 'declined' },
      ),
    ).toEqual({ outcome: 'declined', reason: 'simulated_decline' });
    expect(
      await simulateRefund(
        { paymentId: 'pay_t', amountMinor: 100, gatewayReference: 'g', currency: 'USD' },
        { refund: 'timeout' },
      ),
    ).toEqual({ outcome: 'timeout' });
  });
});
