import { Button, Field, Input, PageHeader } from '@hospai/ui-kit';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useOpsWrite } from '../api/hooks.js';
import { opsKeys } from '../api/keys.js';
import { useIsAdmin } from '../auth/OperatorContext.js';
import { ReadOnlyNote } from '../components/common.js';
import { ReasonFields, WriteResult, useWriteController } from '../components/write.js';
import { newId } from '../format.js';

export function CreateCustomerScreen() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [orgId, setOrgId] = useState(() => newId('org'));
  const [name, setName] = useState('');
  const [planCode, setPlanCode] = useState('');
  const write = useOpsWrite('/customers', () => [opsKeys.customersAll(), opsKeys.actionsAll()]);
  const c = useWriteController(
    write,
    () =>
      orgId.trim() && name.trim() && planCode.trim()
        ? { payload: { orgId: orgId.trim(), name: name.trim(), planCode: planCode.trim() } }
        : { error: 'Customer id, name and plan code are required.' },
  );

  return (
    <>
      <PageHeader
        title="Create customer"
        subtitle="Creates the customer and its subscription. Add hotels and an owner afterwards."
        back={<Link to="/customers">All customers</Link>}
      />
      {isAdmin ? (
        <div className="ops-form">
          <Field
            label="Customer name"
            control={<Input value={name} onChange={(e) => setName(e.target.value)} />}
          />
          <Field
            label="Customer id"
            hint="Chosen once; it cannot change. A new one is suggested."
            control={<Input value={orgId} onChange={(e) => setOrgId(e.target.value)} />}
          />
          <Field
            label="Plan code"
            control={<Input value={planCode} onChange={(e) => setPlanCode(e.target.value)} />}
          />
          <ReasonFields c={c} />
          <WriteResult c={c} doneText="The customer is created." />
          {c.succeeded ? (
            <Button intent="primary" onClick={() => void navigate(`/customers/${encodeURIComponent(orgId.trim())}`)}>
              Open customer
            </Button>
          ) : (
            <Button intent="primary" disabled={c.pending} onClick={c.submit}>
              {c.pending ? 'Working' : 'Create customer'}
            </Button>
          )}
        </div>
      ) : (
        <ReadOnlyNote />
      )}
    </>
  );
}
