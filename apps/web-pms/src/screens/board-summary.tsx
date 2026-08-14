import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { shouldRetry, retryDelay } from '@hospai/client-core';
import { api, asClassified, tenant } from '../client.js';
import { Badge } from '@hospai/ui-kit';

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
    <div data-testid="board-summary" className="board-summary tabular-nums">
      <Link className="chip" to={`/arrivals?date=${encodeURIComponent(date)}`}>
        Arrivals {s.arrivals}
      </Link>
      <Link className="chip" to={`/departures?date=${encodeURIComponent(date)}`}>
        Due out {s.departuresDue}
      </Link>
      <Link className="chip" to="/in-house">
        In-house {s.inHouse}
      </Link>
      {s.overstay > 0 ? (
        <Badge rung="exception" data-testid="board-summary-overstay">
          Overstay {s.overstay}
        </Badge>
      ) : null}
      <span className="chip">
        Occupancy {s.occupancy.occupiedRooms} / {s.occupancy.sellableRooms}
      </span>
    </div>
  );
}
