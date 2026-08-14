import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Field,
  Input,
  NativeSelect,
  Textarea,
} from '@hospai/ui-kit';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  hasPropertyPermission,
  meShellStateFromQuery,
  type PropertyMe,
} from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { exceptionBadgeSeverity } from '../status/exception-badge-severity.js';
import { usePropertyTimeZone } from '../shell/PropertyTimeZone.js';
import { useUnsavedChanges } from './use-unsaved-changes.js';
import { GuestNameLink } from './guest-row.js';

const REPLAY_COMMAND_IDS = [
  'reservations.check_in',
  'reservations.check_out',
  'reservations.cancel_check_in',
  'reservations.update_status',
  'folio.add_item',
  'rooms.update_status',
  'rooms.bulk_update_status',
  'housekeeping.assign',
] as const;

type AffectedRefs = {
  reservationId: string | null;
  roomId: string | null;
  guestRef: string | null;
  folioLineId: string | null;
};

type ExceptionRow = {
  exceptionId: string;
  commandType: string;
  reason: string;
  businessDate: string;
  createdAt: number;
  resolvedAt: number | null;
  assignedTo: string | null;
  affected: AffectedRefs;
  payload?: unknown;
};

type DetailBody = {
  ok: true;
  exception: ExceptionRow;
  actions: Array<{ at: number; actor: string; commandId: string; action: string }>;
  notes: Array<{ noteId: string; at: number; actor: string; text: string }>;
};

function asRows(body: unknown): ExceptionRow[] {
  if (!body || typeof body !== 'object') return [];
  const exceptions = (body as { exceptions?: unknown }).exceptions;
  return Array.isArray(exceptions) ? (exceptions as ExceptionRow[]) : [];
}

function formatInstant(ms: number, timeZone: string | null): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timeZone ?? 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ms));
}

