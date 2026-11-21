import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getManagerReport = vi.fn();
const getProperty = vi.fn();
const downloadTextFile = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) =>
    err instanceof ClassifiedError
      ? err.classified
      : { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null },
  api: {
    getManagerReport: (...a: unknown[]) => getManagerReport(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
  },
}));
vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});
vi.mock('../reports/download-file.js', () => ({
  downloadTextFile: (...a: unknown[]) => downloadTextFile(...a),
}));

import { managerReportQueryKey } from '../reports/manager-report-model.js';
import { ManagerReportScreen } from './ManagerReportScreen.js';

const col = (id: 'day' | 'mtd' | 'ytd', from: string, recordedDays: number, notRecorded: string[] = []) => ({
  id,
  from,
  to: '2026-11-19',
  recordedDays,
  notRecorded,
});

const base = {
  ok: true,
  generatedAt: '2026-11-20T09:30:00.000Z',
  businessDate: '2026-11-20',
  currency: 'INR',
  date: '2026-11-19',
  fiscalYearStart: '2026-04-01',
};

const full = {
  ...base,
  columns: [
    col('day', '2026-11-19', 1),
    col('mtd', '2026-11-01', 2, ['2026-11-05']),
    col('ytd', '2026-04-01', 2, ['2026-11-05', '2026-11-04']),
  ],
  rows: [
    { rowId: 'rooms_sold', label: 'Rooms sold', section: 'rooms', kind: 'count', scale: 0, decimals: null, values: { day: 3, mtd: 6, ytd: 6 } },
    { rowId: 'occupancy_pct', label: 'Occupancy %', section: 'rooms', kind: 'percent', scale: 1, decimals: 1, values: { day: 750, mtd: 667, ytd: null } },
    { rowId: 'arrivals', label: 'Check-ins', section: 'movements', kind: 'count', scale: 0, decimals: null, values: { day: 2, mtd: 4, ytd: 4 } },
    { rowId: 'room_revenue', label: 'Room revenue', section: 'revenue', kind: 'money', scale: 0, decimals: null, values: { day: 30000, mtd: 60000, ytd: 60000 } },
    { rowId: 'adr', label: 'ADR', section: 'revenue', kind: 'money', scale: 0, decimals: 0, values: { day: 10000, mtd: 10000, ytd: 10000 } },
    { rowId: 'source_nights', label: 'OTA: room nights', section: 'source_mix', kind: 'count', scale: 0, decimals: null, values: { day: 1, mtd: 2, ytd: 2 } },
  ],
};

