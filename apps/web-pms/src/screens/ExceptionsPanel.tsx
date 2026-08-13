import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, asClassified, tenant } from '../client.js';
import { exceptionBadgeSeverity } from '../status/exception-badge-severity.js';
import { statusClass } from '../status/status-class.js';

export function ExceptionsPanel() {
  const propertyId = tenant.propertyId;

  const countQ = useQuery({
    queryKey: ['provisional-exception-count', propertyId],
    queryFn: () => api.getProvisionalExceptionCount(propertyId),
    retry: false,
  });

  const count = countQ.data?.exceptionCount ?? 0;
  const badgeSev = exceptionBadgeSeverity(count);

  return (
    <section id="replay-exceptions" className="panel" data-testid="exceptions-panel">
      <h2>
        <Link to="/exceptions">
          Exceptions{' '}
          <span className={`badge ${statusClass(badgeSev)}`}>{count}</span>
        </Link>
      </h2>
      {countQ.isError && asClassified(countQ.error).class === 'fail_closed' ? (
        <p className="error">Exceptions unavailable — property unreachable</p>
      ) : null}
    </section>
  );
}
