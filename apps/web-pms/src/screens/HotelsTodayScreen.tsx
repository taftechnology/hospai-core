import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Card,
  CardContent,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyState,
  PageHeader,
  Skeleton,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { useTenantSwitcher } from '../shell/tenant-context.js';
import { auditBadge, headOfficeQueryKey, occupancyPercent } from './hotels-today-model.js';

/**
 * `/hotels-today` — the group's morning view (R7.4): one row per hotel with last night's close,
 * today's expected movement and whether its night audit finished. It reads the org's own
 * projection (each hotel feeds it after its audit), never the hotels on request, so the counts
 * are as of that audit, not live.
 */
export function HotelsTodayScreen() {
  const orgId = tenant.orgId;
  const { date, dateTime, money } = useFormat();
  const switcher = useTenantSwitcher();
  const org = switcher?.orgs.find((o) => o.orgId === orgId);

  const q = useQuery({
    queryKey: headOfficeQueryKey(orgId),
    queryFn: () => api.getOrgHeadOffice(orgId),
    retry: false,
  });

  const rows = q.data?.rows ?? [];
  const missing = q.data?.missing ?? [];
  const total = q.data?.total ?? null;
  const nameOf = (propertyId: string) =>
    org?.properties.find((p) => p.propertyId === propertyId)?.name ?? propertyId;

  let body;
  if (q.isPending) {
    body = (
      <Card>
        <CardContent>
          <Skeleton label="Loading hotels" lines={4} />
        </CardContent>
      </Card>
    );
  } else if (q.isError) {
    body = (
      <Alert data-testid="hotels-today-error">
        {classifiedUserMessage(asClassified(q.error), { fallback: 'Could not load the hotels.' })}
      </Alert>
    );
  } else if (rows.length === 0 && missing.length === 0) {
    body = (
      <Card>
        <CardContent>
          <EmptyState kind="empty" title="No hotels yet" data-testid="hotels-today-empty" />
        </CardContent>
      </Card>
    );
  } else {
    body = (
      <>
        {rows.length > 0 ? (
          <Card>
            <CardContent flush>
              <DataTable data-testid="hotels-today-table">
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell>Hotel</DataTableHeaderCell>
                    <DataTableHeaderCell>Business date</DataTableHeaderCell>
                    <DataTableHeaderCell>Night audit</DataTableHeaderCell>
                    <DataTableHeaderCell align="right">Last night occupancy</DataTableHeaderCell>
                    <DataTableHeaderCell align="right">Last night room revenue</DataTableHeaderCell>
                    <DataTableHeaderCell align="right">Arrivals</DataTableHeaderCell>
                    <DataTableHeaderCell align="right">Departures</DataTableHeaderCell>
                    <DataTableHeaderCell align="right">In house</DataTableHeaderCell>
                    <DataTableHeaderCell>Updated</DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {rows.map((r) => {
                    const badge = auditBadge(r.audit, date);
                    const pct = r.closed ? occupancyPercent(r.closed.roomsSold, r.closed.roomsSellable) : null;
                    return (
                      <DataTableRow key={r.propertyId} data-testid={`hotels-today-row-${r.propertyId}`}>
                        <DataTableCell>{r.propertyName}</DataTableCell>
                        <DataTableCell>{date(r.businessDate)}</DataTableCell>
                        <DataTableCell>
                          <Badge rung={badge.rung} data-testid={`hotels-today-audit-${r.propertyId}`}>
                            {badge.text}
                          </Badge>
                        </DataTableCell>
                        <DataTableCell align="right">
                          {r.closed ? (
                            <span className="ui-num">
                              {r.closed.roomsSold} / {r.closed.roomsSellable}
                              {pct === null ? '' : ` (${pct}%)`}
                            </span>
                          ) : (
                            <span className="muted">No close yet</span>
                          )}
                        </DataTableCell>
                        <DataTableCell align="right">
                          {r.closed ? (
                            <span className="ui-num">{money(r.closed.roomRevenueMinor, r.closed.currency)}</span>
                          ) : (
                            <span className="muted">No close yet</span>
                          )}
                        </DataTableCell>
                        <DataTableCell align="right">
                          <span className="ui-num">{r.today.arrivals}</span>
                        </DataTableCell>
                        <DataTableCell align="right">
                          <span className="ui-num">{r.today.departuresDue}</span>
                        </DataTableCell>
                        <DataTableCell align="right">
                          <span className="ui-num">{r.today.inHouse}</span>
                        </DataTableCell>
                        <DataTableCell>{dateTime(r.updatedAt)}</DataTableCell>
                      </DataTableRow>
                    );
                  })}
                  {total ? (
                    <DataTableRow data-testid="hotels-today-total">
                      <DataTableHeaderCell colSpan={3}>
                        Total for {rows[0]?.closed ? date(rows[0].closed.businessDate) : 'last night'}
                      </DataTableHeaderCell>
                      <DataTableCell align="right">
                        <span className="ui-num">
                          {total.roomsSold} / {total.roomsSellable}
                          {occupancyPercent(total.roomsSold, total.roomsSellable) === null
                            ? ''
                            : ` (${occupancyPercent(total.roomsSold, total.roomsSellable)}%)`}
                        </span>
                      </DataTableCell>
                      <DataTableCell align="right">
                        <span className="ui-num">{money(total.roomRevenueMinor, total.currency)}</span>
                      </DataTableCell>
                      <DataTableCell colSpan={4} />
                    </DataTableRow>
                  ) : null}
                </DataTableBody>
              </DataTable>
            </CardContent>
          </Card>
        ) : null}
        {missing.length > 0 ? (
          <Card>
            <CardContent>
              <ul data-testid="hotels-today-missing">
                {missing.map((id) => (
                  <li key={id}>
                    <strong>{nameOf(id)}</strong>: No summary yet. It appears after this hotel&apos;s next night
                    audit.
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Hotels today" subtitle={org?.name ?? undefined} />
      <p className="muted" data-testid="hotels-today-note">
        Updated after each hotel&apos;s night audit. Today&apos;s counts are as of that time, not live.
      </p>
      {body}
    </>
  );
}
