import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { shouldRetry, retryDelay } from '@hospai/client-core';
import { api, asClassified, tenant } from '../client.js';
import { Badge, Metrics } from '@hospai/ui-kit';

export function BoardSummary({ date }: { date: string | null }) {
  const summaryQ = useQuery({
    queryKey: ['front-desk-summary', tenant.propertyId, date],
    queryFn: () => api.getFrontOfficeSummary(tenant.propertyId, date!),
    enabled: date != null,
    retry: (n, err) => n < 2 && shouldRetry(asClassified(err)),
    retryDelay: (n, err) => retryDelay(asClassified(err), n),
  });

  if (!date || !summaryQ.data) return null;
  const s = summaryQ.data;

  return (
    <div data-testid="board-summary" className="tabular-nums">
      <Metrics>
        <Link className="ui-metric" to={`/arrivals?date=${encodeURIComponent(date)}`}>
          Arrivals <span className="ui-metric__value">{s.arrivals}</span>
        </Link>
        <Link className="ui-metric" to={`/departures?date=${encodeURIComponent(date)}`}>
          Due out <span className="ui-metric__value">{s.departuresDue}</span>
        </Link>
        <Link className="ui-metric" to="/in-house">
          In-house <span className="ui-metric__value">{s.inHouse}</span>
        </Link>
        {s.overstay > 0 ? (
          <Badge rung="exception" data-testid="board-summary-overstay">
            Overstay {s.overstay}
          </Badge>
        ) : null}
        <span className="ui-metric">
          Occupancy{' '}
          <span className="ui-metric__value">
            {s.occupancy.occupiedRooms} / {s.occupancy.sellableRooms}
          </span>
        </span>
      </Metrics>
    </div>
  );
}
