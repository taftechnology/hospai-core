import {
  Badge,
  Button,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyState,
  PageHeader,
  SectionLabel,
} from '@hospai/ui-kit';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useCustomer } from '../api/hooks.js';
import { useIsAdmin } from '../auth/OperatorContext.js';
import { LoadFailure, LoadingBlock, ReadOnlyNote } from '../components/common.js';
import { formatTime, limitLabel } from '../format.js';
import { OperatorActionsTable } from './OperatorActionsTable.js';
import {
  AddHotelDialog,
  AddOwnerDialog,
  ChangePlanDialog,
  ReinstateDialog,
  SetAddonDialog,
  SuspendDialog,
} from './customer-actions.js';
import { statusRung } from './status.js';

type Open = 'suspend' | 'reinstate' | 'plan' | 'addon' | 'owner' | 'hotel' | null;

export function CustomerDetailScreen() {
  const { orgId = '' } = useParams();
  const isAdmin = useIsAdmin();
  const q = useCustomer(orgId);
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);

  if (q.isPending) {
    return (
      <>
        <PageHeader title="Customer" subtitle={orgId} back={<Link to="/customers">All customers</Link>} />
        <LoadingBlock label="Loading customer" />
      </>
    );
  }
  if (q.isError) {
    return (
      <>
        <PageHeader title="Customer" subtitle={orgId} back={<Link to="/customers">All customers</Link>} />
        <LoadFailure error={q.error} onRetry={() => void q.refetch()} />
      </>
    );
  }

  const d = q.data;
  return (
    <>
      <PageHeader
        title={d.org.name}
        subtitle={
          <>
            {d.org.orgId} <Badge rung={statusRung(d.org.status)}>{d.org.status}</Badge> Created {formatTime(d.org.createdAt)}
          </>
        }
        back={<Link to="/customers">All customers</Link>}
        actions={
          isAdmin ? (
            <>
              <Button onClick={() => setOpen('hotel')}>Add hotel</Button>
              <Button onClick={() => setOpen('plan')}>Change plan</Button>
              <Button onClick={() => setOpen('addon')}>Set add-on</Button>
              <Button onClick={() => setOpen('owner')}>Add owner</Button>
              {d.org.status === 'active' ? (
                <Button intent="destructive" onClick={() => setOpen('suspend')}>
                  Suspend
                </Button>
              ) : null}
              {d.org.status === 'suspended' ? <Button onClick={() => setOpen('reinstate')}>Reinstate</Button> : null}
            </>
          ) : undefined
        }
      />
      {isAdmin ? null : <ReadOnlyNote />}

      <section className="ops-section">
        <SectionLabel>Plan and add-ons</SectionLabel>
        <DataTable>
          <DataTableBody>
            <DataTableRow>
              <DataTableHeaderCell scope="row">Plan</DataTableHeaderCell>
              <DataTableCell>{d.subscription ? `${d.subscription.planCode} (${d.subscription.status})` : 'None'}</DataTableCell>
            </DataTableRow>
            <DataTableRow>
              <DataTableHeaderCell scope="row">Add-ons</DataTableHeaderCell>
              <DataTableCell>
                {d.addons.length === 0 ? 'None' : d.addons.map((a) => `${a.addonCode} x${a.quantity}`).join(', ')}
              </DataTableCell>
            </DataTableRow>
            <DataTableRow>
              <DataTableHeaderCell scope="row">Hotels used</DataTableHeaderCell>
              <DataTableCell>{limitLabel(d.propertiesUsed, d.propertiesLimit)}</DataTableCell>
            </DataTableRow>
          </DataTableBody>
        </DataTable>
      </section>

      <section className="ops-section">
        <SectionLabel>Hotels</SectionLabel>
        {d.properties.length === 0 ? (
          <EmptyState title="No hotels yet" description={isAdmin ? 'Use Add hotel to create the first one.' : undefined} />
        ) : (
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Name</DataTableHeaderCell>
                <DataTableHeaderCell>Hotel id</DataTableHeaderCell>
                <DataTableHeaderCell>Time zone</DataTableHeaderCell>
                <DataTableHeaderCell>Jurisdiction</DataTableHeaderCell>
                <DataTableHeaderCell>Status</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {d.properties.map((p) => (
                <DataTableRow key={p.propertyId}>
                  <DataTableCell>
                    <Link to={`/customers/${encodeURIComponent(d.org.orgId)}/hotels/${encodeURIComponent(p.propertyId)}`}>
                      {p.name}
                    </Link>
                  </DataTableCell>
                  <DataTableCell>{p.propertyId}</DataTableCell>
                  <DataTableCell>{p.timeZone}</DataTableCell>
                  <DataTableCell>{p.jurisdiction ?? 'Default'}</DataTableCell>
                  <DataTableCell>
                    <Badge rung={statusRung(p.status)}>{p.status}</Badge>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        )}
      </section>

      <section className="ops-section">
        <SectionLabel>Owners</SectionLabel>
        {d.owners.length === 0 ? (
          <EmptyState title="No owners yet" description={isAdmin ? 'Use Add owner once the person has signed up.' : undefined} />
        ) : (
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>User id</DataTableHeaderCell>
                <DataTableHeaderCell>Role</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {d.owners.map((o) => (
                <DataTableRow key={o.userId}>
                  <DataTableCell>{o.userId}</DataTableCell>
                  <DataTableCell>{o.role}</DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        )}
      </section>

      <section className="ops-section">
        <SectionLabel>Operator actions on this customer</SectionLabel>
        <OperatorActionsTable actions={d.actions} showOrg={false} />
      </section>

      {open === 'suspend' ? <SuspendDialog orgId={d.org.orgId} onClose={close} /> : null}
      {open === 'reinstate' ? <ReinstateDialog orgId={d.org.orgId} onClose={close} /> : null}
      {open === 'plan' ? (
        <ChangePlanDialog orgId={d.org.orgId} currentPlan={d.subscription?.planCode ?? null} onClose={close} />
      ) : null}
      {open === 'addon' ? <SetAddonDialog orgId={d.org.orgId} onClose={close} /> : null}
      {open === 'owner' ? <AddOwnerDialog orgId={d.org.orgId} onClose={close} /> : null}
      {open === 'hotel' ? <AddHotelDialog orgId={d.org.orgId} onClose={close} /> : null}
    </>
  );
}
