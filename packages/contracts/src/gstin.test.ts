import { describe, expect, it } from 'vitest';
import {
  GST_STATE_CODES,
  gstinCheckCharacter,
  gstinProblem,
  gstinStateCode,
  gstinWithCheckDigit,
} from './gstin.js';
import {
  HSN_SAC_PATTERN,
  parseCompanyGst,
  parseInvoiceBuyer,
  parseProfileGstBuyer,
  UNREGISTERED_BUYER_NAME_ADDRESS_THRESHOLD_MINOR,
} from './gst-buyer.js';

const BODY = '27AAPFU0939F1Z';
const VALID = gstinWithCheckDigit(BODY);

describe('gstin', () => {
  it('accepts a check digit produced by the algorithm', () => {
    expect(gstinProblem(VALID)).toBeNull();
    expect(gstinProblem(`  ${VALID.toLowerCase()}  `)).toBeNull();
  });

  it('rejects a bad format', () => {
    expect(gstinProblem('27AAPFU0939F1')).toBe('format');
    expect(gstinProblem('27AAPFU0939F1Z-')).toBe('format');
  });

  it('rejects a state code outside 01–38 and 97', () => {
    const badState = gstinWithCheckDigit('99AAPFU0939F1Z');
    expect(gstinProblem(badState)).toBe('state_code');
    expect(GST_STATE_CODES['27']).toBe('Maharashtra');
    expect(GST_STATE_CODES['97']).toBe('Other Territory');
    expect(GST_STATE_CODES['99']).toBeUndefined();
  });

  it('rejects a known-bad check digit', () => {
    const good = gstinCheckCharacter(BODY);
    const bad = good === 'A' ? 'B' : 'A';
    expect(gstinProblem(BODY + bad)).toBe('checksum');
  });

  it('derives the state code from the first two digits', () => {
    expect(gstinStateCode(VALID)).toBe('27');
    expect(gstinStateCode(` ${VALID.toLowerCase()} `)).toBe('27');
  });
});

describe('buyer schema', () => {
  const registered = {
    type: 'REGISTERED' as const,
    fields: {
      gstin: VALID,
      legalName: 'Northwind Hotels',
      stateCode: '27',
      pin: '400001',
    },
  };

  it('accepts a registered buyer and rejects a missing GSTIN', () => {
    expect(parseInvoiceBuyer(registered)).toEqual({
      ok: true,
      buyer: {
        type: 'REGISTERED',
        fields: {
          gstin: VALID,
          legalName: 'Northwind Hotels',
          stateCode: '27',
          pin: '400001',
        },
      },
    });
    const missing = parseInvoiceBuyer({
      type: 'REGISTERED',
      fields: { legalName: 'Northwind Hotels', stateCode: '27' },
    });
    expect(missing).toEqual({ ok: false, error: 'buyer_gstin_required' });
  });

  it('rejects a state code that does not match the GSTIN', () => {
    expect(
      parseInvoiceBuyer({ ...registered, fields: { ...registered.fields, stateCode: '29' } }),
    ).toEqual({ ok: false, error: 'buyer_state_code_mismatch' });
  });

  it('treats a missing company GST block as no buyer', () => {
    expect(parseCompanyGst(null)).toEqual({ ok: true, gst: null });
    expect(parseCompanyGst(undefined)).toEqual({ ok: true, gst: null });
    expect(parseCompanyGst({})).toEqual({ ok: true, gst: null });
  });

  it('treats an empty unregistered buyer as no buyer and forbids a GSTIN', () => {
    expect(parseInvoiceBuyer({ type: 'UNREGISTERED', fields: {} })).toEqual({ ok: true, buyer: null });
    expect(parseInvoiceBuyer({ type: 'UNREGISTERED', fields: { legalName: '  ' } })).toEqual({
      ok: true,
      buyer: null,
    });
    expect(
      parseInvoiceBuyer({ type: 'UNREGISTERED', fields: { legalName: 'Ada', address: '1 Lane' } }),
    ).toMatchObject({ ok: true, buyer: { type: 'UNREGISTERED' } });
    expect(parseInvoiceBuyer({ type: 'UNREGISTERED', fields: { gstin: VALID } })).toEqual({
      ok: false,
      error: 'validation_error',
    });
  });

  it('rejects unknown keys and over-long fields', () => {
    expect(parseInvoiceBuyer({ ...registered, extra: true })).toEqual({
      ok: false,
      error: 'validation_error',
    });
    expect(
      parseInvoiceBuyer({
        type: 'REGISTERED',
        fields: { ...registered.fields, legalName: 'N'.repeat(101) },
      }),
    ).toEqual({ ok: false, error: 'validation_error' });
  });

  it('profile gstBuyer does not require a legal name', () => {
    expect(parseProfileGstBuyer({ gstin: VALID, stateCode: '27' })).toMatchObject({ ok: true });
    expect(parseProfileGstBuyer({ gstin: BODY + 'A' })).toEqual({ ok: false, error: 'invalid_gstin' });
  });

  it('matches HSN/SAC at 4, 6, or 8 digits', () => {
    expect(HSN_SAC_PATTERN.test('9963')).toBe(true);
    expect(HSN_SAC_PATTERN.test('996311')).toBe(true);
    expect(HSN_SAC_PATTERN.test('99631101')).toBe(true);
    expect(HSN_SAC_PATTERN.test('996')).toBe(false);
    expect(HSN_SAC_PATTERN.test('99631')).toBe(false);
    expect(HSN_SAC_PATTERN.test('9963110')).toBe(false);
    expect(UNREGISTERED_BUYER_NAME_ADDRESS_THRESHOLD_MINOR).toBe(5_000_000);
  });
});
