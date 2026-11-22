import { describe, expect, it } from 'vitest';
import { isCommandError } from './command-error.js';
import {
  FORM_C_FIELD_KEYS,
  FORM_C_REFERENCE_PATTERN,
  canonicalFormCJson,
  formCBookedGuestRecordId,
  formCDisplayName,
  formCFieldsSha256,
  isFormCCountry,
  parseFormCPersonFields,
} from './form-c.js';
import {
  FORM_C_ALREADY_FILED,
  FORM_C_BOOKED_GUEST_EXISTS,
  FORM_C_DETAILS_MISSING,
  FORM_C_NOT_APPLICABLE,
  FORM_C_NOT_FOREIGN,
  FORM_C_NOT_IN_HOUSE,
  VALIDATION_ERROR,
} from './idempotency.js';

const NOW = new Date('2026-11-22T10:00:00Z');
const BASE = {
  surname: 'Okafor',
  givenNames: 'Ada',
  gender: 'F',
  dateOfBirth: '1990-04-01',
  nationality: 'NG',
  passportNumber: 'a1234567',
};

describe('FormCPersonFields', () => {
  it('accepts the required set, upper-cases codes and returns portal key order', () => {
    const parsed = parseFormCPersonFields(
      { passportNumber: ' a1234567 ', nationality: 'ng', gender: 'F', dateOfBirth: '1990-04-01', surname: ' Okafor ', givenNames: ' Ada ' },
      NOW,
    );
    expect(parsed).toEqual({
      ok: true,
      fields: {
        surname: 'Okafor',
        givenNames: 'Ada',
        gender: 'F',
        dateOfBirth: '1990-04-01',
        nationality: 'NG',
        passportNumber: 'A1234567',
      },
    });
    if (parsed.ok) {
      expect(Object.keys(parsed.fields)).toEqual(FORM_C_FIELD_KEYS.filter((k) => k in parsed.fields));
      expect(formCDisplayName(parsed.fields)).toBe('Ada Okafor');
    }
  });

  it('takes a passport with one name', () => {
    const { givenNames: _omit, ...single } = BASE;
    const parsed = parseFormCPersonFields(single, NOW);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(formCDisplayName(parsed.fields)).toBe('Okafor');
  });

  it('drops blank optionals', () => {
    const parsed = parseFormCPersonFields({ ...BASE, visaNumber: '  ', remarks: '' }, NOW);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.fields).not.toHaveProperty('remarks');
  });

  it('an Indian nationality is not foreign', () => {
    expect(parseFormCPersonFields({ ...BASE, nationality: 'IN' }, NOW)).toEqual({
      ok: false,
      error: FORM_C_NOT_FOREIGN,
    });
  });

  it.each([
    ['unknown key', { ...BASE, nickname: 'x' }],
    ['missing surname', { ...BASE, surname: '' }],
    ['missing gender', { ...BASE, gender: undefined }],
    ['bad gender', { ...BASE, gender: 'Z' }],
    ['over-long surname', { ...BASE, surname: 'x'.repeat(81) }],
    ['over-long remarks', { ...BASE, remarks: 'x'.repeat(201) }],
    ['over-long address', { ...BASE, addressAbroad: 'x'.repeat(201) }],
    ['bad date', { ...BASE, dateOfBirth: '1990-02-30' }],
    ['future birth date', { ...BASE, dateOfBirth: '2030-01-01' }],
    ['bad nationality', { ...BASE, nationality: 'NGA' }],
    ['bad passport chars', { ...BASE, passportNumber: 'AB*123' }],
    ['bad country', { ...BASE, arrivedFromCountry: 'xyz' }],
    ['bad phone', { ...BASE, contactInIndia: 'call me' }],
    ['non-boolean employed', { ...BASE, employedInIndia: 'yes' }],
    ['array', [BASE]],
    ['null', null],
  ])('rejects %s', (_label, raw) => {
    expect(parseFormCPersonFields(raw, NOW)).toEqual({ ok: false, error: VALIDATION_ERROR });
  });

  it('keeps optional fields in the canonical hash and ignores key order', async () => {
    const a = parseFormCPersonFields({ ...BASE, visaType: 'Tourist', portOfArrival: 'DEL' }, NOW);
    const b = parseFormCPersonFields({ portOfArrival: 'DEL', visaType: 'Tourist', ...BASE }, NOW);
    if (!a.ok || !b.ok) throw new Error('parse');
    expect(canonicalFormCJson(a.fields)).toBe(canonicalFormCJson(b.fields));
    expect(await formCFieldsSha256(a.fields)).toBe(await formCFieldsSha256(b.fields));
    const c = parseFormCPersonFields({ ...BASE, visaType: 'Business' }, NOW);
    if (!c.ok) throw new Error('parse');
    expect(await formCFieldsSha256(c.fields)).not.toBe(await formCFieldsSha256(a.fields));
  });
});

describe('Form C wire codes and helpers', () => {
  it('registers every Form C error code', () => {
    for (const code of [
      FORM_C_NOT_APPLICABLE,
      FORM_C_NOT_FOREIGN,
      FORM_C_NOT_IN_HOUSE,
      FORM_C_BOOKED_GUEST_EXISTS,
      FORM_C_DETAILS_MISSING,
      FORM_C_ALREADY_FILED,
    ]) {
      expect(isCommandError(code)).toBe(true);
    }
  });

  it('filed reference pattern', () => {
    expect(FORM_C_REFERENCE_PATTERN.test('FC/2026-11 0042')).toBe(true);
    expect(FORM_C_REFERENCE_PATTERN.test('-bad')).toBe(false);
    expect(FORM_C_REFERENCE_PATTERN.test('ref#1')).toBe(false);
  });

  it('check-in row id is deterministic', () => {
    expect(formCBookedGuestRecordId('res_1')).toBe('fcb_res_1');
  });

  it('India detection is case-insensitive and exact', () => {
    expect(isFormCCountry('IN')).toBe(true);
    expect(isFormCCountry('in')).toBe(true);
    expect(isFormCCountry('')).toBe(false);
    expect(isFormCCountry('US')).toBe(false);
    expect(isFormCCountry(undefined)).toBe(false);
  });
});
