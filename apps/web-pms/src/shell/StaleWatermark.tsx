import { statusClass } from '../status/status-class.js';

export function StaleWatermark({
  asOf,
  stale,
  timeZone,
}: {
  asOf: number | null;
  stale: boolean;
  timeZone?: string | null;
}) {
  if (!stale || asOf == null) return null;
  const time = new Intl.DateTimeFormat(undefined, {
    timeZone: timeZone ?? undefined,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(asOf));
  return (
    <div
      data-testid="stale-watermark"
      role="status"
      aria-live="polite"
      className={`stale-watermark ${statusClass('attention')}`}
    >
      Live updates paused — showing data from {time}.
    </div>
  );
}
