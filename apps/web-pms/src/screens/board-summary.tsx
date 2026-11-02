import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { shouldRetry, retryDelay } from '@hospai/client-core';
import { api, asClassified, tenant } from '../client.js';
import { Badge, CountStrip, Metric, Metrics } from '@hospai/ui-kit';

export function BoardSummary({
  date,
  layout = 'cards',
}: {
  date: string | null;
  layout?: 'cards' | 'strip';
}) {
  const summaryQ = useQuery({
    queryKey: ['front-desk-summary', tenant.propertyId, date],
    queryFn: () => api.getFrontOfficeSummary(tenant.propertyId, date!),
    enabled: date != null,
    retry: (n, err) => n < 2 && shouldRetry(asClassified(err)),
    retryDelay: (n, err) => retryDelay(asClassified(err), n),
  });

  if (!date || !summaryQ.data) return null;
  const s = summaryQ.data;

  if (layout === 'strip') {
    return (
      <div data-testid="board-summary" className="tabular-nums">
        <CountStrip label="Front desk summary">
          <Link className="ui-count" to={`/arrivals?date=${encodeURIComponent(date)}`}>
            <b>{s.arrivals}</b> arrivals
          </Link>
          <span className="ui-count-sep" aria-hidden="true">
            {' · '}
          </span>
          <Link className="ui-count" to={`/departures?date=${encodeURIComponent(date)}`}>
            <b>{s.departuresDue}</b> due out
          </Link>
          <span className="ui-count-sep" aria-hidden="true">
            {' · '}
          </span>
          <Link className="ui-count" to="/in-house">
            <b>{s.inHouse}</b> in house
          </Link>
          <span className="ui-count-sep" aria-hidden="true">
            {' · '}
          </span>
          {s.overstay > 0 ? (
            <>
              <Link
                className="ui-count ui-count--odd"
                to="/in-house"
                data-testid="board-summary-overstay"
              >
                <b>{s.overstay}</b> overstay
              </Link>
              <span className="ui-count-sep" aria-hidden="true">
                {' · '}
              </span>
            </>
          ) : null}
          <span className="ui-count">
            <b>{s.occupancy.occupiedRooms}</b> / <b>{s.occupancy.sellableRooms}</b> occupied
          </span>
        </CountStrip>
      </div>
    );
  }

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
          {s.overstay > 0 ? (
            <Badge rung="exception" data-testid="board-summary-overstay">
              {s.overstay} overstay
            </Badge>
          ) : null}
        </Link>
        <Metric
          label="Occupancy"
          value={`${s.occupancy.occupiedRooms} / ${s.occupancy.sellableRooms}`}
        />
      </Metrics>
    </div>
  );
}