export function ExceptionsScreen() {
  const propertyId = tenant.propertyId;
  const timeZone = usePropertyTimeZone();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [outcome, setOutcome] = useState('');
  const [confirm, setConfirm] = useState<{
    copy: string;
    run: () => void;
  } | null>(null);

  const resolution = searchParams.get('resolution') ?? 'open';
  const commandType = searchParams.get('commandType') ?? '';
  const reason = searchParams.get('reason') ?? '';
  const businessDateFrom = searchParams.get('businessDateFrom') ?? '';
  const businessDateTo = searchParams.get('businessDateTo') ?? '';
  const assigned = searchParams.get('assigned') ?? 'all';
  const assignedTo = searchParams.get('assignedTo') ?? '';
  const cursor = searchParams.get('cursor') ?? '';

  const meQuery = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const shell = meShellStateFromQuery({
    status: meQuery.status,
    data: meQuery.data as PropertyMe | undefined,
    classified: meQuery.isError ? asClassified(meQuery.error) : undefined,
  });
  const me =
    shell.kind === 'authority' && shell.authority.kind === 'live' ? shell.authority.me : undefined;
  const canWrite = Boolean(me && hasPropertyPermission(me, 'night_audit:run'));
  const canListMembers = Boolean(me && hasPropertyPermission(me, 'staff:read'));

  const filters = {
    resolution: resolution as 'open' | 'resolved' | 'all',
    ...(commandType ? { commandType } : {}),
    ...(reason ? { reason } : {}),
    ...(businessDateFrom ? { businessDateFrom } : {}),
    ...(businessDateTo ? { businessDateTo } : {}),
    ...(assigned ? { assigned: assigned as 'all' | 'unassigned' | 'assigned' } : {}),
    ...(assignedTo ? { assignedTo } : {}),
    limit: 50,
    ...(cursor ? { cursor } : {}),
  };

  const listQ = useQuery({
    queryKey: ['provisional-exceptions', propertyId, filters],
    queryFn: () => api.getProvisionalExceptions(propertyId, filters),
    retry: false,
  });
  const rows = asRows(listQ.data);
  const nextCursor =
    listQ.data && typeof listQ.data === 'object'
      ? ((listQ.data as { nextCursor?: string | null }).nextCursor ?? null)
      : null;

  const guestRefs = [...new Set(rows.map((r) => r.affected?.guestRef).filter(Boolean))] as string[];
  const guestsQ = useQuery({
    queryKey: ['guests-batch', propertyId, guestRefs.join('|')],
    queryFn: () => api.postGuestsBatch(propertyId, guestRefs),
    enabled: guestRefs.length > 0 && listQ.isSuccess,
    retry: false,
  });

  const membersQ = useQuery({
    queryKey: ['property-members', propertyId],
    queryFn: () => api.listPropertyMembers(propertyId),
    enabled: canListMembers,
    retry: false,
  });
  const members = membersQ.data?.ok ? membersQ.data.members : [];

  const detailQ = useQuery({
    queryKey: ['provisional-exception', propertyId, detailId],
    queryFn: () => api.getProvisionalException(propertyId, detailId!),
    enabled: Boolean(detailId),
    retry: false,
  });
  const detail = detailQ.data as DetailBody | undefined;

  const dirty = noteText.trim().length > 0;
  const unsavedGuard = useUnsavedChanges(dirty);

  function patchParams(patch: Record<string, string | null>) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === '') next.delete(k);
          else next.set(k, v);
        }
        next.delete('cursor');
        return next;
      },
      { replace: true },
    );
  }

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['provisional-exceptions', propertyId] });
    await queryClient.invalidateQueries({ queryKey: ['provisional-exception-count', propertyId] });
    if (detailId) {
      await queryClient.invalidateQueries({
        queryKey: ['provisional-exception', propertyId, detailId],
      });
    }
  };

  const retryMut = useMutation({
    mutationFn: (exceptionId: string) =>
      api.retryProvisionalException(
        propertyId,
        exceptionId,
        `provisional:retry:${propertyId}:${exceptionId}:${crypto.randomUUID()}`,
      ),
    onSettled: invalidate,
  });
  const resolveMut = useMutation({
    mutationFn: (exceptionId: string) =>
      api.resolveProvisionalException(
        propertyId,
        exceptionId,
        `provisional:resolve:${propertyId}:${exceptionId}:${crypto.randomUUID()}`,
      ),
    onSettled: invalidate,
  });
  const assignMut = useMutation({
    mutationFn: (input: { exceptionId: string; assignedTo: string | null }) =>
      api.assignProvisionalException(
        propertyId,
        input.exceptionId,
        input.assignedTo,
        `provisional:assign:${propertyId}:${input.exceptionId}:${crypto.randomUUID()}`,
      ),
    onSettled: invalidate,
  });
  const noteMut = useMutation({
    mutationFn: (input: { exceptionId: string; text: string }) =>
      api.addProvisionalExceptionNote(
        propertyId,
        input.exceptionId,
        { noteId: crypto.randomUUID(), text: input.text },
        `provisional:note:${propertyId}:${input.exceptionId}:${crypto.randomUUID()}`,
      ),
    onSettled: invalidate,
  });

  const inFlight = retryMut.isPending || resolveMut.isPending || assignMut.isPending || noteMut.isPending;

  const commandOptions = useMemo(() => {
    const extra = rows.map((r) => r.commandType).filter(Boolean);
    return [...new Set([...REPLAY_COMMAND_IDS, ...extra])];
  }, [rows]);

  async function runBatch(kind: 'retry' | 'resolve', ids: string[]) {
    const capped = ids.slice(0, 50);
    const errors: string[] = [];
    for (const id of capped) {
      try {
        if (kind === 'retry') await retryMut.mutateAsync(id);
        else await resolveMut.mutateAsync(id);
      } catch {
        errors.push(id);
      }
    }
    setOutcome(
      errors.length === 0
        ? `${kind === 'retry' ? 'Retried' : 'Resolved'} ${capped.length}.`
        : `${capped.length - errors.length} succeeded, ${errors.length} failed.`,
    );
    setSelected(new Set());
  }

  function requestResolve(ids: string[]) {
    const n = ids.length;
    setConfirm({
      copy:
        n === 1
          ? 'Resolve 1 exception without retrying? The original commands will not be applied.'
          : `Resolve ${n} exceptions without retrying? The original commands will not be applied.`,
      run: () => {
        setConfirm(null);
        void runBatch('resolve', ids);
      },
    });
  }

  function requestRetry(ids: string[]) {
    const n = ids.length;
    setConfirm({
      copy:
        n === 1
          ? 'Retry 1 exception? Each reapplies the original command on its original business date.'
          : `Retry ${n} exceptions? Each reapplies the original command on its original business date.`,
      run: () => {
        setConfirm(null);
        void runBatch('retry', ids);
      },
    });
  }

  async function onNote(e: FormEvent) {
    e.preventDefault();
    if (!detailId || !noteText.trim()) return;
    await noteMut.mutateAsync({ exceptionId: detailId, text: noteText.trim() });
    setNoteText('');
    setOutcome('Note saved.');
  }

  const selectedIds = rows.filter((r) => selected.has(r.exceptionId)).map((r) => r.exceptionId);

  return (
    <section className="panel" data-testid="exceptions-workbench">
      {unsavedGuard}
      <h1 className="text-wrap-balance">Exceptions</h1>
      <div className="exceptions-filters">
        <Field
          label="Command type"
          control={
            <NativeSelect
              aria-label="Command type"
              value={commandType}
              onChange={(e) => patchParams({ commandType: e.target.value || null })}
            >
              <option value="">All</option>
              {commandOptions.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </NativeSelect>
          }
        />
        <Field
          label="Reason"
          control={
            <Input
              aria-label="Reason"
              autoComplete="off"
              value={reason}
              onChange={(e) => patchParams({ reason: e.target.value || null })}
            />
          }
        />
        <fieldset>
          <legend>Resolution</legend>
          {(['open', 'resolved', 'all'] as const).map((value) => (
            <label key={value}>
              <Input
                type="radio"
                name="resolution"
                value={value}
                checked={resolution === value}
                onChange={() => patchParams({ resolution: value })}
              />{' '}
              {value === 'open' ? 'Open' : value === 'resolved' ? 'Resolved' : 'All'}
            </label>
          ))}
        </fieldset>
        <Field
          label="Business Date From"
          control={
            <Input
              type="date"
              aria-label="Business Date From"
              value={businessDateFrom}
              onChange={(e) => patchParams({ businessDateFrom: e.target.value || null })}
            />
          }
        />
        <Field
          label="Business Date To"
          control={
            <Input
              type="date"
              aria-label="Business Date To"
              value={businessDateTo}
              onChange={(e) => patchParams({ businessDateTo: e.target.value || null })}
            />
          }
        />
        <fieldset>
          <legend>Assigned</legend>
          {(['all', 'unassigned', 'assigned'] as const).map((value) => (
            <label key={value}>
              <Input
                type="radio"
                name="assigned"
                value={value}
                checked={assigned === value}
                onChange={() => patchParams({ assigned: value })}
              />{' '}
              {value === 'all' ? 'All' : value === 'unassigned' ? 'Unassigned' : 'Assigned'}
            </label>
          ))}
        </fieldset>
        {canListMembers && members.length > 0 ? (
          <Field
            label="Assignee"
            control={
              <NativeSelect
                aria-label="Assignee"
                value={assignedTo}
                onChange={(e) => patchParams({ assignedTo: e.target.value || null })}
              >
                <option value="">Anyone</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName ?? m.userId}
                  </option>
                ))}
              </NativeSelect>
            }
          />
        ) : null}
      </div>
      {canWrite ? (
        <p>
          <Button
            type="button"
            disabled={selectedIds.length === 0 || inFlight}
            onClick={() => requestRetry(selectedIds)}
          >
            {retryMut.isPending ? 'Retrying…' : 'Retry Selected'}
          </Button>{' '}
          <Button
            type="button"
            disabled={selectedIds.length === 0 || inFlight}
            onClick={() => requestResolve(selectedIds)}
          >
            {resolveMut.isPending ? 'Resolving…' : 'Resolve Selected'}
          </Button>
        </p>
      ) : null}
      <p aria-live="polite">{outcome}</p>
      {listQ.isError && asClassified(listQ.error).class === 'fail_closed' ? (
        <Alert>Exceptions unavailable — property unreachable</Alert>
      ) : listQ.isLoading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No exceptions match these filters.</p>
      ) : (
        <DataTable>
          <DataTableHead>
            <DataTableRow>
              <DataTableHeaderCell>
                <span className="visually-hidden">Select</span>
              </DataTableHeaderCell>
              <DataTableHeaderCell>Created</DataTableHeaderCell>
              <DataTableHeaderCell>Business Date</DataTableHeaderCell>
              <DataTableHeaderCell>Command Type</DataTableHeaderCell>
              <DataTableHeaderCell>Reason</DataTableHeaderCell>
              <DataTableHeaderCell>Assigned</DataTableHeaderCell>
              <DataTableHeaderCell>Resolution</DataTableHeaderCell>
              <DataTableHeaderCell>Links</DataTableHeaderCell>
              <DataTableHeaderCell>Row Actions</DataTableHeaderCell>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {rows.map((row) => {
              const open = row.resolvedAt == null;
              const sev = exceptionBadgeSeverity(open ? 1 : 0);
              return (
                <DataTableRow key={row.exceptionId} onClick={() => setDetailId(row.exceptionId)}>
                  <DataTableCell onClick={(e) => e.stopPropagation()}>
                    <label>
                      <Checkbox
                        checked={selected.has(row.exceptionId)}
                        onChange={(e) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(row.exceptionId);
                            else next.delete(row.exceptionId);
                            return next;
                          });
                        }}
                        aria-label={`Select ${row.exceptionId}`}
                      />
                    </label>
                  </DataTableCell>
                  <DataTableCell>
                    <span className="tabular-nums">{formatInstant(row.createdAt, timeZone)}</span>
                  </DataTableCell>
                  <DataTableCell>
                    <span className="tabular-nums">{row.businessDate}</span>
                  </DataTableCell>
                  <DataTableCell>
                    <span translate="no" className="min-w-0 truncate">
                      {row.commandType}
                    </span>
                  </DataTableCell>
                  <DataTableCell>
                    <span className="min-w-0 truncate">{row.reason}</span>
                  </DataTableCell>
                  <DataTableCell>
                    <span translate="no">{row.assignedTo ?? '—'}</span>
                  </DataTableCell>
                  <DataTableCell>
                    <Badge rung={sev}>{open ? 'Open' : 'Resolved'}</Badge>
                  </DataTableCell>
                  <DataTableCell>
                    {row.affected?.reservationId ? (
                      <Link to={`/folio/${row.affected.reservationId}`}>Folio</Link>
                    ) : null}
                    {row.affected?.reservationId && row.commandType === 'reservations.check_in' ? (
                      <>
                        {' '}
                        <Link to={`/check-in/${row.affected.reservationId}`}>Check-in</Link>
                      </>
                    ) : null}
                    {row.affected?.roomId ? (
                      <>
                        {' '}
                        <Link to="/housekeeping">Room</Link>
                      </>
                    ) : null}
                    {row.affected?.guestRef ? (
                      <>
                        {' '}
                        <GuestNameLink
                          state={guestsQ.data?.states?.[row.affected.guestRef]}
                          guestRef={row.affected.guestRef}
                        />
                      </>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell onClick={(e) => e.stopPropagation()}>
                    {canWrite ? (
                      <>
                        <Button type="button" onClick={() => requestRetry([row.exceptionId])}>
                          {retryMut.isPending ? 'Retrying…' : 'Retry'}
                        </Button>{' '}
                        <Button type="button" onClick={() => requestResolve([row.exceptionId])}>
                          {resolveMut.isPending ? 'Resolving…' : 'Resolve'}
                        </Button>{' '}
                        <Button
                          type="button"
                          onClick={() =>
                            void assignMut.mutateAsync({
                              exceptionId: row.exceptionId,
                              assignedTo: me?.userId ?? null,
                            })
                          }
                        >
                          {assignMut.isPending ? 'Saving…' : 'Assign'}
                        </Button>{' '}
                        <Button type="button" onClick={() => setDetailId(row.exceptionId)}>
                          Note
                        </Button>
                      </>
                    ) : null}
                  </DataTableCell>
                </DataTableRow>
              );
            })}
          </DataTableBody>
        </DataTable>
      )}
      {nextCursor ? (
        <p>
          <Button type="button" onClick={() => patchParams({ cursor: nextCursor })}>
            Next
          </Button>
        </p>
      ) : null}
      {detailId ? (
        <aside className="exceptions-drawer overscroll-contain">
          <h2>Detail</h2>
          {detailQ.isLoading ? <p className="muted">Loading…</p> : null}
          {detail?.exception ? (
            <>
              <p translate="no" className="tabular-nums">
                {detail.exception.exceptionId}
              </p>
              <details>
                <summary>Payload</summary>
                <pre>{JSON.stringify(detail.exception.payload, null, 2)}</pre>
              </details>
              <h3>Actions</h3>
              <ol>
                {detail.actions.map((a, i) => (
                  <li key={`${a.at}-${i}`}>
                    {formatInstant(a.at, timeZone)} · {a.actor} · {a.action}
                  </li>
                ))}
              </ol>
              <h3>Notes</h3>
              <ul>
                {detail.notes.map((n) => (
                  <li key={n.noteId}>{n.text}</li>
                ))}
              </ul>
              {canWrite ? (
                <>
                  <form onSubmit={(e) => void onNote(e)}>
                    <Field
                      label="Note"
                      control={
                        <Textarea
                          aria-label="Note"
                          autoComplete="off"
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                        />
                      }
                    />
                    <Button type="submit" disabled={noteMut.isPending || !noteText.trim()}>
                      {noteMut.isPending ? 'Saving…' : 'Note'}
                    </Button>
                  </form>
                  <p>
                    <Button
                      type="button"
                      onClick={() =>
                        void assignMut.mutateAsync({
                          exceptionId: detailId,
                          assignedTo: me?.userId ?? null,
                        })
                      }
                    >
                      Assign to Me
                    </Button>{' '}
                    {canListMembers ? (
                      <Field
                        label="Assign to"
                        control={
                          <NativeSelect
                            aria-label="Assign to"
                            defaultValue=""
                            onChange={(e) => {
                              const value = e.target.value;
                              if (!value) return;
                              void assignMut.mutateAsync({
                                exceptionId: detailId,
                                assignedTo: value,
                              });
                            }}
                          >
                            <option value="">Select member</option>
                            {members.map((m) => (
                              <option key={m.userId} value={m.userId}>
                                {m.displayName ?? m.userId}
                              </option>
                            ))}
                          </NativeSelect>
                        }
                      />
                    ) : null}{' '}
                    <Button
                      type="button"
                      onClick={() =>
                        void assignMut.mutateAsync({ exceptionId: detailId, assignedTo: null })
                      }
                    >
                      Unassign
                    </Button>
                  </p>
                </>
              ) : null}
            </>
          ) : null}
        </aside>
      ) : null}
      {confirm ? (
        <dialog open role="dialog" aria-labelledby="exception-confirm-title">
          <p id="exception-confirm-title">{confirm.copy}</p>
          <Button type="button" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button type="button" onClick={confirm.run}>
            Confirm
          </Button>
        </dialog>
      ) : null}
    </section>
  );
}
