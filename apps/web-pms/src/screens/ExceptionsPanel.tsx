import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  hasPropertyPermission,
  meShellStateFromQuery,
  type PropertyMe,
} from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { exceptionBadgeSeverity } from '../status/exception-badge-severity.js';
import { statusClass } from '../status/status-class.js';

type ExceptionRow = { exceptionId: string; [key: string]: unknown };

function exceptionsFromBody(body: unknown): ExceptionRow[] {
  if (Array.isArray(body)) return body as ExceptionRow[];
  if (body && typeof body === 'object' && Array.isArray((body as { exceptions?: unknown }).exceptions)) {
    return (body as { exceptions: ExceptionRow[] }).exceptions;
  }
  return [];
}

export function ExceptionsPanel() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const propertyId = tenant.propertyId;

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
  const canResolve = Boolean(me && hasPropertyPermission(me, 'night_audit:run'));

  const countQ = useQuery({
    queryKey: ['provisional-exception-count', propertyId],
    queryFn: () => api.getProvisionalExceptionCount(propertyId),
    retry: false,
  });
  const listQ = useQuery({
    queryKey: ['provisional-exceptions', propertyId],
    queryFn: () => api.getProvisionalExceptions(propertyId),
    enabled: open,
    retry: false,
  });

  const resolveMutation = useMutation({
    mutationFn: (exceptionId: string) =>
      api.resolveProvisionalException(
        propertyId,
        exceptionId,
        `provisional:resolve:${propertyId}:${exceptionId}`,
      ),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['provisional-exception-count', propertyId] });
      await queryClient.invalidateQueries({ queryKey: ['provisional-exceptions', propertyId] });
    },
  });

  const count = countQ.data?.exceptionCount ?? 0;
  const badgeSev = exceptionBadgeSeverity(count);
  const exceptions = exceptionsFromBody(listQ.data);

  return (
    <section id="replay-exceptions" className="panel" data-testid="exceptions-panel">
      <h2>
        Replay exceptions{' '}
        <button type="button" onClick={() => setOpen((v) => !v)}>
          <span className={`badge ${statusClass(badgeSev)}`}>{count}</span>
        </button>
      </h2>
      {countQ.isError && asClassified(countQ.error).class === 'fail_closed' ? (
        <p className="error">Exceptions unavailable — property unreachable</p>
      ) : null}
      {open ? (
        listQ.isLoading ? (
          <p className="muted">Loading…</p>
        ) : (
          <ul>
            {exceptions.map((row) => (
              <li key={row.exceptionId}>
                {row.exceptionId}
                {canResolve ? (
                  <>
                    {' '}
                    <button type="button" onClick={() => resolveMutation.mutate(row.exceptionId)}>
                      Resolve
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="muted">Open to reconcile failed replays</p>
      )}
    </section>
  );
}
