import { ClassifiedError } from '@hospai/client-core';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type Query } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STEP_LABELS } from '../copy/night-audit-step-labels.js';

const getNightAudit = vi.fn();
const getNightAuditReport = vi.fn();
const getNightAuditCheckLog = vi.fn();
const getMe = vi.fn();
const runNightAudit = vi.fn();
const retryNightAuditStep = vi.fn();
const resolveNightAuditHalt = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getNightAudit: (...a: unknown[]) => getNightAudit(...a),
    getNightAuditReport: (...a: unknown[]) => getNightAuditReport(...a),
    getNightAuditCheckLog: (...a: unknown[]) => getNightAuditCheckLog(...a),
    getMe: (...a: unknown[]) => getMe(...a),
    runNightAudit: (...a: unknown[]) => runNightAudit(...a),
    retryNightAuditStep: (...a: unknown[]) => retryNightAuditStep(...a),
    resolveNightAuditHalt: (...a: unknown[]) => resolveNightAuditHalt(...a),
  },
  asClassified: (err: unknown) => {
    if (err && typeof err === 'object' && 'classified' in err) {
      return (err as { classified: unknown }).classified;
    }
    return {
      class: 'server_error' as const,
      status: 500,
      body: {},
      retryAfterMs: null,
    };
  },
}));

vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

import { NightAuditScreen } from './NightAuditScreen.js';

const STEPS = [
  'PRE_CHECK',
  'POST_ROOM_CHARGES',
  'PROCESS_NO_SHOWS',
  'AUTO_TRANSFER',
  'CLOSE_CASHIER_SHIFTS',
  'SNAPSHOT_REPORTS',
  'ROLL_BUSINESS_DATE',
  'ARCHIVE',
] as const;

const STEP_LABEL_TEXT = {
  PRE_CHECK: 'Pre-check',
  POST_ROOM_CHARGES: 'Post room charges',
  PROCESS_NO_SHOWS: 'Process no-shows',
  AUTO_TRANSFER: 'Auto transfer',
  CLOSE_CASHIER_SHIFTS: 'Close cashier shifts',
  SNAPSHOT_REPORTS: 'Snapshot reports',
  ROLL_BUSINESS_DATE: 'Roll business date',
  ARCHIVE: 'Archive',
} as const;

function pendingSteps(
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' = 'PENDING',
): Array<{
  step: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  attempt: number;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
}> {
  return STEPS.map((step) => ({
    step,
    status,
    attempt: status === 'PENDING' ? 0 : 1,
    startedAt: status === 'PENDING' ? null : 1,
    completedAt: status === 'COMPLETED' ? 2 : null,
    error: null,
  }));
}

function clearChecks() {
  return [
    'arrivals_not_checked_in',
    'departures_not_checked_out',
    'cashier_shift_open',
    'dirty_room_assigned',
    'departed_with_balance',
    'id_proof_missing',
  ].map((checkId) => ({ checkId, severity: 'warn' as const, count: 0 }));
}

function statusPayload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    businessDate: '2026-03-01',
    timelineDate: '2026-03-01',
    halted: false,
    pendingOpenCount: 0,
    closingExceptionCount: 0,
    steps: pendingSteps(),
    reports: [] as Array<{ reportId: string; businessDate: string; generatedAt: number }>,
    checks: clearChecks(),
    ...overrides,
  };
}

function meWith(permissions: string[]) {
  return {
    ok: true,
    orgId: 'org_demo',
    propertyId: 'prop_demo',
    userId: 'user_1',
    role: 'admin',
    permissions,
    orgPermissions: [],
  };
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NightAuditScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidateSpy, client, ...view };
}

function resolveRefetchInterval(client: QueryClient): number | false | undefined {
  const obs = client.getQueryCache().find({ queryKey: ['night-audit', 'prop_demo'] });
  const configured = (
    obs?.options as { refetchInterval?: number | false | ((query: Query) => number | false) }
  ).refetchInterval;
  if (typeof configured === 'function') return configured(obs as Query);
  return configured;
}

async function showStage(name: 'Checks' | 'Run' | 'Close-out') {
  const tab = await screen.findByRole('link', { name });
  if (tab.getAttribute('aria-current') !== 'page') {
    fireEvent.click(tab);
  }
}

