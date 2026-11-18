import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { addCalendarDays } from '@hospai/client-core';
import { zonedWallClockMs } from '@hospai/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Dialog,
  EmptyState,
  Field,
  Input,
  Skeleton,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { propertyLocalToday } from '../status/property-local-today.js';

const COMMAND_LABELS: Record<string, string> = {
  'reservations.create': 'Booking created',
  'reservations.assign_room': 'Room assigned',
  'reservations.check_in': 'Check in',
  'reservations.check_out': 'Check out',
  'reservations.cancel': 'Booking cancelled',
  'reservations.no_show': 'No-show',
  'reservations.update_status': 'Booking status changed',
  'folio.add_item': 'Folio line posted',
  'folio.authorize': 'Card authorised',
  'folio.capture': 'Card captured',
  'folio.void': 'Authorisation voided',
  'folio.record_cash_payment': 'Cash payment',
  'folio.transfer_charge': 'Charge transferred',
  'folio.open_window': 'Folio window opened',
  'folio.open_shift': 'Shift opened',
  'folio.close_shift': 'Shift closed',
  'folio.create_charge_code': 'Charge code created',
  'folio.update_charge_code': 'Charge code changed',
  'folio.create_tax_rule': 'Tax rule created',
  'invoice.generate': 'Invoice generated',
  'city_ledger.create_account': 'Company account created',
  'rates.upsert_day': 'Rate changed',
  'rooms.create': 'Room created',
  'rooms.update_status': 'Room status changed',
  'rooms.set_ooo_range': 'Out of order set',
  'inventory.add_room_type': 'Room type created',
  'config.put_domain': 'Setting changed',
  'night_audit.run': 'Night audit',
};

/** Unmapped ids read as "Namespace · action words" rather than a raw id. */
function commandLabel(commandId: string): string {
  const known = COMMAND_LABELS[commandId];
  if (known) return known;
  const [ns, action] = commandId.split('.', 2);
  if (!ns || !action) return commandId;
  const words = (s: string) => s.replace(/_/g, ' ');
  const nsLabel = words(ns);
  return `${nsLabel.charAt(0).toUpperCase()}${nsLabel.slice(1)} · ${words(action)}`;
}

