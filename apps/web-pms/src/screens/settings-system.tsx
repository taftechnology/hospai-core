import type { ReactNode } from 'react';
import { Alert, Card, CardContent, CardHeader, CardTitle, Input, Field } from '@hospai/ui-kit';
import { SettingsDomainBool, type DomainKey } from './settings-domain-fields.js';

function lookup(keys: DomainKey[], key: string): unknown {
  return keys.find((k) => k.key === key)?.value;
}

export function SettingsSystemTab(props: {
  keys: DomainKey[];
  reason: string;
  propertyId: string;
  onSaved: () => void;
  reasonControl: ReactNode;
}) {
  const common = { reason: props.reason, propertyId: props.propertyId, onSaved: props.onSaved };
  return (
    <>
      <Alert intent="attention">
        <span className="ui-alert__title">A reason is required before saving</span>
        <span>Every configuration change is written to the audit log with this note.</span>
      </Alert>
      <Card>
        <CardContent>{props.reasonControl}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>System</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="settings-property__grid">
            <SettingsDomainBool
              label="Auto-assign a room at check-in when none is picked"
              configKey="pms.ops.auto_assign_rooms"
              initial={lookup(props.keys, 'pms.ops.auto_assign_rooms')}
              hint="When on, check-in without a room picks the lowest room code of the booked type that is vacant and ready."
              {...common}
            />
            <SettingsDomainBool
              label="Let staff check in to a room that isn't clean (override)"
              configKey="pms.reservations.allow_dirty_check_in_override"
              initial={lookup(props.keys, 'pms.reservations.allow_dirty_check_in_override')}
              hint="When off, a clerk cannot check in to a room that isn't clean, even if they choose the cleanliness override."
              {...common}
            />
            <SettingsDomainBool
              label="Let staff check out while the guest window still has a balance (override)"
              configKey="pms.reservations.allow_balance_override"
              initial={lookup(props.keys, 'pms.reservations.allow_balance_override')}
              hint="When off, checkout is refused while the guest window balance is above zero, even if the clerk asks to override. Company windows are not this check."
              {...common}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}

export function SettingsSystemReasonField(props: {
  reason: string;
  onReasonChange: (value: string) => void;
}) {
  return (
    <Field
      label="Reason"
      control={
        <Input
          value={props.reason}
          onChange={(e) => props.onReasonChange(e.target.value)}
          placeholder="Why this change…"
          autoComplete="off"
        />
      }
    />
  );
}
