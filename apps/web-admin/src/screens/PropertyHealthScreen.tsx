import { Badge, Button, EmptyState, Metric, Metrics, PageHeader, SectionLabel } from '@hospai/ui-kit';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { usePropertyHealth } from '../api/hooks.js';
import { useIsAdmin } from '../auth/OperatorContext.js';
import { LoadFailure, LoadingBlock } from '../components/common.js';
import { formatAge } from '../format.js';
import { CopySetupDialog } from './CopySetupDialog.js';

export function PropertyHealthScreen() {
  const { orgId = '', propertyId = '' } = useParams();
  const q = usePropertyHealth(propertyId);
  const isAdmin = useIsAdmin();
  const [copyOpen, setCopyOpen] = useState(false);
  const back = <Link to={`/customers/${encodeURIComponent(orgId)}`}>Back to customer</Link>;

  if (q.isPending) {
    return (
      <>
        <PageHeader title="Hotel health" subtitle={propertyId} back={back} />
        <LoadingBlock label="Loading hotel health" />
      </>
    );
  }
  if (q.isError) {
    return (
      <>
        <PageHeader title="Hotel health" subtitle={propertyId} back={back} />
        <LoadFailure error={q.error} onRetry={() => void q.refetch()} />
      </>
    );
  }
  const h = q.data;
  const audit = h.lastNightAudit;
  return (
    <>
      <PageHeader
        title="Hotel health"
        subtitle={`${h.propertyId} of ${h.orgId}. Counts and dates only; no guest data.`}
        back={back}
        actions={isAdmin ? <Button onClick={() => setCopyOpen(true)}>Copy setup from another hotel</Button> : undefined}
      />
      {copyOpen ? (
        <CopySetupDialog orgId={orgId} targetPropertyId={propertyId} onClose={() => setCopyOpen(false)} />
      ) : null}
      <section className="ops-section">
        <SectionLabel>Now</SectionLabel>
        <Metrics>
          <Metric label="Business date" value={h.businessDate ?? 'Not set'} />
          <Metric label="Oldest pending event" value={formatAge(h.oldestOutboxAgeMs)} />
          <Metric label="Active staff" value={String(h.activeMemberCount)} />
          <Metric label="Schema version" value={String(h.schemaVersion)} />
        </Metrics>
      </section>
      <section className="ops-section">
        <SectionLabel>Inventory</SectionLabel>
        <Metrics>
          <Metric label="Rooms" value={String(h.roomCount)} />
          <Metric label="Room types" value={String(h.roomTypeCount)} />
        </Metrics>
      </section>
      <section className="ops-section">
        <SectionLabel>Last night audit</SectionLabel>
        {audit ? (
          <Metrics>
            <Metric label="Business date" value={audit.businessDate} />
            <Metric
              label="Status"
              value={<Badge rung={audit.status === 'COMPLETED' ? 'settled' : audit.status === 'FAILED' ? 'exception' : 'attention'}>{audit.status}</Badge>}
            />
            <Metric label="Open exceptions" value={String(audit.exceptionCount)} />
          </Metrics>
        ) : (
          <EmptyState title="No night audit has run yet" />
        )}
      </section>
    </>
  );
}
