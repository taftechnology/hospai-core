import { useQuery } from '@tanstack/react-query';
import { shouldRetry, retryDelay } from '@hospai/client-core';
import { Skeleton } from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../../client.js';
import { hasPropertyPermission } from '../../auth/me.js';

export function TapeFreeRow({
  dates,
  tapeCols,
  roomTypeIdsOnTape,
  from,
  to,
}: {
  dates: string[];
  tapeCols: string;
  roomTypeIdsOnTape: Set<string>;
  from: string;
  to: string;
}) {
  const meQ = useQuery({
    queryKey: ['me', tenant.propertyId],
    queryFn: () => api.getMe(tenant.propertyId),
    staleTime: 60_000,
  });
  const canRead = meQ.data ? hasPropertyPermission(meQ.data, 'inventory:read') : false;

  const freeQ = useQuery({
    queryKey: ['front-desk-free', tenant.propertyId, from, to],
    queryFn: () => api.getAvailability(tenant.propertyId, { fromDate: from, toDate: to }),
    enabled: canRead,
    retry: (n, err) => n < 2 && shouldRetry(asClassified(err)),
    retryDelay: (n, err) => retryDelay(asClassified(err), n),
  });

  if (!canRead) return null;

  const pending = !freeQ.isSuccess && !freeQ.isError;
  const byDate = new Map<string, number>();
  if (freeQ.isSuccess) {
    for (const d of dates) byDate.set(d, 0);
    for (const item of freeQ.data.items) {
      if (!roomTypeIdsOnTape.has(item.roomTypeId)) continue;
      if (!byDate.has(item.stayDate)) continue;
      byDate.set(item.stayDate, (byDate.get(item.stayDate) ?? 0) + item.free);
    }
  }

  return (
    <div
      className="tape-row tape-row--free"
      role="row"
      style={{ ['--tape-cols' as string]: tapeCols }}
    >
      <div className="tape-room tape-corner" role="rowheader">
        Free
      </div>
      {dates.map((d) => {
        const failed = freeQ.isError;
        const value = byDate.get(d);
        const zero = freeQ.isSuccess && value === 0;
        return (
          <div
            key={d}
            className={`tape-free tape-head${zero ? ' tape-free--none' : ''}`}
            role="gridcell"
            style={{ ['--tape-col' as string]: String(2 + dates.indexOf(d) * 2) }}
          >
            {pending ? (
              <Skeleton label="Loading free rooms" width="1.5rem" height="0.75rem" />
            ) : failed ? (
              'Unavailable'
            ) : (
              value
            )}
          </div>
        );
      })}
    </div>
  );
}
