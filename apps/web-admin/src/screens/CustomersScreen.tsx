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
  Field,
  Input,
  PageHeader,
  Toolbar,
} from '@hospai/ui-kit';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useCustomers } from '../api/hooks.js';
import { useIsAdmin } from '../auth/OperatorContext.js';
import { LoadFailure, LoadingBlock, Pager } from '../components/common.js';
import { formatTime, limitLabel } from '../format.js';
import { statusRung } from './status.js';

export function CustomersScreen() {
  const isAdmin = useIsAdmin();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const pageRaw = Number(params.get('page') ?? '1');
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const [draft, setDraft] = useState(query);
  const q = useCustomers(query, page);

  function go(nextQuery: string, nextPage: number) {
    const next = new URLSearchParams();
    if (nextQuery) next.set('q', nextQuery);
    if (nextPage > 1) next.set('page', String(nextPage));
    setParams(next);
  }

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Every customer in the registry. Search by name or id."
        actions={
          isAdmin ? (
            <Link className="ui-link-btn ui-link-btn--primary" to="/customers/new">
              Create customer
            </Link>
          ) : undefined
        }
      />
      <Toolbar>
        <Field
          label="Search"
          control={<Input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} />}
        />
        <Button intent="primary" onClick={() => go(draft.trim(), 1)}>
          Search
        </Button>
        {query ? (
          <Button
            onClick={() => {
              setDraft('');
              go('', 1);
            }}
          >
            Clear search
          </Button>
        ) : null}
      </Toolbar>

      {q.isPending ? <LoadingBlock label="Loading customers" /> : null}
      {q.isError ? <LoadFailure error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isSuccess && q.data.customers.length === 0 ? (
        query ? (
          <EmptyState kind="nomatch" title="No customer matches that search" description="Check the spelling or search by org id." />
        ) : (
          <EmptyState title="No customers yet" description={isAdmin ? 'Use Create customer to add the first one.' : undefined} />
        )
      ) : null}
      {q.isSuccess && q.data.customers.length > 0 ? (
        <>
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Name</DataTableHeaderCell>
                <DataTableHeaderCell>Org id</DataTableHeaderCell>
                <DataTableHeaderCell>Status</DataTableHeaderCell>
                <DataTableHeaderCell>Plan</DataTableHeaderCell>
                <DataTableHeaderCell>Add-ons</DataTableHeaderCell>
                <DataTableHeaderCell align="right">Hotels</DataTableHeaderCell>
                <DataTableHeaderCell>Created</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {q.data.customers.map((c) => (
                <DataTableRow key={c.orgId}>
                  <DataTableCell>
                    <Link to={`/customers/${encodeURIComponent(c.orgId)}`}>{c.name}</Link>
                  </DataTableCell>
                  <DataTableCell>{c.orgId}</DataTableCell>
                  <DataTableCell>
                    <Badge rung={statusRung(c.status)}>{c.status}</Badge>
                  </DataTableCell>
                  <DataTableCell>{c.planCode ?? 'None'}</DataTableCell>
                  <DataTableCell>
                    {c.addons.length === 0 ? 'None' : c.addons.map((a) => `${a.addonCode} x${a.quantity}`).join(', ')}
                  </DataTableCell>
                  <DataTableCell align="right">{limitLabel(c.propertiesUsed, c.propertiesLimit)}</DataTableCell>
                  <DataTableCell>{formatTime(c.createdAt)}</DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
          <Pager page={q.data.page} hasMore={q.data.hasMore} onPage={(p) => go(query, p)} />
        </>
      ) : null}
    </>
  );
}
