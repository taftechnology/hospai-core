import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge } from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { exceptionBadgeSeverity } from '../status/exception-badge-severity.js';

export function ExceptionsPanel() {
  const propertyId = tenant.propertyId;

  const countQ = useQuery({
    queryKey: ['provisional-exception-count', propertyId],
    queryFn: () => api.getProvisionalExceptionCount(propertyId),
    retry: false,
  });
  const eventQ = useQuery({
    queryKey: ['event-consumer-exception-count', propertyId],
    queryFn: () => api.listEventConsumerExceptions(propertyId, { status: 'open', limit: 1 }),
    retry: false,
  });

  const count = (countQ.data?.exceptionCount ?? 0) + (eventQ.data?.count ?? 0);
  const badgeSev = exceptionBadgeSeverity(count);
  const failClosed =
    (countQ.isError && asClassified(countQ.error).class === 'fail_closed') ||
    (eventQ.isError && asClassified(eventQ.error).class === 'fail_closed');

  // Nothing to act on: the sidebar's Exceptions link stays, the footer row goes.
  if (count === 0 && !countQ.isError && !eventQ.isError) return null;

  return (
    <details
      id="replay-exceptions"
      className="side-panel"
      data-testid="exceptions-panel"
      open={count > 0 || countQ.isError}
    >
      <summary>
        <Link to="/exceptions">
          Exceptions{' '}
          <Badge rung={badgeSev}>{count}</Badge>
        </Link>
      </summary>
      {failClosed ? <Alert>Exceptions unavailable — property unreachable</Alert> : null}
    </details>
  );
}
