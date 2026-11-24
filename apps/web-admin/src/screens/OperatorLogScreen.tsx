import { Button, Field, Input, PageHeader, Toolbar } from '@hospai/ui-kit';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useOperatorActions } from '../api/hooks.js';
import { LoadFailure, LoadingBlock, Pager } from '../components/common.js';
import { OperatorActionsTable } from './OperatorActionsTable.js';

export function OperatorLogScreen() {
  const [params, setParams] = useSearchParams();
  const orgId = params.get('orgId') ?? '';
  const operatorId = params.get('operatorId') ?? '';
  const pageRaw = Number(params.get('page') ?? '1');
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const [orgDraft, setOrgDraft] = useState(orgId);
  const [opDraft, setOpDraft] = useState(operatorId);
  const q = useOperatorActions(orgId, operatorId, page);
  const filtered = Boolean(orgId || operatorId);

  function go(o: string, p: string, nextPage: number) {
    const next = new URLSearchParams();
    if (o) next.set('orgId', o);
    if (p) next.set('operatorId', p);
    if (nextPage > 1) next.set('page', String(nextPage));
    setParams(next);
  }

  return (
    <>
      <PageHeader title="Operator log" subtitle="Every change an operator made, newest first." />
      <Toolbar>
        <Field label="Customer id" control={<Input value={orgDraft} onChange={(e) => setOrgDraft(e.target.value)} />} />
        <Field label="Operator id" control={<Input value={opDraft} onChange={(e) => setOpDraft(e.target.value)} />} />
        <Button intent="primary" onClick={() => go(orgDraft.trim(), opDraft.trim(), 1)}>
          Filter
        </Button>
        {filtered ? (
          <Button
            onClick={() => {
              setOrgDraft('');
              setOpDraft('');
              go('', '', 1);
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </Toolbar>
      {q.isPending ? <LoadingBlock label="Loading operator log" /> : null}
      {q.isError ? <LoadFailure error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isSuccess ? (
        <>
          <OperatorActionsTable
            actions={q.data.actions}
            showOrg
            emptyTitle={filtered ? 'No operator action matches those filters' : 'No operator actions yet'}
          />
          {q.data.actions.length > 0 || page > 1 ? (
            <Pager page={q.data.page} hasMore={q.data.hasMore} onPage={(p) => go(orgId, operatorId, p)} />
          ) : null}
        </>
      ) : null}
    </>
  );
}
