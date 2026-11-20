import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getReport = vi.fn();
const postGuestsBatch = vi.fn();
const getProperty = vi.fn();
const getMe = vi.fn();
const listPropertyMembers = vi.fn();
const searchDesk = vi.fn();
const downloadTextFile = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) =>
    err instanceof ClassifiedError
      ? err.classified
      : { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null },
  api: {
    getReport: (...a: unknown[]) => getReport(...a),
    postGuestsBatch: (...a: unknown[]) => postGuestsBatch(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
    getMe: (...a: unknown[]) => getMe(...a),
    listPropertyMembers: (...a: unknown[]) => listPropertyMembers(...a),
    searchDesk: (...a: unknown[]) => searchDesk(...a),
  },
}));
vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});
vi.mock('../status/property-local-today.js', () => ({ propertyLocalToday: () => '2026-11-20' }));
vi.mock('../reports/download-file.js', () => ({
  downloadTextFile: (...a: unknown[]) => downloadTextFile(...a),
}));

import { reportDefinition } from '@hospai/contracts';
import { ReportRunnerScreen } from './ReportRunnerScreen.js';

const me = (permissions: string[]) => ({
  ok: true,
  orgId: 'org_demo',
  propertyId: 'prop_demo',
  userId: 'u',
  role: 'staff',
  permissions,
  orgPermissions: [],
});

const folioResult = {
  ok: true,
  reportId: 'cashier_detailed_folio',
  generatedAt: '2026-11-20T09:30:00.000Z',
  businessDate: '2026-11-20',
  currency: 'INR',
  params: { reservationId: 'res_1' },
  columns: reportDefinition('cashier_detailed_folio')!.columns,
  stay: {
    confirmation: 'CCCC3333',
    guest: 'g_asha',
    arrival: '2026-11-20',
    departure: '2026-11-22',
    status: 'checked_in',
    room: '101',
    roomType: 'King',
  },
  rows: [
    { date: '2026-11-20', window: 'Guest', code: 'Room', description: 'Room', charge: 10000, tax: null, payment: null, balance: 10000 },
    { date: '2026-11-20', window: 'Guest', code: 'Tax', description: 'Tax · Room', charge: null, tax: 1000, payment: null, balance: 11000 },
    { date: '2026-11-20', window: 'Guest', code: 'Payment', description: 'Cash payment', charge: null, tax: null, payment: -4000, balance: 7000 },
    { subtotal: 1, date: null, window: 'Guest', code: null, description: 'Window total', charge: 10000, tax: 1000, payment: -4000, balance: 7000 },
  ],
  totals: { description: 'Stay total', charge: 10000, tax: 1000, payment: -4000, balance: 7000 },
};

const auditResult = {
  ok: true,
  reportId: 'cashier_audit',
  generatedAt: '2026-11-20T09:30:00.000Z',
  businessDate: '2026-11-20',
  currency: 'INR',
  params: { from: '2026-11-20', to: '2026-11-20', tender: 'CARD', cashier: 'user_ann' },
  columns: reportDefinition('cashier_audit')!.columns,
  rows: [
    {
      at: Date.parse('2026-11-20T09:05:00Z'),
      businessDate: '2026-11-20',
      cashier: 'user_ann',
      shiftOpenedAt: Date.parse('2026-11-20T08:00:00Z'),
      tender: 'Card',
      kind: 'Refund',
      amount: -100000,
      reservation: 'CCCC3333',
      guest: 'g_asha',
      reference: null,
    },
    {
      at: Date.parse('2026-11-20T09:10:00Z'),
      businessDate: '2026-11-20',
      cashier: 'user_gone',
      shiftOpenedAt: null,
      tender: 'Card',
      kind: 'Payment received',
      amount: 250000,
      reservation: 'CCCC3333',
      guest: 'g_asha',
      reference: null,
    },
  ],
  totals: { amount: 150000 },
};

