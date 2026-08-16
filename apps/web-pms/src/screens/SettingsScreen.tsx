import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Checkbox,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  Textarea,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { useUnsavedChanges } from './use-unsaved-changes.js';

const SYSTEM_CHARGE_CODES = new Set([
  'ROOM',
  'PAYMENT',
  'CANCEL',
  'NO_SHOW',
  'DISCOUNT',
  'DAMAGE',
  'FX_GAIN',
  'FX_LOSS',
  'CHARGEBACK_FEE',
]);

type DomainKey = { key: string; value: unknown };

type ChargeRow = { code: string; name: string; status: string; taxGroup: string | null };
type RoutingRuleRow = {
  ruleId: string;
  chargeCode: string;
  destWindowKind: string;
  status: string;
};
type TaxRow = {
  taxRuleId: string;
  ruleKey: string;
  name: string;
  ruleType: string;
  rate: string;
  taxGroup: string;
  outputChargeCode: string;
  validFrom: string;
  validTo: string | null;
};

function lookup(keys: DomainKey[], key: string): unknown {
  return keys.find((k) => k.key === key)?.value;
}

function DomainBool(props: {
  label: string;
  configKey: string;
  initial: unknown;
  reason: string;
  hint?: string;
  propertyId: string;
  onSaved: () => void;
}) {
  const [on, setOn] = useState(Boolean(props.initial));
  useEffect(() => {
    setOn(Boolean(props.initial));
  }, [props.initial]);
  const save = useMutation({
    mutationFn: () =>
      api.putDomainConfig(props.propertyId, {
        key: props.configKey,
        value: on,
        reason: props.reason,
      }),
    onSuccess: props.onSaved,
  });
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field
        label={props.label}
        hint={props.hint}
        control={<Checkbox checked={on} onChange={(e) => setOn(e.target.checked)} />}
      />
      <Button type="submit" intent="primary" disabled={save.isPending || !props.reason.trim()}>
        {save.isPending ? 'Saving…' : `Save ${props.label}`}
      </Button>
    </form>
  );
}

function DomainText(props: {
  label: string;
  configKey: string;
  initial: unknown;
  reason: string;
  hint?: string;
  propertyId: string;
  onSaved: () => void;
  spellCheck?: boolean;
  json?: boolean;
  readOnly?: boolean;
  inputType?: string;
}) {
  const asString = props.json
    ? JSON.stringify(props.initial ?? (props.json ? [] : ''), null, 2)
    : String(props.initial ?? '');
  const [raw, setRaw] = useState(asString);
  useEffect(() => {
    setRaw(asString);
  }, [asString]);
  const save = useMutation({
    mutationFn: () => {
      let value: unknown = raw;
      if (props.json) value = JSON.parse(raw) as unknown;
      else if (props.inputType === 'number') value = Number(raw);
      return api.putDomainConfig(props.propertyId, {
        key: props.configKey,
        value,
        reason: props.reason,
      });
    },
    onSuccess: props.onSaved,
  });
  const inputType = props.inputType ?? 'text';
  const control = props.json ? (
    <Textarea
      value={raw}
      readOnly={props.readOnly}
      autoComplete="off"
      onChange={(e) => setRaw(e.target.value)}
    />
  ) : inputType === 'time' ? (
    <Input
      type="time"
      value={raw}
      readOnly={props.readOnly}
      disabled={props.readOnly}
      autoComplete="off"
      onChange={(e) => setRaw(e.target.value)}
    />
  ) : (
    <Input
      type={inputType === 'number' ? 'number' : 'text'}
      value={raw}
      readOnly={props.readOnly}
      disabled={props.readOnly}
      autoComplete="off"
      onChange={(e) => setRaw(e.target.value)}
    />
  );
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (props.readOnly) return;
        save.mutate();
      }}
    >
      <Field label={props.label} hint={props.hint} control={control} />
      {props.readOnly ? null : (
        <Button type="submit" intent="primary" disabled={save.isPending || !props.reason.trim()}>
          {save.isPending ? 'Saving…' : `Save ${props.label}`}
        </Button>
      )}
    </form>
  );
}

