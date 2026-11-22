import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getReport = vi.fn();
const postGuestsBatch = vi.fn();
const getProperty = vi.fn();
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

const here = dirname(fileURLToPath(import.meta.url));
const arrivalsResult = {
  ok: true,
  reportId: 'front_office_arrivals',
  generatedAt: '2026-11-20T09:30:00.000Z',
  businessDate: '2026-11-20',
  currency: 'INR',
  params: { from: '2026-11-20', to: '2026-11-20' },
  columns: reportDefinition('front_office_arrivals')!.columns,
  rows: [
    {
      confirmation: 'AAAA1111',
      guest: 'g_asha',
      arrival: '2026-11-20',
      departure: '2026-11-22',
      nights: 2,
      adults: 2,
      children: 0,
      roomType: 'King',
      room: '101',
      ratePlan: 'Best Available Rate',
      source: 'Walk-in',
      status: 'confirmed',
      advancePaid: 150000,
    },
    {
      confirmation: 'BBBB2222',
      guest: 'g_ravi',
      arrival: '2026-11-20',
      departure: '2026-11-21',
      nights: 1,
      adults: 1,
      children: 1,
      roomType: 'King',
      room: null,
      ratePlan: 'Best Available Rate',
      source: null,
      status: 'checked_in',
      advancePaid: 0,
    },
  ],
  totals: { nights: 3, adults: 3, children: 1, advancePaid: 150000 },
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
const ready = () => waitFor(() => expect(screen.getByLabelText(/^(From|Date)$/)).not.toHaveValue(''));
const setDate = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('ReportRunnerScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getReport.mockResolvedValue(arrivalsResult);
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: {
        g_asha: { kind: 'resolved', displayName: 'Asha Rao' },
        g_ravi: { kind: 'resolved', displayName: 'Ravi "RK" Kumar, Jr' },
      },
    });
    getProperty.mockResolvedValue({ ok: true, property: { propertyId: 'prop_demo', name: 'Lakeview Residency' }, businessDate: '2026-11-20' });
  });
  afterEach(() => cleanup());

  it('is titled by the report, defaults to the business date, and shows the idle state before a run', async () => {
    renderRunner('front_office_arrivals');
    await ready();
    expect(screen.getByRole('heading', { level: 1, name: 'Arrivals' })).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toHaveValue('2026-11-20');
    expect(screen.getByLabelText('To')).toHaveValue('2026-11-20');
    expect(screen.getByText('Up to 31 days at a time.')).toBeInTheDocument();
    expect(screen.getByTestId('report-idle')).toBeInTheDocument();
    expect(getReport).not.toHaveBeenCalled();
    expect((screen.getByTestId('report-print') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('report-csv') as HTMLButtonElement).disabled).toBe(true);
  });

  it('fills the dates from the property business date, not the local date, and keeps a change', async () => {
    getProperty.mockResolvedValue({
      ok: true,
      property: { propertyId: 'prop_demo', name: 'Lakeview Residency' },
      businessDate: '2026-11-19', // night audit has not rolled the day; the local date is 2026-11-20
    });
    renderRunner('front_office_arrivals');
    // Nothing is filled, and Run is off, until the business date is known.
    expect(screen.getByLabelText('From')).toHaveValue('');
    expect((screen.getByTestId('report-run') as HTMLButtonElement).disabled).toBe(true);
    await ready();
    expect(screen.getByLabelText('From')).toHaveValue('2026-11-19');
    expect(screen.getByLabelText('To')).toHaveValue('2026-11-19');
    setDate('To', '2026-11-21');
    await client.invalidateQueries({ queryKey: ['property', 'prop_demo'] });
    expect(screen.getByLabelText('To')).toHaveValue('2026-11-21');
    run();
    await waitFor(() => expect(getReport).toHaveBeenCalled());
    expect(getReport.mock.calls[0]![2]).toEqual({ from: '2026-11-19', to: '2026-11-21' });
  });

  it('puts the span hint once under the field row and the actions together in their own row', async () => {
    renderRunner('front_office_arrivals');
    await ready();
    expect(screen.getAllByText('Up to 31 days at a time.')).toHaveLength(1);
    const hint = screen.getByTestId('report-span-hint');
    const run = screen.getByTestId('report-run');
    const bars = document.querySelectorAll('.ui-toolbar');
    expect(bars).toHaveLength(2);
    expect(bars[0]!.contains(screen.getByLabelText('From'))).toBe(true);
    expect(bars[0]!.contains(screen.getByLabelText('To'))).toBe(true);
    expect(bars[0]!.contains(hint)).toBe(false);
    for (const id of ['report-run', 'report-print', 'report-csv']) expect(bars[1]!.contains(screen.getByTestId(id))).toBe(true);
    expect(bars[0]!.contains(run)).toBe(false);
  });

  it('runs with the form values and caches under the tenant, report and params key', async () => {
    renderRunner('front_office_arrivals');
    await ready();
    setDate('To', '2026-11-22');
    run();
    await waitFor(() => expect(screen.getByTestId('report-card')).toBeInTheDocument());
    expect(getReport).toHaveBeenCalledTimes(1);
    const [propertyId, def, params] = getReport.mock.calls[0]!;
    expect(propertyId).toBe('prop_demo');
    expect(def.id).toBe('front_office_arrivals');
    expect(params).toEqual({ from: '2026-11-20', to: '2026-11-22' });
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toContainEqual([
      'report',
      'prop_demo',
      'front_office_arrivals',
      { from: '2026-11-20', to: '2026-11-22' },
    ]);
  });

  it('renders the table with resolved names, formatted money, words for status, and a totals row', async () => {
    renderRunner('front_office_arrivals');
    await ready();
    run();
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    expect(screen.getByText('Ravi "RK" Kumar, Jr')).toBeInTheDocument();
    expect(postGuestsBatch).toHaveBeenCalledWith('prop_demo', ['g_asha', 'g_ravi']);
    const row = screen.getByText('Asha Rao').closest('tr')!;
    expect(within(row).getByText('AAAA1111')).toBeInTheDocument();
    expect(within(row).getByText('Confirmed')).toBeInTheDocument();
    expect(within(row).getByText(/1,500\.00/)).toBeInTheDocument();
    expect(within(row).queryByText('g_asha')).toBeNull();
    const totals = screen.getByTestId('report-totals');
    expect(within(totals).getByText('Total')).toBeInTheDocument();
    expect(within(totals).getByText(/1,500\.00/)).toBeInTheDocument();
    // The card names the hotel, the parameters and the generation time.
    expect(screen.getByTestId('report-property')).toHaveTextContent('Lakeview Residency');
    expect(screen.getByTestId('report-params')).toHaveTextContent('20 Nov 2026');
    expect(screen.getByTestId('report-generated')).toHaveTextContent(/Generated .*2 rows/);
  });

  it('downloads a CSV built from the rows on screen, with names and decimal money', async () => {
    renderRunner('front_office_arrivals');
    await ready();
    run();
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('report-csv'));
    expect(downloadTextFile).toHaveBeenCalledTimes(1);
    const [name, text] = downloadTextFile.mock.calls[0]!;
    expect(name).toBe('front_office_arrivals_2026-11-20_2026-11-20.csv');
    const lines = (text as string).split('\r\n');
    expect(lines[0]).toBe(
      'Confirmation,Guest,Arrival,Departure,Nights,Adults,Children,Room type,Room,Rate plan,Source,Status,Advance paid,Currency',
    );
    expect(lines[1]).toBe('AAAA1111,Asha Rao,2026-11-20,2026-11-22,2,2,0,King,101,Best Available Rate,Walk-in,Confirmed,1500.00,INR');
    expect(lines[2]).toContain('"Ravi ""RK"" Kumar, Jr"');
    expect(lines[3]).toBe('Total,,,,3,3,1,,,,,,1500.00,INR');
  });

  it('prints through window.print and the stylesheet isolates only the report card', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderRunner('front_office_arrivals');
    await ready();
    run();
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('report-print'));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
    const css = readFileSync(join(here, '..', 'styles.css'), 'utf8');
    const printBlock = css.slice(css.lastIndexOf('@media print'));
    expect(printBlock).toMatch(/\.report-card,\s*\.report-card \*[^}]*visibility: visible/);
    expect(printBlock).toMatch(/\.report-card \{[^}]*position: absolute/s);
    expect(printBlock).toMatch(/body \* \{\s*visibility: hidden/);
  });

  it('rejects a span over the limit before any request, in words', async () => {
    renderRunner('front_office_arrivals');
    await ready();
    setDate('To', '2026-12-31');
    run();
    expect(screen.getByText('This report covers at most 31 days. Choose a shorter range.')).toBeInTheDocument();
    expect(getReport).not.toHaveBeenCalled();
  });

  it('keeps empty, error and over-cap as three different states', async () => {
    getReport.mockResolvedValueOnce({ ...arrivalsResult, rows: [], totals: null });
    const { unmount } = renderRunner('front_office_arrivals');
    await ready();
    run();
    expect(await screen.findByTestId('report-empty')).toHaveTextContent('Nothing to report');
    expect(screen.queryByTestId('report-error')).toBeNull();
    expect(screen.queryByTestId('report-over-cap')).toBeNull();
    expect((screen.getByTestId('report-csv') as HTMLButtonElement).disabled).toBe(true);
    unmount();

    getReport.mockRejectedValueOnce(
      new ClassifiedError({ class: 'fail_closed', status: 503, body: {}, retryAfterMs: null }),
    );
    const second = renderRunner('front_office_arrivals');
    await ready();
    run();
    expect(await screen.findByTestId('report-error')).toHaveTextContent('Property unreachable.');
    expect(screen.queryByTestId('report-empty')).toBeNull();
    expect(screen.queryByTestId('report-over-cap')).toBeNull();
    second.unmount();

    getReport.mockRejectedValueOnce(
      new ClassifiedError({
        class: 'client_error' as never,
        status: 422,
        body: { ok: false, error: 'limit_exceeded', limit: 'rows', max: 2000 },
        retryAfterMs: null,
      }),
    );
    renderRunner('front_office_arrivals');
    await ready();
    run();
    const over = await screen.findByTestId('report-over-cap');
    expect(over).toHaveTextContent('More than 2,000 rows');
    expect(screen.queryByTestId('report-error')).toBeNull();
    expect(screen.queryByTestId('report-empty')).toBeNull();
  });

  it('a single-date report asks for one date; an unknown id says there is no such report', async () => {
    getReport.mockResolvedValueOnce({
      ...arrivalsResult,
      reportId: 'front_office_in_house',
      params: { date: '2026-11-20' },
      columns: reportDefinition('front_office_in_house')!.columns,
      rows: [
        { guest: 'g_asha', room: '101', roomType: 'King', arrival: '2026-11-20', departure: '2026-11-22', adults: 2, children: 0, balance: 5000, companyWindow: 'Yes' },
      ],
      totals: { adults: 2, children: 0, balance: 5000 },
    });
    const first = renderRunner('front_office_in_house');
    await ready();
    expect(screen.getByLabelText('Date')).toHaveValue('2026-11-20');
    run();
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    expect(getReport.mock.calls[0]![2]).toEqual({ date: '2026-11-20' });
    first.unmount();

    renderRunner('nope');
    expect(screen.getByTestId('report-unknown')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Report not found' })).toBeInTheDocument();
  });
});
