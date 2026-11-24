import { Field, Input, NativeSelect } from '@hospai/ui-kit';
import { useState } from 'react';
import { useOpsWrite } from '../api/hooks.js';
import { opsKeys } from '../api/keys.js';
import { WriteDialog } from '../components/write.js';
import { newId } from '../format.js';

type ActionProps = { orgId: string; onClose: () => void };

/** What a write to one customer changes on screen: that customer, the list, and the log. */
const customerKeys = (orgId: string) => () => [
  opsKeys.customer(orgId),
  opsKeys.customersAll(),
  opsKeys.actionsAll(),
];

const text = (v: string) => v.trim();

export function SuspendDialog({ orgId, onClose }: ActionProps) {
  const write = useOpsWrite(`/customers/${encodeURIComponent(orgId)}/suspend`, customerKeys(orgId));
  return (
    <WriteDialog
      title="Suspend customer"
      submitLabel="Suspend customer"
      doneText="The customer is suspended. Its hotels are read-only."
      destructive
      write={write}
      build={() => ({ payload: {} })}
      onClose={onClose}
      intro={<p>Every hotel of this customer becomes read-only until you reinstate it. Confirm with a reason.</p>}
    />
  );
}

export function ReinstateDialog({ orgId, onClose }: ActionProps) {
  const write = useOpsWrite(`/customers/${encodeURIComponent(orgId)}/reinstate`, customerKeys(orgId));
  return (
    <WriteDialog
      title="Reinstate customer"
      submitLabel="Reinstate customer"
      doneText="The customer is active again."
      write={write}
      build={() => ({ payload: {} })}
      onClose={onClose}
    />
  );
}

export function ChangePlanDialog({ orgId, currentPlan, onClose }: ActionProps & { currentPlan: string | null }) {
  const [planCode, setPlanCode] = useState('');
  const write = useOpsWrite(`/customers/${encodeURIComponent(orgId)}/plan`, customerKeys(orgId));
  return (
    <WriteDialog
      title="Change plan"
      submitLabel="Change plan"
      doneText="The plan is changed."
      write={write}
      build={() => (text(planCode) ? { payload: { planCode: text(planCode) } } : { error: 'Enter a plan code.' })}
      onClose={onClose}
    >
      <Field
        label="New plan code"
        hint={currentPlan ? `Current plan: ${currentPlan}` : undefined}
        control={<Input value={planCode} onChange={(e) => setPlanCode(e.target.value)} />}
      />
    </WriteDialog>
  );
}

export function SetAddonDialog({ orgId, onClose }: ActionProps) {
  const [addonCode, setAddonCode] = useState('');
  const [quantity, setQuantity] = useState('1');
  const write = useOpsWrite(`/customers/${encodeURIComponent(orgId)}/addons`, customerKeys(orgId));
  return (
    <WriteDialog
      title="Set add-on"
      submitLabel="Set add-on"
      doneText="The add-on is updated."
      write={write}
      build={() => {
        const n = Number(quantity);
        if (!text(addonCode)) return { error: 'Enter an add-on code.' };
        if (!Number.isInteger(n) || n < 0) return { error: 'Quantity is a whole number, 0 or more. 0 removes the add-on.' };
        return { payload: { addonCode: text(addonCode), quantity: n } };
      }}
      onClose={onClose}
    >
      <Field label="Add-on code" control={<Input value={addonCode} onChange={(e) => setAddonCode(e.target.value)} />} />
      <Field
        label="Quantity"
        hint="0 removes the add-on."
        size="xs"
        control={<Input type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} />}
      />
    </WriteDialog>
  );
}

export function AddOwnerDialog({ orgId, onClose }: ActionProps) {
  const [email, setEmail] = useState('');
  const write = useOpsWrite(`/customers/${encodeURIComponent(orgId)}/owners`, customerKeys(orgId));
  return (
    <WriteDialog
      title="Add owner"
      submitLabel="Add owner"
      doneText="The person is now an owner of this customer."
      write={write}
      build={() => (text(email).includes('@') ? { payload: { email: text(email) } } : { error: 'Enter an email address.' })}
      onClose={onClose}
      intro={<p>The person must have signed up to the hotel app first. Only their user id is stored.</p>}
    >
      <Field label="Email" control={<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />} />
    </WriteDialog>
  );
}

const JURISDICTIONS = ['', 'eu', 'us', 'fedramp'] as const;

export function AddHotelDialog({ orgId, onClose }: ActionProps) {
  const [name, setName] = useState('');
  const [propertyId, setPropertyId] = useState(() => newId('prop'));
  const [timeZone, setTimeZone] = useState('');
  const [currency, setCurrency] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const write = useOpsWrite(`/customers/${encodeURIComponent(orgId)}/properties`, customerKeys(orgId));
  return (
    <WriteDialog
      title="Add hotel"
      submitLabel="Add hotel"
      doneText="The hotel is added."
      write={write}
      build={() => {
        if (!text(name) || !text(propertyId) || !text(timeZone) || !text(currency)) {
          return { error: 'Name, hotel id, time zone and currency are required.' };
        }
        return {
          payload: {
            propertyId: text(propertyId),
            name: text(name),
            timeZone: text(timeZone),
            currency: text(currency).toUpperCase(),
            jurisdiction: jurisdiction || null,
          },
        };
      }}
      onClose={onClose}
    >
      <Field label="Hotel name" control={<Input value={name} onChange={(e) => setName(e.target.value)} />} />
      <Field
        label="Hotel id"
        hint="Chosen once; it cannot change. A new one is suggested."
        control={<Input value={propertyId} onChange={(e) => setPropertyId(e.target.value)} />}
      />
      <Field
        label="Time zone"
        hint="IANA name, for example Asia/Kolkata."
        control={<Input value={timeZone} onChange={(e) => setTimeZone(e.target.value)} />}
      />
      <Field
        label="Currency"
        hint="Three letters, for example INR."
        size="xs"
        control={<Input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value)} />}
      />
      <Field
        label="Jurisdiction"
        size="sm"
        control={
          <NativeSelect value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
            {JURISDICTIONS.map((j) => (
              <option key={j} value={j}>
                {j === '' ? 'Default' : j.toUpperCase()}
              </option>
            ))}
          </NativeSelect>
        }
      />
    </WriteDialog>
  );
}