function DomainSelect(props: {
  label: string;
  configKey: string;
  initial: unknown;
  reason: string;
  options: string[];
  propertyId: string;
  onSaved: () => void;
}) {
  const [raw, setRaw] = useState(String(props.initial ?? props.options[0]));
  useEffect(() => {
    setRaw(String(props.initial ?? props.options[0]));
  }, [props.initial, props.options]);
  const save = useMutation({
    mutationFn: () =>
      api.putDomainConfig(props.propertyId, {
        key: props.configKey,
        value: raw,
        reason: props.reason,
      }),
    onSuccess: props.onSaved,
  });
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field
        label={props.label}
        control={
          <NativeSelect value={raw} onChange={(e) => setRaw(e.target.value)}>
            {props.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </NativeSelect>
        }
      />
      <Button type="submit" intent="primary" disabled={save.isPending || !props.reason.trim()}>
        {save.isPending ? 'Saving…' : `Save ${props.label}`}
      </Button>
    </form>
  );
}

export function SettingsScreen({ tab }: { tab?: 'property' | 'charges' | 'tax' }) {
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const activeTab = tab ?? 'property';
  const [reason, setReason] = useState('');
  const [propName, setPropName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [archiveCode, setArchiveCode] = useState<string | null>(null);

  const [chargeCode, setChargeCode] = useState('');
  const [chargeName, setChargeName] = useState('');
  const [taxName, setTaxName] = useState('');
  const [taxKey, setTaxKey] = useState('');
  const [taxType, setTaxType] = useState('PERCENTAGE');
  const [taxRate, setTaxRate] = useState('');
  const [taxGroup, setTaxGroup] = useState('');
  const [taxOutput, setTaxOutput] = useState('');
  const [taxFrom, setTaxFrom] = useState('');
  const [superRate, setSuperRate] = useState('');
  const [superFrom, setSuperFrom] = useState('');
  const [routingChargeCode, setRoutingChargeCode] = useState('');
  const [routingDestKind, setRoutingDestKind] = useState<'COMPANY' | 'MASTER'>('COMPANY');

  const dirty = Boolean(reason || propName || chargeCode || taxName);
  const unsavedGuard = useUnsavedChanges(dirty);

  const onSaved = async () => {
    setMessage('Saved.');
    await queryClient.invalidateQueries({ queryKey: ['domain-config', propertyId] });
  };

  const configQ = useQuery({
    queryKey: ['domain-config', propertyId],
    queryFn: () => api.listDomainConfig(propertyId),
    retry: false,
  });
  const propertyQ = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api.getProperty(propertyId),
    retry: false,
  });
  const chargesQ = useQuery({
    queryKey: ['charge-codes', propertyId],
    queryFn: () => api.listChargeCodes(propertyId, { status: 'all' }),
    enabled: activeTab === 'charges',
    retry: false,
  });
  const routingRulesQ = useQuery({
    queryKey: ['folio-routing-rules', propertyId],
    queryFn: () => api.listFolioRoutingRules(propertyId, { status: 'active' }),
    enabled: activeTab === 'charges',
    retry: false,
  });
  const taxQ = useQuery({
    queryKey: ['tax-rules', propertyId],
    queryFn: () => api.listTaxRules(propertyId),
    enabled: activeTab === 'tax',
    retry: false,
  });

  const keys = (configQ.data?.keys ?? []) as DomainKey[];
  const charges = (chargesQ.data?.codes ?? []) as ChargeRow[];
  const activeChargeCodes = useMemo(
    () => charges.filter((c) => c.status === 'active'),
    [charges],
  );
  const routingRules = (routingRulesQ.data?.rules ?? []) as RoutingRuleRow[];
  const rules = (taxQ.data?.rules ?? []) as TaxRow[];

  useEffect(() => {
    const n = propertyQ.data?.property?.name;
    if (typeof n === 'string') setPropName(n);
  }, [propertyQ.data]);

  useEffect(() => {
    if (activeChargeCodes.length === 0) return;
    setRoutingChargeCode((prev) =>
      prev && activeChargeCodes.some((c) => c.code === prev) ? prev : activeChargeCodes[0]!.code,
    );
  }, [activeChargeCodes]);

  const failClosed = configQ.isError && asClassified(configQ.error).class === 'fail_closed';

  const createCharge = useMutation({
    mutationFn: () => api.createChargeCode(propertyId, { code: chargeCode, name: chargeName }),
    onSuccess: async () => {
      setChargeCode('');
      setChargeName('');
      setMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['charge-codes', propertyId] });
    },
  });

  const archiveCharge = useMutation({
    mutationFn: (code: string) => api.setChargeCodeStatus(propertyId, code, 'archived'),
    onSuccess: async () => {
      setArchiveCode(null);
      setMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['charge-codes', propertyId] });
    },
  });

  const addRoutingRule = useMutation({
    mutationFn: () => {
      const ruleId = `rr_${crypto.randomUUID()}`;
      return api.putFolioRoutingRule(propertyId, ruleId, {
        chargeCode: routingChargeCode,
        destWindowKind: routingDestKind,
      });
    },
    onSuccess: async () => {
      setMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['folio-routing-rules', propertyId] });
    },
  });

  const archiveRoutingRule = useMutation({
    mutationFn: (ruleId: string) => api.archiveFolioRoutingRule(propertyId, ruleId),
    onSuccess: async () => {
      setMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['folio-routing-rules', propertyId] });
    },
  });

  const createTax = useMutation({
    mutationFn: () =>
      api.createTaxRule(propertyId, {
        taxRuleId: crypto.randomUUID(),
        ruleKey: taxKey,
        name: taxName,
        ruleType: taxType,
        rate: taxRate,
        taxGroup,
        outputChargeCode: taxOutput,
        validFrom: taxFrom,
      }),
    onSuccess: async () => {
      setTaxName('');
      setTaxKey('');
      setTaxRate('');
      setMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['tax-rules', propertyId] });
    },
  });

  const common = useMemo(
    () => ({ reason, propertyId, onSaved }),
    [reason, propertyId],
  );

  if (failClosed) {
    return (
      <div className="main" data-testid="settings-screen">
        {unsavedGuard}
        <Alert>Property unreachable — cannot load settings.</Alert>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Settings" />
      <Card data-testid="settings-screen">
      {unsavedGuard}
      <nav className="nav">
        <Link to="/settings/property">Property</Link>
        <Link to="/settings/charges">Charges</Link>
        <Link to="/settings/tax">Tax</Link>
      </nav>
      {message ? (
        <p className="muted" aria-live="polite">
          {message}
        </p>
      ) : null}

      {activeTab === 'property' ? (
        configQ.isPending ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
          <Field
            label="Reason"
            control={
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why this change…"
                autoComplete="off"
              />
            }
          />

          <h2>Property</h2>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              await api.updatePropertyDetails(propertyId, { name: propName });
              setMessage('Saved.');
            }}
          >
            <Field
              label="Property name"
              control={
                <Input value={propName} onChange={(e) => setPropName(e.target.value)} autoComplete="off" />
              }
            />
            <Button type="submit" intent="primary">
              Save Property name
            </Button>
          </form>
          <DomainText
            label="Time zone"
            configKey="pms.time.time_zone"
            initial={lookup(keys, 'pms.time.time_zone')}
            spellCheck={false}
            {...common}
          />

          <h2>Availability</h2>
          <DomainBool
            label="Allow overbooking"
            configKey="pms.availability.allow_overbooking"
            initial={lookup(keys, 'pms.availability.allow_overbooking')}
            {...common}
          />
          <DomainText
            label="Oversell allowance"
            configKey="pms.availability.oversell_allowance"
            initial={lookup(keys, 'pms.availability.oversell_allowance')}
            inputType="number"
            {...common}
          />

          <h2>Night audit</h2>
          <DomainText
            label="Audit time"
            configKey="pms.night_audit.audit_time"
            initial={lookup(keys, 'pms.night_audit.audit_time')}
            inputType="time"
            {...common}
          />
          <DomainBool
            label="Auto no-show"
            configKey="pms.night_audit.auto_no_show"
            initial={lookup(keys, 'pms.night_audit.auto_no_show')}
            {...common}
          />
          <DomainBool
            label="Auto extend"
            configKey="pms.night_audit.auto_extend"
            initial={lookup(keys, 'pms.night_audit.auto_extend')}
            hint="When on, night audit extends in-house stays that are due out tomorrow by one night if the extra night is available."
            {...common}
          />

          <h2>Booking</h2>
          <DomainBool
            label="Same-day bookings"
            configKey="pms.booking.same_day_bookings"
            initial={lookup(keys, 'pms.booking.same_day_bookings')}
            {...common}
          />
          <DomainText
            label="Same-day cutoff"
            configKey="pms.booking.same_day_cutoff"
            initial={lookup(keys, 'pms.booking.same_day_cutoff')}
            inputType="time"
            {...common}
          />
          <DomainBool
            label="Require prepayment"
            configKey="pms.booking.require_prepayment"
            initial={lookup(keys, 'pms.booking.require_prepayment')}
            {...common}
          />
          <DomainBool
            label="Booking date change"
            configKey="pms.booking.booking_date_change"
            initial={lookup(keys, 'pms.booking.booking_date_change')}
            {...common}
          />

          <h2>Money</h2>
          <DomainText
            label="Ledger currency"
            configKey="pms.money.currency_code"
            initial={lookup(keys, 'pms.money.currency_code')}
            readOnly
            hint="Ledger currency is set at provision and cannot change here."
            {...common}
          />
          <DomainBool
            label="Payment alloc"
            configKey="pms.money.payment_alloc"
            initial={lookup(keys, 'pms.money.payment_alloc')}
            {...common}
          />
          <DomainText
            label="Currencies list"
            configKey="pms.money.currencies_list"
            initial={lookup(keys, 'pms.money.currencies_list')}
            json
            hint="Not the FX allowlist — foreign tenders use FX rates on the folio."
            {...common}
          />

          <h2>Folio</h2>
          <DomainText
            label="Breakfast rule"
            configKey="pms.folio.breakfast_rule"
            initial={lookup(keys, 'pms.folio.breakfast_rule')}
            hint="Display only — night audit does not auto-post from this."
            {...common}
          />
          <DomainBool
            label="Close window on check-out"
            configKey="pms.folio.close_window_on_check_out"
            initial={lookup(keys, 'pms.folio.close_window_on_check_out')}
            {...common}
          />
          <DomainBool
            label="Auto capture on check-out"
            configKey="pms.folio.auto_capture_on_check_out"
            initial={lookup(keys, 'pms.folio.auto_capture_on_check_out')}
            {...common}
          />
          <DomainText
            label="Folio configs"
            configKey="pms.folio.configs"
            initial={lookup(keys, 'pms.folio.configs')}
            json
            {...common}
          />

          <h2>Reservations</h2>
          <DomainText
            label="Pending hold hours"
            configKey="pms.reservations.pending_hold_hours"
            initial={lookup(keys, 'pms.reservations.pending_hold_hours')}
            inputType="number"
            {...common}
          />
          <DomainText
            label="Auth hold hours"
            configKey="pms.payments.auth_hold_hours"
            initial={lookup(keys, 'pms.payments.auth_hold_hours')}
            inputType="number"
            hint="Authorized card holds older than this many hours are voided automatically."
            {...common}
          />
          <DomainText
            label="Inquiry TTL days"
            configKey="pms.reservations.inquiry_ttl_days"
            initial={lookup(keys, 'pms.reservations.inquiry_ttl_days')}
            inputType="number"
            {...common}
          />
          <DomainSelect
            label="Check-in cleanliness"
            configKey="pms.reservations.check_in_cleanliness"
            initial={lookup(keys, 'pms.reservations.check_in_cleanliness')}
            options={['strict', 'off']}
            {...common}
          />
          <DomainBool
            label="Check-out require zero balance"
            configKey="pms.reservations.check_out_require_zero_balance"
            initial={lookup(keys, 'pms.reservations.check_out_require_zero_balance')}
            {...common}
          />

          <h2>Housekeeping</h2>
          <DomainBool
            label="Require inspection"
            configKey="pms.housekeeping.require_inspection"
            initial={lookup(keys, 'pms.housekeeping.require_inspection')}
            {...common}
          />

          <h2>Ops (unread)</h2>
          <DomainBool
            label="Auto assign rooms"
            configKey="pms.ops.auto_assign_rooms"
            initial={lookup(keys, 'pms.ops.auto_assign_rooms')}
            hint="When on, check-in without a room picks the lowest room code of the booked type that is vacant and ready."
            {...common}
          />

          <Card>
            <CardContent>
              <h2>FX Rates</h2>
              <p className="muted">
                Foreign-currency quotes are property-scoped and edited on the folio. Open an in-house
                stay’s folio → FX rates.
              </p>
              <Link to="/in-house">Open in-house board</Link>
            </CardContent>
          </Card>
        </>
        )
      ) : null}

      {activeTab === 'charges' ? (
        <>
          {charges.length === 0 && chargesQ.isSuccess ? (
            <p className="muted">No charge codes.</p>
          ) : (
            <DataTable>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Code</DataTableHeaderCell>
                  <DataTableHeaderCell>Name</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Tax group</DataTableHeaderCell>
                  <DataTableHeaderCell />
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {charges.map((c) => (
                  <DataTableRow key={c.code}>
                    <DataTableCell>
                      <span translate="no">{c.code}</span>
                    </DataTableCell>
                    <DataTableCell>{c.name}</DataTableCell>
                    <DataTableCell>{c.status}</DataTableCell>
                    <DataTableCell>{c.taxGroup ?? '—'}</DataTableCell>
                    <DataTableCell>
                      {SYSTEM_CHARGE_CODES.has(c.code) ? (
                        <span className="muted">System code — cannot archive.</span>
                      ) : c.status === 'archived' ? (
                        <Button
                          type="button"
                          onClick={() => api.setChargeCodeStatus(propertyId, c.code, 'active')}
                        >
                          Restore {c.code}
                        </Button>
                      ) : (
                        <Button type="button" intent="destructive" onClick={() => setArchiveCode(c.code)}>
                          Archive {c.code}
                        </Button>
                      )}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          )}
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              createCharge.mutate();
            }}
          >
            <h2>Create Charge Code</h2>
            <Field
              label="Code"
              control={
                <Input
                  value={chargeCode}
                  onChange={(e) => setChargeCode(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Name"
              control={
                <Input value={chargeName} onChange={(e) => setChargeName(e.target.value)} autoComplete="off" />
              }
            />
            <Button type="submit" intent="primary">
              {createCharge.isPending ? 'Saving…' : 'Create Charge Code'}
            </Button>
          </form>
          <section className="stack">
            <h2>Routing rules</h2>
            <p className="muted">
              Auto-transfer runs at night audit. Destination window must already be open on the stay.
            </p>
            {routingRules.length === 0 && routingRulesQ.isSuccess ? (
              <p className="muted">No routing rules.</p>
            ) : (
              <DataTable>
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell>Charge code</DataTableHeaderCell>
                    <DataTableHeaderCell>Destination</DataTableHeaderCell>
                    <DataTableHeaderCell />
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {routingRules.map((r) => (
                    <DataTableRow key={r.ruleId}>
                      <DataTableCell>
                        <span translate="no">{r.chargeCode}</span>
                      </DataTableCell>
                      <DataTableCell>{r.destWindowKind}</DataTableCell>
                      <DataTableCell>
                        <Button
                          type="button"
                          intent="destructive"
                          disabled={archiveRoutingRule.isPending}
                          onClick={() => archiveRoutingRule.mutate(r.ruleId)}
                        >
                          Archive {r.ruleId}
                        </Button>
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            )}
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                addRoutingRule.mutate();
              }}
            >
              <Field
                label="Charge code"
                control={
                  <NativeSelect
                    aria-label="Routing rule charge code"
                    value={routingChargeCode}
                    onChange={(e) => setRoutingChargeCode(e.target.value)}
                    disabled={activeChargeCodes.length === 0}
                  >
                    {activeChargeCodes.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </NativeSelect>
                }
              />
              <Field
                label="Destination"
                control={
                  <NativeSelect
                    aria-label="Routing rule destination"
                    value={routingDestKind}
                    onChange={(e) =>
                      setRoutingDestKind(e.target.value as 'COMPANY' | 'MASTER')
                    }
                  >
                    <option value="COMPANY">COMPANY</option>
                    <option value="MASTER">MASTER</option>
                  </NativeSelect>
                }
              />
              <Button
                type="submit"
                intent="primary"
                disabled={addRoutingRule.isPending || activeChargeCodes.length === 0}
              >
                {addRoutingRule.isPending ? 'Saving…' : 'Add routing rule'}
              </Button>
            </form>
          </section>
        </>
      ) : null}

      {activeTab === 'tax' ? (
        <>
          <p className="muted">
            Superseding closes this rule and opens a new one. Posted tax lines stay.
          </p>
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Name</DataTableHeaderCell>
                <DataTableHeaderCell>Key</DataTableHeaderCell>
                <DataTableHeaderCell>Type</DataTableHeaderCell>
                <DataTableHeaderCell>Rate</DataTableHeaderCell>
                <DataTableHeaderCell>Group</DataTableHeaderCell>
                <DataTableHeaderCell>Output</DataTableHeaderCell>
                <DataTableHeaderCell>Valid</DataTableHeaderCell>
                <DataTableHeaderCell />
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {rules.map((r) => (
                <DataTableRow key={r.taxRuleId}>
                  <DataTableCell>{r.name}</DataTableCell>
                  <DataTableCell>
                    <span translate="no">{r.ruleKey}</span>
                  </DataTableCell>
                  <DataTableCell>{r.ruleType}</DataTableCell>
                  <DataTableCell>{r.rate}</DataTableCell>
                  <DataTableCell>{r.taxGroup}</DataTableCell>
                  <DataTableCell>
                    <span translate="no">{r.outputChargeCode}</span>
                  </DataTableCell>
                  <DataTableCell>
                    {r.validFrom}
                    {r.validTo ? `–${r.validTo}` : '–open'}
                  </DataTableCell>
                  <DataTableCell>
                    {r.validTo ? null : (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          await api.supersedeTaxRule(propertyId, r.taxRuleId, {
                            rate: superRate,
                            validFrom: superFrom,
                            name: r.name,
                            ruleType: r.ruleType,
                            taxGroup: r.taxGroup,
                            outputChargeCode: r.outputChargeCode,
                            ruleKey: r.ruleKey,
                          });
                          setMessage('Saved.');
                          await queryClient.invalidateQueries({ queryKey: ['tax-rules', propertyId] });
                        }}
                      >
                        <Field
                          label="New rate"
                          control={
                            <Input
                              value={superRate}
                              onChange={(e) => setSuperRate(e.target.value)}
                              autoComplete="off"
                            />
                          }
                        />
                        <Field
                          label="New valid from"
                          control={
                            <Input
                              type="date"
                              value={superFrom}
                              onChange={(e) => setSuperFrom(e.target.value)}
                              autoComplete="off"
                            />
                          }
                        />
                        <Button type="submit" intent="primary">
                          Supersede
                        </Button>
                      </form>
                    )}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              createTax.mutate();
            }}
          >
            <h2>Create Tax Rule</h2>
            <Field
              label="Name"
              control={
                <Input value={taxName} onChange={(e) => setTaxName(e.target.value)} autoComplete="off" />
              }
            />
            <Field
              label="Rule key"
              control={
                <Input
                  value={taxKey}
                  onChange={(e) => setTaxKey(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Rule type"
              control={
                <NativeSelect value={taxType} onChange={(e) => setTaxType(e.target.value)}>
                  <option value="PERCENTAGE">PERCENTAGE</option>
                  <option value="PER_PERSON_PER_NIGHT">PER_PERSON_PER_NIGHT</option>
                  <option value="FLAT">FLAT</option>
                </NativeSelect>
              }
            />
            <Field
              label="Rate"
              control={
                <Input
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Tax group"
              control={
                <Input value={taxGroup} onChange={(e) => setTaxGroup(e.target.value)} autoComplete="off" />
              }
            />
            <Field
              label="Output charge code"
              control={
                <Input
                  value={taxOutput}
                  onChange={(e) => setTaxOutput(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Valid from"
              control={
                <Input
                  type="date"
                  value={taxFrom}
                  onChange={(e) => setTaxFrom(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Button type="submit" intent="primary">
              {createTax.isPending ? 'Saving…' : 'Create Tax Rule'}
            </Button>
          </form>
        </>
      ) : null}

      {archiveCode ? (
        <Card role="dialog" aria-modal="true">
          <p>Archive {archiveCode}?</p>
          <Button type="button" onClick={() => setArchiveCode(null)}>
            Cancel
          </Button>
          <Button type="button" intent="destructive" onClick={() => archiveCharge.mutate(archiveCode)}>
            Archive
          </Button>
        </Card>
      ) : null}
    </Card>
    </>
  );
}