let client: QueryClient;
function renderRunner(reportId: string) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/reports/${reportId}`]}>
        <Routes>
          <Route path="/reports/:reportId" element={<ReportRunnerScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const run = () => fireEvent.click(screen.getByTestId('report-run'));

describe('ReportRunnerScreen: Part B cashier and financial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g_asha: { kind: 'resolved', displayName: 'Asha Rao' } },
    });
    getProperty.mockResolvedValue({
      ok: true,
      property: { propertyId: 'prop_demo', name: 'Lakeview Residency' },
      businessDate: '2026-11-20',
    });
    getMe.mockResolvedValue(me(['folio:read', 'staff:read']));
    listPropertyMembers.mockResolvedValue({
      members: [
        { userId: 'user_ann', displayName: 'Ann Cashier', email: 'ann@example.test' },
        { userId: 'user_bob', displayName: null, email: 'bob@example.test' },
      ],
    });
    searchDesk.mockResolvedValue({
      ok: true,
      items: [
        {
          reservationId: 'res_1',
          displayName: 'Asha Rao',
          roomCode: '101',
          status: 'checked_in',
          arrivalDate: '2026-11-20',
          departureDate: '2026-11-22',
        },
      ],
    });
    getReport.mockImplementation((_p: string, def: { id: string }) =>
      Promise.resolve(def.id === 'cashier_detailed_folio' ? folioResult : auditResult),
    );
  });
  afterEach(() => cleanup());

  it('detailed folio: no run without a stay; the picker uses the desk search and fills the key', async () => {
    renderRunner('cashier_detailed_folio');
    expect(screen.getByRole('heading', { level: 1, name: 'Detailed folio' })).toBeInTheDocument();
    expect(screen.getByTestId('report-idle')).toHaveTextContent('Find a stay above, then press Run.');
    expect(screen.queryByLabelText('From')).toBeNull();
    await waitFor(() => expect((screen.getByTestId('report-run') as HTMLButtonElement).disabled).toBe(false));
    run();
    expect(screen.getByTestId('report-form-error')).toHaveTextContent('Choose a reservation.');
    expect(getReport).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('report-reservation-search'), { target: { value: 'asha' } });
    const hits = await screen.findByTestId('report-reservation-hits');
    expect(searchDesk).toHaveBeenCalledWith('prop_demo', 'asha');
    fireEvent.click(within(hits).getByRole('button', { name: /Asha Rao · Room 101/ }));
    expect(screen.getByTestId('report-reservation-picked')).toHaveTextContent('Asha Rao · Room 101');
    run();
    await waitFor(() => expect(screen.getByTestId('report-card')).toBeInTheDocument());
    const [propertyId, def, params] = getReport.mock.calls[0]!;
    expect(propertyId).toBe('prop_demo');
    expect(def.id).toBe('cashier_detailed_folio');
    expect(params).toEqual({ reservationId: 'res_1' });
    expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toContainEqual([
      'report',
      'prop_demo',
      'cashier_detailed_folio',
      { reservationId: 'res_1' },
    ]);
    // The picker can be reopened.
    fireEvent.click(screen.getByTestId('report-reservation-change'));
    expect(screen.getByTestId('report-reservation-search')).toBeInTheDocument();
  });

  it('detailed folio prints with a property header and a stay header; subtotal rows are bold; money is signed', async () => {
    renderRunner('cashier_detailed_folio');
    fireEvent.change(await screen.findByTestId('report-reservation-search'), { target: { value: 'asha' } });
    fireEvent.click(await screen.findByRole('button', { name: /Asha Rao · Room 101/ }));
    run();
    const card = await screen.findByTestId('report-card');
    expect(within(card).getByTestId('report-property')).toHaveTextContent('Lakeview Residency');
    const stay = within(card).getByTestId('report-stay');
    await waitFor(() => expect(stay).toHaveTextContent('Asha Rao · Booking CCCC3333'));
    expect(stay).toHaveTextContent('Room 101 · King');
    expect(stay).toHaveTextContent('20/11/2026 to 22/11/2026');
    expect(stay).toHaveTextContent('In house');
    expect(within(card).queryByTestId('report-params')).toBeNull();
    const subtotal = within(card).getByText('Window total').closest('tr')!;
    expect(subtotal.querySelector('strong')).not.toBeNull();
    expect(within(card).getByText('Tax · Room').closest('tr')).toHaveTextContent('10.00');
    expect(within(screen.getByTestId('report-totals')).getByText('Stay total')).toBeInTheDocument();
    // The guest's name is resolved through the property batch, never taken from the report.
    expect(postGuestsBatch).toHaveBeenCalledWith('prop_demo', ['g_asha']);

    fireEvent.click(screen.getByTestId('report-csv'));
    const [name, text] = downloadTextFile.mock.calls[0]!;
    expect(name).toBe('cashier_detailed_folio.csv');
    const lines = (text as string).split('\r\n');
    expect(lines[0]).toBe('Date,Window,Charge type,Description,Charge,Tax,Payment,Balance,Currency');
    expect(lines[3]).toBe('2026-11-20,Guest,Payment,Cash payment,,,-40.00,70.00,INR');
    expect(lines.at(-2)).toBe('Total,,,Stay total,100.00,10.00,-40.00,70.00,INR');
  });

  it('cashier audit: the payment type and cashier filters go to the server and show in words; staff and times are formatted', async () => {
    renderRunner('cashier_audit');
    await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue('2026-11-20'));
    const cashier = await screen.findByLabelText('Cashier');
    await waitFor(() => expect(within(cashier).getByRole('option', { name: 'Ann Cashier' })).toBeInTheDocument());
    expect(within(cashier).getByRole('option', { name: 'bob@example.test' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Payment type'), { target: { value: 'CARD' } });
    fireEvent.change(cashier, { target: { value: 'user_ann' } });
    run();
    await waitFor(() => expect(screen.getByTestId('report-card')).toBeInTheDocument());
    expect(getReport.mock.calls[0]![2]).toEqual({
      from: '2026-11-20',
      to: '2026-11-20',
      tender: 'CARD',
      cashier: 'user_ann',
    });
    expect(screen.getByTestId('report-params')).toHaveTextContent('Payment type: Card');
    expect(screen.getByTestId('report-params')).toHaveTextContent('Cashier: Ann Cashier');
    // A cashier the member list does not know is a word, never the id.
    const rows = screen.getAllByRole('row');
    expect(rows.some((r) => r.textContent?.includes('Ann Cashier'))).toBe(true);
    expect(screen.getByText('Staff member')).toBeInTheDocument();
    expect(screen.queryByText('user_gone')).toBeNull();
    expect(rows[1]!.textContent).toContain('20/11/2026, 9:05 am');
    expect(rows[1]!.textContent).toContain('−₹1,000.00');
    await waitFor(() => expect(screen.getAllByText('Asha Rao').length).toBe(2));

    fireEvent.click(screen.getByTestId('report-csv'));
    const lines = (downloadTextFile.mock.calls[0]![1] as string).split('\r\n');
    expect(lines[0]).toBe('Time,Business date,Cashier,Shift opened,Payment type,What happened,Amount,Reservation,Guest,Reference,Currency');
    expect(lines[1]).toBe(
      '2026-11-20T09:05:00.000Z,2026-11-20,Ann Cashier,2026-11-20T08:00:00.000Z,Card,Refund,-1000.00,CCCC3333,Asha Rao,,INR',
    );
    expect(lines[2]).toBe('2026-11-20T09:10:00.000Z,2026-11-20,Staff member,,Card,Payment received,2500.00,CCCC3333,Asha Rao,,INR');
    expect(lines[3]).toBe('Total,,,,,,1500.00,,,,INR');
    expect(downloadTextFile.mock.calls[0]![0]).toBe('cashier_audit_2026-11-20_2026-11-20.csv');
  });

  it('a viewer who cannot read staff gets no cashier filter and a word for every staff member', async () => {
    getMe.mockResolvedValue(me(['folio:read']));
    renderRunner('cashier_audit');
    await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue('2026-11-20'));
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    expect(screen.queryByLabelText('Cashier')).toBeNull();
    run();
    await waitFor(() => expect(screen.getByTestId('report-card')).toBeInTheDocument());
    expect(listPropertyMembers).not.toHaveBeenCalled();
    expect(screen.getAllByText('Staff member')).toHaveLength(2);
    expect(getReport.mock.calls[0]![2]).toEqual({ from: '2026-11-20', to: '2026-11-20' });
  });

  it('reports without staff in them never ask who the viewer is', async () => {
    getReport.mockResolvedValue({
      ...auditResult,
      reportId: 'cashier_tax_report',
      params: { from: '2026-11-20', to: '2026-11-20' },
      columns: reportDefinition('cashier_tax_report')!.columns,
      rows: [{ date: '2026-11-20', taxCode: 'Tax', taxable: 9000, tax: 900 }],
      totals: { tax: 900 },
    });
    renderRunner('cashier_tax_report');
    await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue('2026-11-20'));
    run();
    await waitFor(() => expect(screen.getByTestId('report-card')).toBeInTheDocument());
    expect(getMe).not.toHaveBeenCalled();
    expect(listPropertyMembers).not.toHaveBeenCalled();
  });
});
