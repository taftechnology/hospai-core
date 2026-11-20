import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RegistrationCard, RegistrationCardDocument } from './registration-card.js';

const baseReservation = {
  reservationId: 'res_abc123456789',
  roomTypeId: 'rt_1',
  guestRef: 'g1',
  piiKeyId: 'k1',
  arrivalDate: '2026-08-10',
  departureDate: '2026-08-12',
  status: 'checked_in' as const,
  roomId: 'room_uuid_should_not_print',
  adults: 2,
  children: 0,
  vipFlag: false,
  dndFlag: false,
  createdAt: 1,
  updatedAt: 1,
};

const cardPayload = {
  ok: true as const,
  confirmationToken: 'abcd1234',
  arrivalDate: '2026-08-10',
  departureDate: '2026-08-12',
  nights: 2,
  adults: 2,
  children: 0,
  roomTypeName: 'King Room',
  roomCode: '101',
  ratePlanName: 'Best Available Rate',
  packageName: null,
  inclusionLabels: ['Breakfast'],
  specialRequests: 'High floor',
  vipFlag: false,
  presentation: {
    template: 'STANDARD' as const,
    headerText: '',
    footerText: '',
    show: {
      ratePlan: true,
      inclusions: true,
      specialRequests: true,
      idDocument: true,
      signature: true,
    },
  },
  guestDisplayName: 'Ada Lovelace',
  idDocument: { type: 'PASSPORT', maskedNumber: '•••• 3456' },
  reservationId: 'res_full_uuid_should_not_appear_in_card',
  roomId: 'room_uuid_should_not_appear',
};

describe('RegistrationCardDocument', () => {
  afterEach(() => cleanup());

  it('printed DOM has no room UUID or reservation UUID', () => {
    render(
      <RegistrationCardDocument
        propertyName="Harbor Inn"
        data={cardPayload}
      />,
    );
    const card = screen.getByTestId('reg-card');
    expect(card.textContent).not.toMatch(/res_full_uuid/);
    expect(card.textContent).not.toMatch(/room_uuid/);
    expect(card.textContent).toMatch(/101/);
    expect(card.textContent).toMatch(/abcd1234/);
  });

  it('template override changes layout class/testid', () => {
    const { rerender } = render(
      <RegistrationCardDocument propertyName="Harbor Inn" data={cardPayload} />,
    );
    expect(screen.getByTestId('reg-card').getAttribute('data-template')).toBe('STANDARD');
    expect(screen.getByTestId('reg-card').className).toMatch(/reg-card--standard/);

    rerender(
      <RegistrationCardDocument
        propertyName="Harbor Inn"
        data={cardPayload}
        templateOverride="COMPACT"
      />,
    );
    expect(screen.getByTestId('reg-card').getAttribute('data-template')).toBe('COMPACT');
    expect(screen.getByTestId('reg-card').className).toMatch(/reg-card--compact/);
  });
});

describe('RegistrationCard (legacy Folio bridge)', () => {
  afterEach(() => cleanup());

  it('T9: reg card never renders room UUID in print content', () => {
    render(
      <RegistrationCard
        propertyName="Harbor Inn"
        reservation={baseReservation}
        displayName="Ada Lovelace"
      />,
    );
    const card = screen.getByTestId('reg-card');
    expect(card.textContent).not.toContain('room_uuid_should_not_print');
    expect(screen.queryByText(/Room room_uuid/i)).toBeNull();
  });

  it('T10: reg card shows room code when roomLabel provided', () => {
    render(
      <RegistrationCard
        propertyName="Harbor Inn"
        reservation={baseReservation}
        displayName="Ada Lovelace"
        roomLabel="101"
        roomTypeLabel="King Room"
        ratePlanLabel="Best Available Rate"
      />,
    );
    const field = (label: string) =>
      screen.getByText(label, { selector: '.ui-stat-field__label' }).parentElement?.textContent;
    expect(field('Room')).toBe('Room101');
    expect(field('Room type')).toBe('Room typeKing Room');
    expect(field('Rate plan')).toBe('Rate planBest Available Rate');
    expect(field('Nights')).toBe('Nights2');
    expect(field('Guests')).toBe('Guests2 adults');
  });

  it('R2.4: unassigned room and missing plan read as words, never ids', () => {
    render(
      <RegistrationCard
        propertyName="Harbor Inn"
        reservation={{ ...baseReservation, roomId: null }}
        displayName="Ada Lovelace"
      />,
    );
    const card = screen.getByTestId('reg-card');
    expect(card.textContent).toContain('Not assigned');
    expect(card.textContent).not.toMatch(/rt_1|room_uuid/);
    expect(screen.getByTestId('reg-card-signature').textContent).toMatch(/Guest signature/);
  });

  it('T11: print stylesheet hides non-reg-card content and isolates print-doc', () => {
    const cssPath = join(dirname(fileURLToPath(import.meta.url)), '../styles.css');
    const printCss = readFileSync(cssPath, 'utf8');
    expect(printCss).toMatch(/@media print[\s\S]*\.reg-card/);
    expect(printCss).toMatch(/@media print[\s\S]*\.print-doc/);
    expect(printCss).toMatch(/visibility:\s*hidden/);
  });
});
