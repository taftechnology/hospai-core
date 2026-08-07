import { useQuery } from '@tanstack/react-query';
import { api, asClassified, tenant } from '../client.js';

export function ShiftStrip() {
  const q = useQuery({
    queryKey: ['shift', tenant.propertyId],
    queryFn: () => api.getShift(tenant.propertyId),
    retry: (count, err) => count < 1 && asClassified(err).class === 'read_stale',
  });

  if (q.isError) {
    const c = asClassified(q.error);
    if (c.class === 'fail_closed') {
      return <div className="shift-strip error">Shift unavailable — property unreachable</div>;
    }
    return <div className="shift-strip muted">Shift status unavailable</div>;
  }

  const body = q.data as { ok?: boolean; shift?: Record<string, unknown> | null } | undefined;
  if (!body || body.shift == null) {
    return <div className="shift-strip muted">No open shift</div>;
  }

  return (
    <div className="shift-strip">
      Open shift <strong>{String(body.shift.shiftId)}</strong> · float{' '}
      {String(body.shift.openingFloat)} · cash posts {String(body.shift.attributedCashCount)}
    </div>
  );
}