describe('NightAuditScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runNightAudit.mockResolvedValue({ body: { instanceStatus: 'queued' } });
    retryNightAuditStep.mockResolvedValue({ body: { status: 'COMPLETED' } });
    resolveNightAuditHalt.mockResolvedValue({ body: { status: 'COMPLETED', halted: false } });
    getNightAuditReport.mockResolvedValue({ businessDate: '2026-03-01', roomNet: 15000, taxTotal: 1200 });
    getNightAuditCheckLog.mockResolvedValue({ dates: [] });
    getMe.mockResolvedValue(meWith(['night_audit:run', 'settings:configure']));
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
    expect(screen.getByTestId('audit-banner').className).toContain('ui-alert--exception');
    expect(screen.getByTestId('audit-banner').textContent).toMatch(
      /review the failed step, then Retry or Resume/i,
    );
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
      expect.stringMatching(/^night-audit:resolve-halt:prop_demo:2026-03-01:/),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['night-audit', 'prop_demo'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['night-audit-check-log', 'prop_demo'] });
  });

  it('T12: disabled Run shows reason when business date is current', async () => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    getNightAudit.mockResolvedValue(statusPayload({ businessDate: today, timelineDate: today }));
    renderScreen();
    await showStage('Run');
    await waitFor(() => expect(screen.getByRole('button', { name: /run night audit/i })).toBeTruthy());
    expect((screen.getByRole('button', { name: /run night audit/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/Business date is already current/i)).toBeTruthy();
  });

  it('T13: run mutation error shows Alert with classified copy', async () => {
    getNightAudit.mockResolvedValue(statusPayload());
    runNightAudit.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    renderScreen();
    await showStage('Run');
    await waitFor(() => expect(screen.getByRole('button', { name: /run night audit/i })).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /run night audit/i }));
    });
    await waitFor(() => expect(screen.getByTestId('night-audit-message')).toBeTruthy());
    expect(screen.getByTestId('night-audit-message').textContent).toMatch(/Property unreachable/i);
    expect(screen.getByTestId('night-audit-message').className).toContain('ui-alert--exception');
  });

  it('T14: step column shows clerk labels not bare wire ids', async () => {
    const steps = pendingSteps();
    steps[1] = { ...steps[1]!, step: 'POST_ROOM_CHARGES' };
    getNightAudit.mockResolvedValue(statusPayload({ steps }));
    renderScreen();
    await showStage('Run');
    await waitFor(() => expect(screen.getByText('Post room charges')).toBeTruthy());
    expect(screen.queryByText('POST_ROOM_CHARGES')).toBeNull();
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
    await showStage('Run');
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
    await showStage('Close-out');
    await waitFor(() => expect(screen.getByRole('button', { name: /revenue/i })).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /revenue/i }));
    });
    await waitFor(() => expect(getNightAuditReport).toHaveBeenCalledWith('prop_demo', '2026-03-01', 'revenue'));
    await waitFor(() => expect(screen.getByTestId('report-table')).toBeTruthy());
    expect(screen.getByTestId('report-table').textContent).toMatch(/₹150\.00/);
    expect(screen.getByTestId('report-table').textContent).toMatch(/₹12\.00/);
    expect(screen.queryByText(/\{/)).toBeNull();
  });

  it('open exceptions link points at /exceptions?resolution=open', async () => {
    getNightAudit.mockResolvedValue(statusPayload({ closingExceptionCount: 2 }));
    renderScreen();
    await waitFor(() => expect(screen.getByRole('link', { name: /open exceptions/i })).toBeTruthy());
    const href = screen.getByRole('link', { name: /open exceptions/i }).getAttribute('href') ?? '';
    expect(href).toContain('/exceptions?resolution=open');
    expect(href).toContain('businessDateFrom=2026-03-01');
    expect(href).toContain('businessDateTo=2026-03-01');
  });

  it('11: all eight step ids render their label and no raw id appears', async () => {
    expect(STEP_LABELS).toEqual(STEP_LABEL_TEXT);
    expect(Object.keys(STEP_LABELS)).toEqual([...STEPS]);
    getNightAudit.mockResolvedValue(statusPayload());
    renderScreen();
    await showStage('Run');
    for (const id of STEPS) {
      expect(await screen.findByText(STEP_LABEL_TEXT[id])).toBeTruthy();
      expect(screen.queryByText(id)).toBeNull();
    }
  });

  it('12: opens on Checks when idle and on Run when running, failed, or halted', async () => {
    getNightAudit.mockResolvedValue(statusPayload());
    const idle = renderScreen();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Checks' }).getAttribute('aria-current')).toBe('page'),
    );
    expect(screen.getByRole('link', { name: 'Run' }).getAttribute('aria-current')).toBeNull();
    idle.unmount();

    const steps = pendingSteps();
    steps[2] = { ...steps[2]!, status: 'RUNNING', attempt: 1 };
    getNightAudit.mockResolvedValue(statusPayload({ steps }));
    const running = renderScreen();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Run' }).getAttribute('aria-current')).toBe('page'),
    );
    running.unmount();

    const failed = pendingSteps();
    failed[0] = { ...failed[0]!, status: 'FAILED', attempt: 1, error: 'seeded' };
    getNightAudit.mockResolvedValue(statusPayload({ steps: failed }));
    const failedView = renderScreen();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Run' }).getAttribute('aria-current')).toBe('page'),
    );
    failedView.unmount();

    getNightAudit.mockResolvedValue(statusPayload({ halted: true }));
    renderScreen();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Run' }).getAttribute('aria-current')).toBe('page'),
    );
  });

  it('13: Checks shows counts and outcome words, with no currency amount and no guest name', async () => {
    getNightAudit.mockResolvedValue(
      statusPayload({
        pendingOpenCount: 4,
        closingExceptionCount: 0,
        checks: [
          { checkId: 'arrivals_not_checked_in', severity: 'fail', count: 3 },
          { checkId: 'departures_not_checked_out', severity: 'warn', count: 0 },
          { checkId: 'cashier_shift_open', severity: 'info', count: 1 },
          { checkId: 'dirty_room_assigned', severity: 'off', count: null },
          { checkId: 'departed_with_balance', severity: 'warn', count: 2 },
        ],
      }),
    );
    renderScreen();
    const card = await screen.findByTestId('night-audit-checks');
    const queued = within(card).getByRole('row', { name: /Queued commands/ });
    expect(within(queued).getByText('4')).toBeTruthy();
    expect(within(queued).getByText('Fail')).toBeTruthy();
    expect(within(queued).queryByRole('link')).toBeNull();
    const exceptions = within(card).getByRole('row', { name: /Open exceptions/ });
    expect(within(exceptions).getByText('0')).toBeTruthy();
    expect(within(exceptions).getByText('Clear')).toBeTruthy();
    expect(within(exceptions).getByRole('link', { name: 'Open exceptions' })).toBeTruthy();
    const arrivals = within(card).getByRole('row', { name: /Arrivals not checked in/ });
    expect(within(arrivals).getByText('3')).toBeTruthy();
    expect(within(arrivals).getByText('Fail')).toBeTruthy();
    expect(within(arrivals).getByRole('link', { name: 'Arrivals' }).getAttribute('href')).toBe(
      '/arrivals?date=2026-03-01',
    );
    const departures = within(card).getByRole('row', { name: /Departures not checked out/ });
    expect(within(departures).getByText('Clear')).toBeTruthy();
    expect(within(departures).getByRole('link', { name: 'Departures' }).getAttribute('href')).toBe(
      '/departures?date=2026-03-01',
    );
    const shift = within(card).getByRole('row', { name: /Cashier shifts still open/ });
    expect(within(shift).getByText('Info')).toBeTruthy();
    expect(within(shift).getByRole('link', { name: 'Shift' }).getAttribute('href')).toBe('/shift');
    const dirty = within(card).getByRole('row', { name: /Arrivals assigned a dirty room/ });
    expect(within(dirty).getByText('Off')).toBeTruthy();
    expect(within(dirty).queryByText('0')).toBeNull();
    expect(within(dirty).queryByText('null')).toBeNull();
    expect(within(dirty).getByRole('link', { name: 'Housekeeping' }).getAttribute('href')).toBe(
      '/housekeeping',
    );
    const balance = within(card).getByRole('row', { name: /Departed with a balance/ });
    expect(within(balance).getByText('2')).toBeTruthy();
    expect(within(balance).getByText('Warn')).toBeTruthy();
    expect(card.textContent).not.toMatch(/\d+\.\d{2}/);
    expect(card.textContent).not.toMatch(/\$|USD/);
    expect(card.textContent).not.toMatch(/guestRef|Jane Doe|John Smith/i);
    expect(await screen.findByRole('link', { name: 'Settings' })).toHaveProperty(
      'pathname',
      '/settings/property',
    );
  });

  it('14: Run is disabled for a Fail or fixed row above 0, and a Warn shows an Alert without disabling', async () => {
    getNightAudit.mockResolvedValue(
      statusPayload({
        pendingOpenCount: 2,
        checks: clearChecks().map((row) =>
          row.checkId === 'arrivals_not_checked_in' ? { ...row, severity: 'warn', count: 4 } : row,
        ),
      }),
    );
    const pending = renderScreen();
    await showStage('Run');
    await waitFor(() => expect(screen.getByRole('button', { name: /run night audit/i })).toBeTruthy());
    expect((screen.getByRole('button', { name: /run night audit/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/Clear Fail checks before running: Queued commands/)).toBeTruthy();
    expect(screen.getByTestId('night-audit-warn').textContent).toMatch(/Arrivals not checked in/);
    pending.unmount();

    getNightAudit.mockResolvedValue(
      statusPayload({
        closingExceptionCount: 1,
        checks: clearChecks(),
      }),
    );
    const exceptions = renderScreen();
    await showStage('Run');
    expect(
      (await screen.findByRole('button', { name: /run night audit/i })) as HTMLButtonElement,
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /run night audit/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/Clear Fail checks before running: Open exceptions/)).toBeTruthy();
    exceptions.unmount();

    getNightAudit.mockResolvedValue(
      statusPayload({
        checks: clearChecks().map((row) =>
          row.checkId === 'departures_not_checked_out'
            ? { ...row, severity: 'fail', count: 1 }
            : row,
        ),
      }),
    );
    const fail = renderScreen();
    await showStage('Run');
    expect(
      (await screen.findByRole('button', { name: /run night audit/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/Departures not checked out/)).toBeTruthy();
    expect(screen.queryByTestId('night-audit-warn')).toBeNull();
    fail.unmount();

    getNightAudit.mockResolvedValue(
      statusPayload({
        checks: clearChecks().map((row) =>
          row.checkId === 'cashier_shift_open' ? { ...row, severity: 'warn', count: 2 } : row,
        ),
      }),
    );
    renderScreen();
    await showStage('Run');
    const run = (await screen.findByRole('button', { name: /run night audit/i })) as HTMLButtonElement;
    expect(run.disabled).toBe(false);
    expect(screen.getByTestId('night-audit-warn').className).toContain('ui-alert--attention');
    expect(screen.getByTestId('night-audit-warn').textContent).toMatch(/Cashier shifts still open/);
  });

  it('15: Halt is an Alert with Retry and Resume, and known step errors use operator copy', async () => {
    const cases = [
      ['night_audit_checks_failed', 'Fail checks stopped the audit. See Checks.'],
      ['pending_commands_undrained', 'Queued commands are still open. See Checks.'],
      ['provisional_exceptions_open', 'Open exceptions are still unresolved. See Checks.'],
    ] as const;
    for (const [code, copy] of cases) {
      cleanup();
      const steps = pendingSteps();
      steps[0] = { ...steps[0]!, status: 'FAILED', attempt: 1, error: code };
      getNightAudit.mockResolvedValue(statusPayload({ halted: true, steps }));
      renderScreen();
      const banner = await screen.findByTestId('audit-banner');
      expect(banner.tagName).toBe('DIV');
      expect(banner.className).toContain('ui-alert');
      expect(banner.textContent).toMatch(/review the failed step, then Retry or Resume/i);
      expect(screen.getByRole('button', { name: /^retry$/i })).toBeTruthy();
      expect((screen.getByRole('button', { name: /^resume$/i }) as HTMLButtonElement).disabled).toBe(
        false,
      );
      expect(screen.getByText(copy)).toBeTruthy();
      expect(screen.queryByText(code)).toBeNull();
    }
    cleanup();
    const steps = pendingSteps();
    steps[0] = { ...steps[0]!, status: 'FAILED', attempt: 1, error: 'some_other_code' };
    getNightAudit.mockResolvedValue(statusPayload({ halted: true, steps }));
    renderScreen();
    expect(await screen.findByText('some_other_code')).toBeTruthy();
  });

  it('16: success results use the success intent; failures use classified copy', async () => {
    getNightAudit.mockResolvedValue(statusPayload());
    const started = renderScreen();
    await showStage('Run');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /run night audit/i }));
    });
    await waitFor(() => expect(screen.getByTestId('night-audit-message').textContent).toMatch(/started/i));
    expect(screen.getByTestId('night-audit-message').className).toContain('ui-alert--settled');
    started.unmount();

    const steps = pendingSteps();
    steps[0] = { ...steps[0]!, status: 'FAILED', attempt: 1, error: 'seeded' };
    getNightAudit.mockResolvedValue(statusPayload({ halted: true, steps }));
    const retry = renderScreen();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^retry$/i }));
    });
    await waitFor(() =>
      expect(screen.getByTestId('night-audit-message').textContent).toMatch(/use resume to finish/i),
    );
    expect(screen.getByTestId('night-audit-message').className).toContain('ui-alert--settled');
    retry.unmount();

    const resume = renderScreen();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^resume$/i }));
    });
    await waitFor(() =>
      expect(screen.getByTestId('night-audit-message').textContent).toMatch(/resumed/i),
    );
    expect(screen.getByTestId('night-audit-message').className).toContain('ui-alert--settled');
    resume.unmount();

    getNightAudit.mockResolvedValue(statusPayload());
    runNightAudit.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    renderScreen();
    await showStage('Run');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /run night audit/i }));
    });
    await waitFor(() =>
      expect(screen.getByTestId('night-audit-message').textContent).toMatch(/Property unreachable/i),
    );
    expect(screen.getByTestId('night-audit-message').className).toContain('ui-alert--exception');
  });

  it('17: polls while running and stops when idle; Refresh and returning re-read', async () => {
    getNightAudit.mockResolvedValue(statusPayload());
    const idle = renderScreen();
    await screen.findByTestId('night-audit-checks');
    await waitFor(() => expect(resolveRefetchInterval(idle.client)).toBe(false));
    const obs = idle.client.getQueryCache().find({ queryKey: ['night-audit', 'prop_demo'] });
    const options = obs?.options as { refetchOnMount?: boolean | 'always' } | undefined;
    expect(options?.refetchOnMount).toBe('always');
    const beforeRefresh = getNightAudit.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(getNightAudit.mock.calls.length).toBeGreaterThan(beforeRefresh));
    idle.unmount();

    const steps = pendingSteps();
    steps[0] = { ...steps[0]!, status: 'RUNNING', attempt: 1 };
    getNightAudit.mockResolvedValue(statusPayload({ steps }));
    const running = renderScreen();
    await waitFor(() => expect(resolveRefetchInterval(running.client)).toBe(5000));
    running.unmount();

    getNightAudit.mockResolvedValue(statusPayload());
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const ui = (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <NightAuditScreen />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const first = render(ui);
    await waitFor(() => expect(getNightAudit).toHaveBeenCalled());
    const calls = getNightAudit.mock.calls.length;
    first.unmount();
    render(ui);
    await waitFor(() => expect(getNightAudit.mock.calls.length).toBeGreaterThan(calls));
  });

  it('18: Run, Retry and Resume invalidate both night-audit keys; the end of a run invalidates desk keys', async () => {
    getNightAudit.mockResolvedValue(statusPayload());
    const run = renderScreen();
    await showStage('Run');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /run night audit/i }));
    });
    await waitFor(() =>
      expect(run.invalidateSpy).toHaveBeenCalledWith({ queryKey: ['night-audit', 'prop_demo'] }),
    );
    expect(run.invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['night-audit-check-log', 'prop_demo'],
    });
    expect(run.invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['board'] });
    expect(run.invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ['front-desk-summary', 'prop_demo'],
    });
    run.unmount();

    const runningSteps = pendingSteps();
    runningSteps[0] = { ...runningSteps[0]!, status: 'RUNNING', attempt: 1 };
    getNightAudit.mockResolvedValue(statusPayload({ steps: runningSteps }));
    const ending = renderScreen();
    await screen.findByTestId('audit-banner');
    const finished = statusPayload({
      businessDate: '2026-03-02',
      timelineDate: '2026-03-02',
      steps: pendingSteps('COMPLETED'),
    });
    await act(async () => {
      ending.client.setQueryData(['night-audit', 'prop_demo'], finished);
    });
    expect(await screen.findByTestId('night-audit-run-ended')).toHaveProperty(
      'textContent',
      'Business date is now 02/03/2026.',
    );
    expect(screen.getByTestId('night-audit-run-ended').className).toContain('ui-alert--settled');
    for (const queryKey of [
      ['board'],
      ['front-desk-summary', 'prop_demo'],
      ['front-desk-tape', 'prop_demo'],
      ['front-desk-free', 'prop_demo'],
      ['front-desk-available', 'prop_demo'],
      ['housekeeping-assignments', 'prop_demo'],
      ['housekeeping-priorities', 'prop_demo'],
      ['open-shift', 'prop_demo'],
      ['recent-shifts', 'prop_demo'],
    ]) {
      expect(ending.invalidateSpy).toHaveBeenCalledWith({ queryKey });
    }
    ending.unmount();

    const stoppedRunning = pendingSteps();
    stoppedRunning[3] = { ...stoppedRunning[3]!, status: 'RUNNING', attempt: 1 };
    getNightAudit.mockResolvedValue(statusPayload({ steps: stoppedRunning }));
    const stopped = renderScreen();
    await screen.findByText('Auto transfer');
    const stoppedSteps = pendingSteps('COMPLETED');
    stoppedSteps[3] = { ...stoppedSteps[3]!, status: 'FAILED', attempt: 1, error: 'seeded' };
    await act(async () => {
      stopped.client.setQueryData(
        ['night-audit', 'prop_demo'],
        statusPayload({ steps: stoppedSteps, halted: true }),
      );
    });
    expect((await screen.findByTestId('night-audit-run-ended')).textContent).toBe(
      'Night audit stopped at Auto transfer.',
    );
    stopped.unmount();

    const failed = pendingSteps();
    failed[0] = { ...failed[0]!, status: 'FAILED', attempt: 1, error: 'seeded' };
    getNightAudit.mockResolvedValue(statusPayload({ halted: true, steps: failed }));
    const retry = renderScreen();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^retry$/i }));
    });
    await waitFor(() =>
      expect(retry.invalidateSpy).toHaveBeenCalledWith({ queryKey: ['night-audit', 'prop_demo'] }),
    );
    expect(retry.invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['night-audit-check-log', 'prop_demo'],
    });
    retry.unmount();

    const resume = renderScreen();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^resume$/i }));
    });
    await waitFor(() =>
      expect(resume.invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['night-audit-check-log', 'prop_demo'],
      }),
    );
    expect(resume.invalidateSpy).toHaveBeenCalledWith({ queryKey: ['night-audit', 'prop_demo'] });
  });

  it('a second Retry sends a new key, so the server re-runs the step instead of replaying a failure', async () => {
    const steps = pendingSteps();
    steps[0] = { ...steps[0]!, status: 'FAILED', attempt: 1, error: 'night_audit_checks_failed' };
    getNightAudit.mockResolvedValue(statusPayload({ halted: true, steps }));
    retryNightAuditStep.mockResolvedValueOnce({
      body: { status: 'FAILED', error: 'night_audit_checks_failed' },
    });
    renderScreen();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^retry$/i }));
    });
    await waitFor(() =>
      expect(screen.getByTestId('night-audit-message').textContent).toBe(
        'Fail checks stopped the audit. See Checks.',
      ),
    );
    expect(screen.getByTestId('night-audit-message').className).toContain('ui-alert--exception');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    });
    await waitFor(() => expect(retryNightAuditStep).toHaveBeenCalledTimes(2));
    expect(retryNightAuditStep.mock.calls[0]![2]).not.toBe(retryNightAuditStep.mock.calls[1]![2]);
  });

  it('a failed Resume shows the failure, not "resumed"', async () => {
    const steps = pendingSteps();
    steps[0] = { ...steps[0]!, status: 'FAILED', attempt: 1, error: 'night_audit_checks_failed' };
    getNightAudit.mockResolvedValue(statusPayload({ halted: true, steps }));
    resolveNightAuditHalt.mockResolvedValueOnce({
      body: { status: 'FAILED', error: 'night_audit_checks_failed', halted: true },
    });
    renderScreen();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^resume$/i }));
    });
    await waitFor(() =>
      expect(screen.getByTestId('night-audit-message').className).toContain('ui-alert--exception'),
    );
    expect(screen.getByTestId('night-audit-message').textContent).toBe(
      'Fail checks stopped the audit. See Checks.',
    );
  });

  it('part-way after a passed Retry: opens on Run, Resume enabled, Run disabled with the reason', async () => {
    const steps = pendingSteps();
    steps[0] = { ...steps[0]!, status: 'COMPLETED', attempt: 2, completedAt: 2 };
    getNightAudit.mockResolvedValue(statusPayload({ steps }));
    renderScreen();
    const resume = await screen.findByRole('button', { name: /^resume$/i });
    expect((resume as HTMLButtonElement).disabled).toBe(false);
    expect(
      (screen.getByRole('button', { name: /run night audit/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('A run is part-way through. Use Resume to finish it.')).toBeTruthy();
  });

  it('a gap between steps does not claim the run ended, and a started run polls until it rolls', async () => {
    getNightAudit.mockResolvedValue(statusPayload());
    const view = renderScreen();
    await showStage('Run');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /run night audit/i }));
    });
    await waitFor(() => expect(resolveRefetchInterval(view.client)).toBe(5000));

    const gap = pendingSteps();
    gap[0] = { ...gap[0]!, status: 'COMPLETED', attempt: 1, completedAt: 2 };
    await act(async () => {
      view.client.setQueryData(['night-audit', 'prop_demo'], statusPayload({ steps: gap }));
    });
    expect(screen.queryByTestId('night-audit-run-ended')).toBeNull();
    expect(view.invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['board'] });
    expect(resolveRefetchInterval(view.client)).toBe(5000);

    await act(async () => {
      view.client.setQueryData(
        ['night-audit', 'prop_demo'],
        statusPayload({
          businessDate: '2026-03-02',
          timelineDate: '2026-03-01',
          steps: pendingSteps('COMPLETED'),
        }),
      );
    });
    expect((await screen.findByTestId('night-audit-run-ended')).textContent).toBe(
      'Business date is now 02/03/2026.',
    );
    expect(view.invalidateSpy).toHaveBeenCalledWith({ queryKey: ['board'] });
    expect(resolveRefetchInterval(view.client)).toBe(false);
  });

  it('a failed status read shows an Alert, and Close-out says when there are no reports', async () => {
    getNightAudit.mockRejectedValueOnce(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    const failed = renderScreen();
    expect((await screen.findByTestId('night-audit-status-error')).textContent).toMatch(
      /Property unreachable/i,
    );
    failed.unmount();

    getNightAudit.mockResolvedValue(statusPayload());
    renderScreen();
    await showStage('Close-out');
    expect(await screen.findByTestId('night-audit-reports-empty')).toBeTruthy();
  });

  it('19: Close-out separates loading, error and empty, and shows attempts and All clear', async () => {
    let resolveLog: (value: { dates: unknown[] }) => void = () => {};
    getNightAuditCheckLog.mockReturnValue(
      new Promise((resolve) => {
        resolveLog = resolve;
      }),
    );
    getNightAudit.mockResolvedValue(
      statusPayload({
        reports: [
          { reportId: 'revenue', businessDate: '2026-03-01', generatedAt: 1 },
          { reportId: 'revenue', businessDate: '2026-03-03', generatedAt: 3 },
        ],
      }),
    );
    const loading = renderScreen();
    await screen.findByRole('link', { name: 'Checks' });
    expect(getNightAuditCheckLog).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: 'Close-out' }));
    expect(await screen.findByTestId('night-audit-check-log-loading')).toBeTruthy();
    expect(screen.queryByTestId('night-audit-check-log-empty')).toBeNull();
    expect(screen.queryByTestId('night-audit-check-log-error')).toBeNull();
    const dateSelect = screen.getByRole('combobox', { name: 'Report date' }) as HTMLSelectElement;
    expect(dateSelect.value).toBe('2026-03-03');
    expect([...dateSelect.options].map((option) => option.value)).toEqual([
      '2026-03-03',
      '2026-03-01',
    ]);
    fireEvent.click(screen.getByRole('button', { name: /revenue/i }));
    await waitFor(() =>
      expect(getNightAuditReport).toHaveBeenLastCalledWith('prop_demo', '2026-03-03', 'revenue'),
    );
    fireEvent.change(dateSelect, { target: { value: '2026-03-01' } });
    fireEvent.click(screen.getByRole('button', { name: /revenue/i }));
    await waitFor(() =>
      expect(getNightAuditReport).toHaveBeenLastCalledWith('prop_demo', '2026-03-01', 'revenue'),
    );
    await act(async () => {
      resolveLog({ dates: [] });
    });
    expect(await screen.findByTestId('night-audit-check-log-empty')).toBeTruthy();
    expect(screen.getByText('No check log yet.')).toBeTruthy();
    expect(screen.queryByTestId('night-audit-check-log-loading')).toBeNull();
    loading.unmount();

    getNightAuditCheckLog.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    const errored = renderScreen();
    await showStage('Close-out');
    const error = await screen.findByTestId('night-audit-check-log-error');
    expect(error.textContent).toMatch(/Property unreachable/);
    expect(screen.queryByTestId('night-audit-check-log-empty')).toBeNull();
    expect(screen.queryByText('No check log yet.')).toBeNull();
    errored.unmount();

    getNightAuditCheckLog.mockResolvedValue({
      dates: [
        {
          businessDate: '2026-03-02',
          attempts: [
            {
              attempt: 1,
              checks: [{ checkId: 'arrivals_not_checked_in', severity: 'fail', count: 2 }],
            },
            {
              attempt: 2,
              checks: [{ checkId: 'arrivals_not_checked_in', severity: 'warn', count: 0 }],
            },
          ],
        },
        {
          businessDate: '2026-03-01',
          attempts: [{ attempt: 1, checks: [] }],
        },
      ],
    });
    renderScreen();
    await showStage('Close-out');
    const table = await screen.findByTestId('night-audit-check-log');
    const text = table.textContent ?? '';
    expect(text.indexOf('02/03/2026')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('02/03/2026')).toBeLessThan(text.indexOf('01/03/2026'));
    expect(text).toMatch(/Arrivals not checked in: 2 Fail/);
    expect(screen.getAllByText('All clear').length).toBe(2);
    const rows = within(table).getAllByRole('row');
    expect(rows.some((row) => row.textContent?.includes('02/03/2026') && row.textContent?.includes('1'))).toBe(
      true,
    );
    expect(rows.some((row) => row.textContent?.includes('02/03/2026') && row.textContent?.includes('2'))).toBe(
      true,
    );
  });

  it('hides Settings without settings:configure and still lets the clerk move stages', async () => {
    getMe.mockResolvedValue(meWith(['night_audit:run']));
    getNightAudit.mockResolvedValue(statusPayload());
    renderScreen();
    await screen.findByTestId('night-audit-checks');
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Run' }));
    expect(screen.getByRole('link', { name: 'Run' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('link', { name: 'Checks' }));
    expect(screen.getByRole('link', { name: 'Checks' }).getAttribute('aria-current')).toBe('page');
  });

  it('says the day is still open when the business date is current', async () => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    getNightAudit.mockResolvedValue(statusPayload({ businessDate: today, timelineDate: today }));
    renderScreen();
    const notice = await screen.findByText('The day is still open and the counts will change.');
    const alert = notice.closest('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert!.className).toMatch(/ui-alert--informational/);
  });

  it('a status read error shows a classified alert and keeps the header', async () => {
    getNightAudit.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: {},
        retryAfterMs: null,
      }),
    );
    renderScreen();
    expect((await screen.findByTestId('night-audit-status-error')).textContent).toMatch(
      /Property unreachable/,
    );
    expect(screen.getByRole('heading', { name: 'Night audit' })).toBeTruthy();
  });

  it('a report read error shows a classified alert', async () => {
    getNightAudit.mockResolvedValue(
      statusPayload({
        reports: [{ reportId: 'revenue', businessDate: '2026-03-01', generatedAt: 1 }],
      }),
    );
    getNightAuditReport.mockRejectedValue(
      new ClassifiedError({
        class: 'read_stale',
        status: 503,
        body: {},
        retryAfterMs: 0,
      }),
    );
    renderScreen();
    await showStage('Close-out');
    fireEvent.click(await screen.findByRole('button', { name: /revenue/i }));
    expect((await screen.findByTestId('night-audit-report-error')).textContent).toMatch(
      /Data is stale/,
    );
  });
});
