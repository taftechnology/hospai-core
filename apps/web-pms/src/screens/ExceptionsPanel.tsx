import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, asClassified, tenant } from '../client.js';
import { exceptionBadgeSeverity } from '../status/exception-badge-severity.js';
import { statusClass } from '../status/status-class.js';

export function ExceptionsPanel() {
  const [open, setOpen] = useState(false);
  const countQ = useQuery({
    queryKey: ['provisional-exception-count', tenant.propertyId],
    queryFn: () => api.getProvisionalExceptionCount(tenant.propertyId),
    retry: false,
  });
  const listQ = useQuery({
    queryKey: ['provisional-exceptions', tenant.propertyId],
    queryFn: () => api.getProvisionalExceptions(tenant.propertyId),
    enabled: open,
    retry: false,
  });

  const count = countQ.data?.exceptionCount ?? 0;
  const badgeSev = exceptionBadgeSeverity(count);

  return (
    <section className="panel">
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
          <pre className="exceptions-json">
            {JSON.stringify(listQ.data ?? [], null, 2)}
          </pre>
        )
      ) : (
        <p className="muted">Open to reconcile failed replays</p>
      )}
    </section>
  );
}
