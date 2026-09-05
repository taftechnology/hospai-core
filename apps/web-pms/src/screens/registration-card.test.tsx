import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RegistrationCard } from './registration-card.js';

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

describe('RegistrationCard', () => {
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
      />,
    );
    expect(screen.getByText(/Room 101/)).toBeTruthy();
  });

  it('T11: print stylesheet hides non-reg-card content', () => {
    const cssPath = join(dirname(fileURLToPath(import.meta.url)), '../styles.css');
    const printCss = readFileSync(cssPath, 'utf8');
    expect(printCss).toMatch(/@media print[\s\S]*\.reg-card/);
    expect(printCss).toMatch(/visibility:\s*hidden/);
  });
});
