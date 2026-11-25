import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OrgOperatorActionRow } from '@hospai/contracts';
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
  EmptyState,
  Skeleton,
} from '@hospai/ui-kit';
import { formatDateTime, propertyFormat } from '@hospai/client-core';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { useFormat } from '../shell/PropertyFormat.js';

const ACTION_LABELS: Record<string, string> = {
  'ops.create_org': 'Account created',
  'ops.add_property': 'Hotel added',
  'ops.add_org_owner': 'Owner added',
  'ops.set_plan': 'Plan changed',
  'ops.set_addon': 'Add-on changed',
  'ops.suspend_org': 'Account suspended',
  'ops.reinstate_org': 'Account reinstated',
  'ops.copy_setup': 'Setup copied from another hotel',
  'ops.restore_property': 'Hotel restored to an earlier time',
};

function actionLabel(commandId: string): string {
  return ACTION_LABELS[commandId] ?? 'Account change';
}

/** `{"planCode":"growth"}` reads as `planCode growth`. Plain data only: codes, statuses, ids. */
function summarise(value: unknown): string {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return '—';
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${k} ${v === null ? '—' : String(v)}`).join(', ');
}

/** The After column. A restore reads as a sentence on the hotel's own clock; the rest is `summarise`. */
function afterText(row: OrgOperatorActionRow, dateTime: (ms: number) => string): string {
  const a = row.after;
  if (row.commandId === 'ops.restore_property' && a && typeof a === 'object') {
    const r = a as Record<string, unknown>;
    if (r.kind === 'undo') return 'Undid the previous restore';
    if (r.kind === 'restore' && typeof r.targetTime === 'number') {
      if (typeof r.timeZone === 'string' && r.timeZone !== '') {
        try {
          return `Restored to ${formatDateTime(r.targetTime, propertyFormat({ timeZone: r.timeZone, currency: null }))} ${r.timeZone}`;
        } catch {
          // An unreadable zone name: fall through to the hotel-screen formatter.
        }
      }
      return `Restored to ${dateTime(r.targetTime)}`;
    }
  }
  return summarise(a);
}

/**
 * Read-only record of what HospAI changed on this account (R7.1 §6): who, when, why, before and
 * after. Org-wide, so it sits with the other record-keeping in Settings. Display name only; the
 * server never sends an email.
 */
export function SettingsAccountChanges() {
  const orgId = tenant.orgId;
  const [page, setPage] = useState(1);
  const { dateTime } = useFormat();

  const q = useQuery({
    queryKey: ['org-operator-actions', orgId, page],
    queryFn: () => api.getOrgOperatorActions(orgId, page),
    retry: false,
  });

  const rows: readonly OrgOperatorActionRow[] = q.data?.actions ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>HospAI account changes</CardTitle>
      </CardHeader>
      {q.isPending ? (
        <CardContent>
          <Skeleton label="Loading account changes" lines={3} />
        </CardContent>
      ) : q.isError ? (
        <CardContent>
          <Alert>
            {classifiedUserMessage(asClassified(q.error), {
              fallback: 'Could not load account changes.',
            })}
          </Alert>
        </CardContent>
      ) : rows.length === 0 ? (
        <CardContent>
          <EmptyState kind="empty" title="HospAI has not changed anything on this account." />
        </CardContent>
      ) : (
        <>
          <CardContent flush>
            <DataTable data-testid="account-changes-table">
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>When</DataTableHeaderCell>
                  <DataTableHeaderCell>Who</DataTableHeaderCell>
                  <DataTableHeaderCell>Change</DataTableHeaderCell>
                  <DataTableHeaderCell>Reason</DataTableHeaderCell>
                  <DataTableHeaderCell>Before</DataTableHeaderCell>
                  <DataTableHeaderCell>After</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {rows.map((row) => (
                  <DataTableRow key={row.actionId}>
                    <DataTableCell>{dateTime(row.createdAt)}</DataTableCell>
                    <DataTableCell>{row.operatorName}</DataTableCell>
                    <DataTableCell>{actionLabel(row.commandId)}</DataTableCell>
                    <DataTableCell>{row.reason}</DataTableCell>
                    <DataTableCell>{summarise(row.before)}</DataTableCell>
                    <DataTableCell>{afterText(row, dateTime)}</DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          </CardContent>
          {page > 1 || q.data?.hasMore ? (
            <CardContent>
              <Button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Newer
              </Button>{' '}
              <Button type="button" disabled={!q.data?.hasMore} onClick={() => setPage((p) => p + 1)}>
                Older
              </Button>
            </CardContent>
          ) : null}
        </>
      )}
    </Card>
  );
}
