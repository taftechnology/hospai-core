import { statusClass } from '../status/status-class.js';
import { useFormat } from './PropertyFormat.js';

export function StaleWatermark({
  asOf,
  stale,
}: {
  asOf: number | null;
  stale: boolean;
}) {
  const { dateTime } = useFormat();
  if (!stale || asOf == null) return null;
  return (
    <div
      data-testid="stale-watermark"
      role="status"
      aria-live="polite"
      className={`stale-watermark ${statusClass('attention')}`}
    >
      Live updates paused — showing data from {dateTime(asOf)}.
    </div>
  );
}
