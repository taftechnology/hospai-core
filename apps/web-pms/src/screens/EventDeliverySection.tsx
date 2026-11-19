import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Dialog,
  EmptyState,
  Field,
  NativeSelect,
  Skeleton,
  Textarea,
} from '@hospai/ui-kit';
import { useState } from 'react';
import { hasPropertyPermission, meShellStateFromQuery, type PropertyMe } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { useFormat } from '../shell/PropertyFormat.js';

type DeliveryRow = {
  exceptionId: string;
  consumerId: string;
  consumerLabel: string;
  eventType: string;
  attempts: number;
  firstFailedAt: number;
  lastFailedAt: number;
  errorCode: string;
  errorDetail: string | null;
  resolvedAt: number | null;
};

export function EventDeliverySection() {
  const propertyId = tenant.propertyId;
  const format = useFormat();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissId, setDismissId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const meQ = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const shell = meShellStateFromQuery({
    status: meQ.status,
    data: meQ.data as PropertyMe | undefined,
    classified: meQ.isError ? asClassified(meQ.error) : undefined,
  });
  const me =
    shell.kind === 'authority' && shell.authority.kind === 'live' ? shell.authority.me : undefined;
  const canRead = Boolean(me && hasPropertyPermission(me, 'property:read'));
  const canRun = Boolean(me && hasPropertyPermission(me, 'night_audit:run'));

  const listQ = useQuery({
    queryKey: ['event-consumer-exceptions', propertyId, status],
    queryFn: () => api.listEventConsumerExceptions(propertyId, { status, limit: 50 }),
    enabled: canRead,
    retry: false,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['event-consumer-exceptions', propertyId] });
    void qc.invalidateQueries({ queryKey: ['event-consumer-exception-count', propertyId] });
  }

  const retryMut = useMutation({
    mutationFn: (exceptionId: string) =>
      api.retryEventConsumerException(
        propertyId,
        exceptionId,
        `event:retry:${propertyId}:${exceptionId}:${crypto.randomUUID()}`,
      ),
    onSuccess: () => {
      setActionError(null);
      setNotice('The event was re-sent.');
      invalidate();
    },
    onError: (err: unknown) => {
      setNotice(null);
      setActionError(classifiedUserMessage(asClassified(err), { fallback: 'Could not retry this event.' }));
    },
  });

  const dismissMut = useMutation({
    mutationFn: (input: { exceptionId: string; reason: string }) =>
      api.dismissEventConsumerException(
        propertyId,
        input.exceptionId,
        input.reason,
        `event:dismiss:${propertyId}:${input.exceptionId}:${crypto.randomUUID()}`,
      ),
    onSuccess: () => {
      setActionError(null);
      setNotice('The failure was dismissed.');
      setDismissId(null);
      setReason('');
      invalidate();
    },
    onError: (err: unknown) => {
      setNotice(null);
      setActionError(classifiedUserMessage(asClassified(err), { fallback: 'Could not dismiss this failure.' }));
    },
  });

  if (!canRead) return null;

  const rows = (listQ.data?.exceptions ?? []) as DeliveryRow[];
  const trimmed = reason.trim();
  const reasonOk = trimmed.length >= 1 && trimmed.length <= 500;

  return (
    <Card data-testid="event-delivery">
      <CardHeader>
        <CardTitle>Event delivery</CardTitle>
      </CardHeader>
      <CardContent>
        <Field
          label="Status"
          htmlFor="event-delivery-status"
          control={
            <NativeSelect
              id="event-delivery-status"
              value={status}
              onChange={(e) => setStatus(e.target.value === 'all' ? 'all' : 'open')}
            >
              <option value="open">Open</option>
              <option value="all">All</option>
            </NativeSelect>
          }
        />
        {notice ? <Alert intent="settled">{notice}</Alert> : null}
        {actionError ? <Alert intent="exception">{actionError}</Alert> : null}
        {!canRun ? (
          <Alert>Night audit permission is required to retry or dismiss.</Alert>
        ) : null}
        {listQ.isLoading ? <Skeleton label="Loading event delivery failures" lines={3} /> : null}
        {listQ.isError ? (
          <EmptyState
            kind="error"
            title="Could not load event delivery failures"
            description={classifiedUserMessage(asClassified(listQ.error), {
              fallback: 'Could not load event delivery failures.',
            })}
          />
        ) : null}
        {listQ.isSuccess && rows.length === 0 && status === 'open' ? (
          <EmptyState kind="empty" title="No event delivery failures." />
        ) : null}
        {listQ.isSuccess && rows.length === 0 && status === 'all' ? (
          <EmptyState kind="nomatch" title="No event delivery failures match this filter." />
        ) : null}
        {listQ.isSuccess && rows.length > 0 ? (
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Consumer</DataTableHeaderCell>
                <DataTableHeaderCell>Event</DataTableHeaderCell>
                <DataTableHeaderCell>Attempts</DataTableHeaderCell>
                <DataTableHeaderCell>First failed</DataTableHeaderCell>
                <DataTableHeaderCell>Last failed</DataTableHeaderCell>
                <DataTableHeaderCell>Error</DataTableHeaderCell>
                <DataTableHeaderCell>Actions</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => (
                <DataTableRow key={row.exceptionId}>
                  <DataTableCell>{row.consumerLabel}</DataTableCell>
                  <DataTableCell>{row.eventType}</DataTableCell>
                  <DataTableCell>{row.attempts}</DataTableCell>
                  <DataTableCell>{format.dateTime(row.firstFailedAt)}</DataTableCell>
                  <DataTableCell>{format.dateTime(row.lastFailedAt)}</DataTableCell>
                  <DataTableCell>
                    {row.errorCode}
                    {row.errorDetail ? ` — ${row.errorDetail}` : ''}
                  </DataTableCell>
                  <DataTableCell>
                    {row.resolvedAt == null ? (
                      <>
                        <Button
                          type="button"
                          disabled={!canRun || retryMut.isPending}
                          onClick={() => retryMut.mutate(row.exceptionId)}
                        >
                          Retry
                        </Button>{' '}
                        <Button
                          type="button"
                          intent="destructive"
                          disabled={!canRun || dismissMut.isPending}
                          onClick={() => {
                            setDismissId(row.exceptionId);
                            setReason('');
                          }}
                        >
                          Dismiss
                        </Button>
                      </>
                    ) : null}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        ) : null}
        <Dialog
          open={dismissId !== null}
          title="Dismiss event delivery failure"
          onClose={() => setDismissId(null)}
          footer={
            <>
              <Button type="button" onClick={() => setDismissId(null)}>
                Cancel
              </Button>{' '}
              <Button
                type="button"
                intent="destructive"
                disabled={!reasonOk || dismissMut.isPending}
                onClick={() => {
                  if (dismissId && reasonOk) dismissMut.mutate({ exceptionId: dismissId, reason: trimmed });
                }}
              >
                Dismiss
              </Button>
            </>
          }
        >
          <Field
            label="Reason"
            htmlFor="event-delivery-reason"
            control={
              <Textarea
                id="event-delivery-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            }
          />
        </Dialog>
      </CardContent>
    </Card>
  );
}