let client: QueryClient;
function renderScreen() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/reports/manager']}>
        <Routes>
          <Route path="/reports/manager" element={<ManagerReportScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ManagerReportScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProperty.mockResolvedValue({
      ok: true,
      property: { propertyId: 'prop_demo', name: 'Lakeview Residency' },
      businessDate: '2026-11-20',
    });
    getManagerReport.mockResolvedValue(full);
  });
  afterEach(() => cleanup());

  it('defaults to the last closed date from the business date, runs once and caches by tenant and date', async () => {
    renderScreen();
    expect(screen.getByRole('heading', { level: 1, name: 'Manager Report' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('manager-date')).toHaveValue('2026-11-19'));
    await screen.findByTestId('manager-card');
    expect(getManagerReport).toHaveBeenCalledTimes(1);
    expect(getManagerReport).toHaveBeenCalledWith('prop_demo', '2026-11-19');
    expect(client.getQueryData(managerReportQueryKey('prop_demo', '2026-11-19'))).toEqual(full);
    expect(screen.getByTestId('manager-property')).toHaveTextContent('Lakeview Residency');
  });

  it('lays the rows out by section in Day, month and year columns, in words', async () => {
    renderScreen();
    await screen.findByTestId('manager-card');
    for (const s of ['rooms', 'movements', 'revenue', 'source_mix']) {
      expect(screen.getByTestId(`manager-section-${s}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('manager-section-guests')).toBeNull();
    expect(screen.getByRole('columnheader', { name: /Day/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Month to date/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Year to date/ })).toBeInTheDocument();
    const occ = within(screen.getByTestId('manager-row-occupancy_pct')).getAllByRole('cell');
    expect(occ.map((c) => c.textContent)).toEqual(['Occupancy %', '75.0%', '66.7%', '—']);
    // The relabelled row shows its label, not its id.
    expect(within(screen.getByTestId('manager-row-arrivals')).getByText('Check-ins')).toBeInTheDocument();
    // A ratio shows its configured decimals.
    expect(within(screen.getByTestId('manager-row-adr')).getAllByRole('cell')[1]).toHaveTextContent(/₹\s?100$/);
    expect(within(screen.getByTestId('manager-row-room_revenue')).getAllByRole('cell')[1]).toHaveTextContent(/₹\s?300\.00$/);
  });

  it('says which days are not recorded', async () => {
    renderScreen();
    const note = await screen.findByTestId('manager-not-recorded');
    expect(within(note).getByTestId('manager-not-recorded-mtd')).toHaveTextContent('Month to date');
    expect(within(note).getByTestId('manager-not-recorded-ytd')).toHaveTextContent('05/11/2026, 04/11/2026');
    expect(screen.queryByTestId('manager-not-recorded-day')).toBeNull();
  });

  it('prints and downloads the CSV of what is on screen', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderScreen();
    await screen.findByTestId('manager-card');
    fireEvent.click(screen.getByTestId('manager-print'));
    expect(print).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('manager-csv'));
    expect(downloadTextFile).toHaveBeenCalledTimes(1);
    const [name, text] = downloadTextFile.mock.calls[0] as [string, string];
    expect(name).toBe('manager_report_2026-11-19.csv');
    expect(text).toContain('Rooms,Occupancy %,75.0,66.7,');
    expect(text).toContain('Revenue,ADR,100,100,100,INR');
    print.mockRestore();
  });

  it('runs another date from the form and keys it separately', async () => {
    renderScreen();
    await screen.findByTestId('manager-card');
    fireEvent.change(screen.getByTestId('manager-date'), { target: { value: '2026-11-10' } });
    fireEvent.click(screen.getByTestId('manager-run'));
    await waitFor(() => expect(getManagerReport).toHaveBeenCalledWith('prop_demo', '2026-11-10'));
    expect(client.getQueryData(managerReportQueryKey('prop_demo', '2026-11-10'))).toBeDefined();
    expect(client.getQueryData(managerReportQueryKey('prop_demo', '2026-11-19'))).toBeDefined();
  });

  it('asks for a date when the field is cleared', async () => {
    renderScreen();
    await screen.findByTestId('manager-card');
    fireEvent.change(screen.getByTestId('manager-date'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('manager-run'));
    expect(await screen.findByText('Choose a date.')).toBeInTheDocument();
    expect(getManagerReport).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state, not a table, when no day is recorded; print and CSV are off', async () => {
    getManagerReport.mockResolvedValue({
      ...base,
      columns: [col('day', '2026-11-19', 0, ['2026-11-19']), col('mtd', '2026-11-01', 0, ['2026-11-19']), col('ytd', '2026-04-01', 0, ['2026-11-19'])],
      rows: [{ rowId: 'rooms_sold', label: 'Rooms sold', section: 'rooms', kind: 'count', scale: 0, decimals: null, values: { day: null, mtd: null, ytd: null } }],
    });
    renderScreen();
    expect(await screen.findByTestId('manager-none')).toBeInTheDocument();
    expect(screen.queryByTestId('manager-card')).toBeNull();
    expect(screen.getByTestId('manager-print')).toBeDisabled();
    expect(screen.getByTestId('manager-csv')).toBeDisabled();
  });

  it('shows an error alert, in words, when the read fails', async () => {
    getManagerReport.mockRejectedValue(
      new ClassifiedError({ class: 'forbidden', status: 403, body: { error: 'forbidden', permission: 'night_audit:run' }, retryAfterMs: null }),
    );
    renderScreen();
    const alert = await screen.findByTestId('manager-error');
    expect(alert.textContent ?? '').not.toMatch(/\{|forbidden"|class/);
    expect(screen.queryByTestId('manager-none')).toBeNull();
  });
});
