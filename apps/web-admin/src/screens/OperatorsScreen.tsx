import { OPS_ROLES, type OperatorView, type OpsRole } from '@hospai/contracts';
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
  NativeSelect,
  PageHeader,
} from '@hospai/ui-kit';
import { useState } from 'react';
import { useOperators, useOpsWrite } from '../api/hooks.js';
import { opsKeys } from '../api/keys.js';
import { useIsAdmin, useOperator } from '../auth/OperatorContext.js';
import { LoadFailure, LoadingBlock } from '../components/common.js';
import { WriteDialog } from '../components/write.js';
import { statusRung } from './status.js';

/** An operator change shows in the list, the log and (for a self change) the signed-in role. */
const operatorKeys = () => [opsKeys.operators(), opsKeys.actionsAll(), opsKeys.me()];

function AddOperatorDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<OpsRole>('ops_viewer');
  const write = useOpsWrite('/operators', operatorKeys);
  return (
    <WriteDialog
      title="Add operator"
      submitLabel="Add operator"
      doneText="The operator is added. They sign in to the Ops Console with this email."
      write={write}
      build={() =>
        email.trim().includes('@') && displayName.trim()
          ? { payload: { email: email.trim(), displayName: displayName.trim(), role } }
          : { error: 'Enter an email address and a display name.' }
      }
      onClose={onClose}
    >
      <Field label="Email" control={<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />} />
      <Field label="Display name" control={<Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />} />
      <Field
        label="Role"
        size="sm"
        control={
          <NativeSelect value={role} onChange={(e) => setRole(e.target.value as OpsRole)}>
            {OPS_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </NativeSelect>
        }
      />
    </WriteDialog>
  );
}

function StatusDialog({ target, onClose }: { target: OperatorView; onClose: () => void }) {
  const next = target.status === 'active' ? 'disabled' : 'active';
  const write = useOpsWrite(`/operators/${encodeURIComponent(target.operatorId)}/status`, operatorKeys);
  return (
    <WriteDialog
      title={next === 'disabled' ? 'Disable operator' : 'Enable operator'}
      submitLabel={next === 'disabled' ? 'Disable operator' : 'Enable operator'}
      doneText={next === 'disabled' ? 'The operator is disabled and cannot sign in.' : 'The operator is active again.'}
      destructive={next === 'disabled'}
      write={write}
      build={() => ({ payload: { status: next } })}
      onClose={onClose}
      intro={<p>{target.displayName} ({target.email}) will be {next === 'disabled' ? 'unable to use the Ops Console' : 'able to use the Ops Console again'}.</p>}
    />
  );
}

function RoleDialog({ target, onClose }: { target: OperatorView; onClose: () => void }) {
  const [role, setRole] = useState<OpsRole>(target.role === 'ops_admin' ? 'ops_viewer' : 'ops_admin');
  const write = useOpsWrite(`/operators/${encodeURIComponent(target.operatorId)}/role`, operatorKeys);
  return (
    <WriteDialog
      title="Change role"
      submitLabel="Change role"
      doneText="The role is changed."
      write={write}
      build={() => ({ payload: { role } })}
      onClose={onClose}
    >
      <Field
        label={`New role for ${target.displayName}`}
        size="sm"
        control={
          <NativeSelect value={role} onChange={(e) => setRole(e.target.value as OpsRole)}>
            {OPS_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </NativeSelect>
        }
      />
    </WriteDialog>
  );
}

type Open = { kind: 'add' } | { kind: 'status'; target: OperatorView } | { kind: 'role'; target: OperatorView } | null;

export function OperatorsScreen() {
  const isAdmin = useIsAdmin();
  const me = useOperator();
  const q = useOperators(isAdmin);
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Operators" />
        <EmptyState kind="error" title="Ops admins only" description="Your role can read customers and the log, not the operator list." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Operators"
        subtitle="People who can use the Ops Console. Operators are disabled, never deleted."
        actions={<Button intent="primary" onClick={() => setOpen({ kind: 'add' })}>Add operator</Button>}
      />
      {q.isPending ? <LoadingBlock label="Loading operators" /> : null}
      {q.isError ? <LoadFailure error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isSuccess && q.data.length === 0 ? <EmptyState title="No operators yet" /> : null}
      {q.isSuccess && q.data.length > 0 ? (
        <DataTable>
          <DataTableHead>
            <DataTableRow>
              <DataTableHeaderCell>Name</DataTableHeaderCell>
              <DataTableHeaderCell>Email</DataTableHeaderCell>
              <DataTableHeaderCell>Role</DataTableHeaderCell>
              <DataTableHeaderCell>Status</DataTableHeaderCell>
              <DataTableHeaderCell>Actions</DataTableHeaderCell>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {q.data.map((o) => (
              <DataTableRow key={o.operatorId}>
                <DataTableCell>
                  {o.displayName}
                  {o.operatorId === me.operatorId ? ' (you)' : ''}
                </DataTableCell>
                <DataTableCell>{o.email}</DataTableCell>
                <DataTableCell>{o.role}</DataTableCell>
                <DataTableCell>
                  <Badge rung={statusRung(o.status)}>{o.status}</Badge>
                </DataTableCell>
                <DataTableCell>
                  <Button size="sm" onClick={() => setOpen({ kind: 'role', target: o })}>
                    Change role
                  </Button>{' '}
                  <Button
                    size="sm"
                    intent={o.status === 'active' ? 'destructive' : 'default'}
                    onClick={() => setOpen({ kind: 'status', target: o })}
                  >
                    {o.status === 'active' ? 'Disable' : 'Enable'}
                  </Button>
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      ) : null}
      {open?.kind === 'add' ? <AddOperatorDialog onClose={close} /> : null}
      {open?.kind === 'status' ? <StatusDialog target={open.target} onClose={close} /> : null}
      {open?.kind === 'role' ? <RoleDialog target={open.target} onClose={close} /> : null}
    </>
  );
}
