import type { OperatorActionRow } from '@hospai/contracts';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyState,
} from '@hospai/ui-kit';
import { Link } from 'react-router';
import { describeAction, formatTime } from '../format.js';

export function OperatorActionsTable({
  actions,
  showOrg,
  emptyTitle = 'No operator actions yet',
}: {
  actions: OperatorActionRow[];
  showOrg: boolean;
  emptyTitle?: string;
}) {
  if (actions.length === 0) return <EmptyState title={emptyTitle} />;
  return (
    <DataTable>
      <DataTableHead>
        <DataTableRow>
          <DataTableHeaderCell>When</DataTableHeaderCell>
          <DataTableHeaderCell>Operator</DataTableHeaderCell>
          <DataTableHeaderCell>Command</DataTableHeaderCell>
          {showOrg ? <DataTableHeaderCell>Customer</DataTableHeaderCell> : null}
          <DataTableHeaderCell>Change</DataTableHeaderCell>
          <DataTableHeaderCell>Reason</DataTableHeaderCell>
          <DataTableHeaderCell>Ticket</DataTableHeaderCell>
        </DataTableRow>
      </DataTableHead>
      <DataTableBody>
        {actions.map((a) => (
          <DataTableRow key={a.actionId}>
            <DataTableCell>{formatTime(a.createdAt)}</DataTableCell>
            <DataTableCell>{a.operatorName}</DataTableCell>
            <DataTableCell>{a.commandId}</DataTableCell>
            {showOrg ? (
              <DataTableCell>
                {a.orgId ? <Link to={`/customers/${encodeURIComponent(a.orgId)}`}>{a.orgId}</Link> : 'none'}
              </DataTableCell>
            ) : null}
            <DataTableCell>{describeAction(a.commandId, a.before, a.after)}</DataTableCell>
            <DataTableCell>{a.reason}</DataTableCell>
            <DataTableCell>{a.ticketRef ?? ''}</DataTableCell>
          </DataTableRow>
        ))}
      </DataTableBody>
    </DataTable>
  );
}
