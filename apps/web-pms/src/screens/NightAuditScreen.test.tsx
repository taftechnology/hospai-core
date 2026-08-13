import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getNightAudit = vi.fn();
const getNightAuditReport = vi.fn();
const runNightAudit = vi.fn();
const retryNightAuditStep = vi.fn();
const resolveNightAuditHalt = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getNightAudit: (...a: unknown[]) => getNightAudit(...a),
    getNightAuditReport: (...a: unknown[]) => getNightAuditReport(...a),
    runNightAudit: (...a: unknown[]) => runNightAudit(...a),
    retryNightAuditStep: (...a: unknown[]) => retryNightAuditStep(...a),
    resolveNightAuditHalt: (...a: unknown[]) => resolveNightAuditHalt(...a),
  },
  asClassified: () => ({
    class: 'server_error' as const,
    status: 500,
    body: {},
    retryAfterMs: null,
  }),
}));

vi.mock('../shell/PropertyTimeZone.js', () => ({
  usePropertyTimeZone: () => 'UTC',
}));

import { NightAuditScreen } from './NightAuditScreen.js';

const STEPS = [
  'PRE_CHECK',
  'POST_ROOM_CHARGES',
  'PROCESS_NO_SHOWS',
  'CLOSE_CASHIER_SHIFTS',
  'SNAPSHOT_REPORTS',
  'ROLL_BUSINESS_DATE',
  'ARCHIVE',
] as const;

function pendingSteps() {
  return STEPS.map((step) => ({
    step,
    status: 'PENDING' as const,
    attempt: 0,
    startedAt: null,
    completedAt: null,
    error: null,
  }));
}

function statusPayload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    businessDate: '2026-03-01',
    timelineDate: '2026-03-01',
    halted: false,
    pendingOpenCount: 0,
    closingExceptionCount: 0,
    steps: pendingSteps(),
    reports: [],
    ...overrides,
  };
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NightAuditScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

describe('NightAuditScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runNightAudit.mockResolvedValue({ ok: true });
    retryNightAuditStep.mockResolvedValue({ ok: true, status: 'COMPLETED' });
    resolveNightAuditHalt.mockResolvedValue({ ok: true, status: 'COMPLETED', halted: false });
    getNightAuditReport.mockResolvedValue({ businessDate: '2026-03-01', roomNet: 15000, taxTotal: 1200 });
  });

  afterEach(() => cleanup());

  it('25: halted → exception banner; Run disabled; Retry on FAILED; Resume enabled', async () => {
    const steps = pendingSteps();
    steps[0] = {
      ...steps[0]!,
      status: 'FAILED',
      attempt: 1,
      error: 'pending_commands_undrained',
    };
    getNightAudit.mockResolvedValue(
      statusPayload({ halted: true, pendingOpenCount: 1, steps }),
    );
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('audit-banner')).toBeTruthy());
    expect(screen.getByTestId('audit-banner').className).toContain('status-exception');
    expect((screen.getByRole('button', { name: /run night audit/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: /^resume$/i }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeTruthy();
  });

  it('25b: stale RUNNING → Resume enabled, Retry absent, Run disabled', async () => {
    const steps = pendingSteps();
    steps[0] = { ...steps[0]!, status: 'RUNNING', attempt: 1 };
    getNightAudit.mockResolvedValue(statusPayload({ halted: false, steps }));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('audit-banner')).toBeTruthy());
    expect((screen.getByRole('button', { name: /run night audit/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: /^resume$/i }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: /^retry$/i })).toBeNull();
  });

  it('26: Resume click calls resolveNightAuditHalt and invalidates night-audit', async () => {
    const steps = pendingSteps();
    steps[0] = { ...steps[0]!, status: 'FAILED', attempt: 1, error: 'seeded' };
    getNightAudit.mockResolvedValue(statusPayload({ halted: true, steps }));
    const { invalidateSpy } = renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /^resume$/i })).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^resume$/i }));
    });
    await waitFor(() => expect(resolveNightAuditHalt).toHaveBeenCalled());
    expect(resolveNightAuditHalt).toHaveBeenCalledWith(
      'prop_demo',
      '2026-03-01',
      'night-audit:resolve-halt:prop_demo:2026-03-01',
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['night-audit', 'prop_demo'] });
  });

  it('Run is disabled when businessDate is today (not due)', async () => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    getNightAudit.mockResolvedValue(statusPayload({ businessDate: today, timelineDate: today }));
    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /run night audit/i })).toBeTruthy());
    expect((screen.getByRole('button', { name: /run night audit/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(runNightAudit).not.toHaveBeenCalled();
  });

  it('report click loads getNightAuditReport and formats money', async () => {
    getNightAudit.mockResolvedValue(
      statusPayload({
        reports: [{ reportId: 'revenue', businessDate: '2026-03-01', generatedAt: 1 }],
      }),
    );
    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: 'revenue' })).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'revenue' }));
    });
    await waitFor(() => expect(getNightAuditReport).toHaveBeenCalledWith('prop_demo', '2026-03-01', 'revenue'));
    await waitFor(() => expect(screen.getByTestId('report-table')).toBeTruthy());
    expect(screen.getByTestId('report-table').textContent).toMatch(/150\.00/);
    expect(screen.getByTestId('report-table').textContent).toMatch(/12\.00/);
  });
});