function shortEntityId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…`;
}

function auditRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function auditCell(record: Record<string, unknown> | null, key: string): string {
  if (!record || !Object.hasOwn(record, key)) return '—';
  const value = record[key];
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Union of before/after keys. Null when neither side recorded any fields. */
function auditDetailRows(
  beforeJson: unknown,
  afterJson: unknown,
): Array<{ field: string; before: string; after: string }> | null {
  const before = auditRecord(beforeJson);
  const after = auditRecord(afterJson);
  const fields = [...new Set([...(before ? Object.keys(before) : []), ...(after ? Object.keys(after) : [])])].sort();
  if (fields.length === 0) return null;
  return fields.map((field) => ({
    field,
    before: auditCell(before, field),
    after: auditCell(after, field),
  }));
}

function AuditDetail({
  detail,
}: {
  detail: { beforeJson: unknown; afterJson: unknown };
}) {
  const rows = auditDetailRows(detail.beforeJson, detail.afterJson);
  if (!rows) {
    return <EmptyState kind="empty" title="No field details recorded." />;
  }
  return (
    <DataTable data-testid="audit-detail-table">
      <DataTableHead>
        <DataTableRow>
          <DataTableHeaderCell>Field</DataTableHeaderCell>
          <DataTableHeaderCell>Before</DataTableHeaderCell>
          <DataTableHeaderCell>After</DataTableHeaderCell>
        </DataTableRow>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <DataTableRow key={row.field}>
            <DataTableCell>{row.field}</DataTableCell>
            <DataTableCell>{row.before}</DataTableCell>
            <DataTableCell>{row.after}</DataTableCell>
          </DataTableRow>
        ))}
      </DataTableBody>
    </DataTable>
  );
}

export function SettingsLogsTab() {
  const propertyId = tenant.propertyId;
  const { dateTime } = useFormat();

  const propertyQ = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api.getProperty(propertyId),
    retry: false,
  });
  const timeZone = propertyQ.data?.property?.timeZone ?? null;
  const todayDefault = timeZone ? propertyLocalToday(timeZone) : '';

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [actor, setActor] = useState('');
  const [reservationId, setReservationId] = useState('');
  const [limit, setLimit] = useState(100);
  const [detailRow, setDetailRow] = useState<{
    beforeJson: unknown | null;
    afterJson: unknown;
    commandId: string;
  } | null>(null);

  const effectiveFrom = fromDate || todayDefault;
  const effectiveTo = toDate || todayDefault;

  const fromAt = useMemo(() => {
    if (!timeZone || !effectiveFrom) return null;
    return zonedWallClockMs(effectiveFrom, timeZone, 0, 0);
  }, [timeZone, effectiveFrom]);

  const toAt = useMemo(() => {
    if (!timeZone || !effectiveTo) return null;
    const dayAfter = addCalendarDays(effectiveTo, 1);
    return zonedWallClockMs(dayAfter, timeZone, 0, 0) - 1;
  }, [timeZone, effectiveTo]);

  const actorKey = actor.trim();
  const reservationKey = reservationId.trim();

  const auditQ = useQuery({
    queryKey: [
      'audit-log',
      propertyId,
      fromAt,
      toAt,
      actorKey,
      reservationKey,
      limit,
    ],
    queryFn: () =>
      api.getAuditLog(propertyId, {
        fromAt: fromAt ?? undefined,
        toAt: toAt ?? undefined,
        ...(actorKey ? { actor: actorKey } : {}),
        ...(reservationKey ? { reservationId: reservationKey } : {}),
        limit,
      }),
    enabled: fromAt !== null && toAt !== null,
    retry: false,
  });

  const isDefaultFilters =
    effectiveFrom === todayDefault &&
    effectiveTo === todayDefault &&
    !actorKey &&
    !reservationKey;

  const rows = auditQ.data?.ok ? auditQ.data.rows : [];

  const clearFilters = () => {
    setFromDate('');
    setToDate('');
    setActor('');
    setReservationId('');
    setLimit(100);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="settings-property__grid">
            <Field
              label="From"
              control={
                <Input
                  type="date"
                  value={fromDate || todayDefault}
                  onChange={(e) => setFromDate(e.target.value)}
                />
              }
            />
            <Field
              label="To"
              control={
                <Input
                  type="date"
                  value={toDate || todayDefault}
                  onChange={(e) => setToDate(e.target.value)}
                />
              }
            />
            <Field
              label="Actor"
              control={
                <Input
                  value={actor}
                  onChange={(e) => setActor(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Reservation"
              control={
                <Input
                  value={reservationId}
                  onChange={(e) => setReservationId(e.target.value)}
                  autoComplete="off"
                />
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        {auditQ.isPending || !timeZone ? (
          <CardContent>
            <Skeleton label="Loading audit log" lines={4} />
          </CardContent>
        ) : auditQ.isError ? (
          <CardContent>
            <Alert>
              {classifiedUserMessage(asClassified(auditQ.error), {
                fallback: 'Could not load the audit log.',
              })}
            </Alert>
          </CardContent>
        ) : rows.length === 0 ? (
          <CardContent>
            {isDefaultFilters ? (
              <EmptyState kind="empty" title="No audit entries for this property today." />
            ) : (
              <EmptyState
                kind="nomatch"
                title="No entries for these filters."
                action={
                  <Button type="button" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            )}
          </CardContent>
        ) : (
          <>
            <CardContent flush>
              <DataTable>
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell>Time</DataTableHeaderCell>
                    <DataTableHeaderCell>Who</DataTableHeaderCell>
                    <DataTableHeaderCell>Action</DataTableHeaderCell>
                    <DataTableHeaderCell>Item</DataTableHeaderCell>
                    <DataTableHeaderCell />
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {rows.map((row) => (
                    <DataTableRow key={row.seq}>
                      <DataTableCell>{dateTime(row.at)}</DataTableCell>
                      <DataTableCell>{row.actor}</DataTableCell>
                      <DataTableCell>{commandLabel(row.commandId)}</DataTableCell>
                      <DataTableCell>
                        {row.entityType} {shortEntityId(row.entityId)}
                        {row.reservationId ? (
                          <>
                            {' '}
                            <Link className="ui-link-btn" to={`/folio/${encodeURIComponent(row.reservationId)}`}>
                              Folio
                            </Link>
                          </>
                        ) : null}
                      </DataTableCell>
                      <DataTableCell>
                        <Button
                          type="button"
                          onClick={() =>
                            setDetailRow({
                              beforeJson: row.beforeJson,
                              afterJson: row.afterJson,
                              commandId: row.commandId,
                            })
                          }
                        >
                          Details
                        </Button>
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            </CardContent>
            {rows.length === limit && limit < 500 ? (
              <CardContent>
                <Button type="button" onClick={() => setLimit((l) => l + 100)}>
                  Load more
                </Button>
              </CardContent>
            ) : null}
            {rows.length === 500 && limit >= 500 ? (
              <CardContent>
                <p className="muted">
                  Showing the latest 500 entries for these filters — narrow the dates to see older
                  ones
                </p>
              </CardContent>
            ) : null}
          </>
        )}
      </Card>

      <Dialog
        open={detailRow !== null}
        onClose={() => setDetailRow(null)}
        title={detailRow ? commandLabel(detailRow.commandId) : 'Details'}
        footer={
          <Button type="button" onClick={() => setDetailRow(null)}>
            Close
          </Button>
        }
      >
        {detailRow ? (
          <AuditDetail detail={detailRow} />
        ) : null}
      </Dialog>
    </>
  );
}
