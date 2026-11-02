import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyState,
  Field,
  FieldGroup,
  Input,
  NativeSelect,
  PageHeader,
  Dialog,
  SectionLabel,
  Skeleton,
  Tabs,
  Textarea,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { CURRENCIES } from '../config/currencies.js';
import { IANA_TIME_ZONES } from '../config/iana-time-zones.js';
import { ConfirmDialog } from '../shell/ConfirmDialog.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { badgeStatusWord } from '../status/badge-status-word.js';
import { useUnsavedChanges } from './use-unsaved-changes.js';
import { ProductsSettings } from './settings-products.js';
import { MaintenanceSettings } from './settings-maintenance.js';
import { NightAuditChecksSettings } from './settings-night-audit-checks.js';
import { SourcesSettings } from './settings-sources.js';

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

type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const AUTO_SAVE_DELAY_MS = 800;
const SAVED_ACK_MS = 2000;

function useAutoSave(props: { dirty: boolean; reason: string; save: () => void }) {
  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const saveRef = useRef(props.save);
  saveRef.current = props.save;
  useEffect(() => {
    if (!props.dirty || !props.reason.trim()) return;
    setStatus('saving');
    const t = setTimeout(() => saveRef.current(), AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [props.dirty, props.reason]);
  useEffect(() => {
    if (status !== 'saved') return;
    const t = setTimeout(() => setStatus('idle'), SAVED_ACK_MS);
    return () => clearTimeout(t);
  }, [status]);
  return [status, setStatus] as const;
}

function AutoSaveStatusIndicator(props: { status: AutoSaveStatus; dirty: boolean; reason: string }) {
  let text: string | null = null;
  if (props.status === 'saving') text = 'Saving…';
  else if (props.status === 'saved') text = 'Saved.';
  else if (props.status === 'error') text = 'Save failed. Try again.';
  else if (props.dirty && !props.reason.trim()) text = 'Enter a reason to save changes.';
  return text ? (
    <p className="muted settings-property__status" aria-live="polite">
      {text}
    </p>
  ) : (
    <p className="settings-property__status" aria-hidden="true" />
  );
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
  const dirty = on !== Boolean(props.initial);
  const save = useMutation({
    mutationFn: () =>
      api.putDomainConfig(props.propertyId, {
        key: props.configKey,
        value: on,
        reason: props.reason,
      }),
    onSuccess: () => {
      props.onSaved();
      setStatus('saved');
    },
    onError: () => setStatus('error'),
  });
  const [status, setStatus] = useAutoSave({ dirty, reason: props.reason, save: () => save.mutate() });
  return (
    <div className="ui-stack">
      <Field
        label={props.label}
        hint={props.hint}
        control={<Checkbox checked={on} onChange={(e) => setOn(e.target.checked)} />}
      />
      <AutoSaveStatusIndicator status={status} dirty={dirty} reason={props.reason} />
    </div>
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
  const dirty = raw !== asString;
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
    onSuccess: () => {
      props.onSaved();
      setStatus('saved');
    },
    onError: () => setStatus('error'),
  });
  const [status, setStatus] = useAutoSave({
    dirty: !props.readOnly && dirty,
    reason: props.reason,
    save: () => save.mutate(),
  });
  return (
    <div className="ui-stack">
      <Field label={props.label} hint={props.hint} control={control} />
      {props.readOnly ? null : (
        <AutoSaveStatusIndicator status={status} dirty={dirty} reason={props.reason} />
      )}
    </div>
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
  const baseline = String(props.initial ?? props.options[0]);
  const dirty = raw !== baseline;
  const save = useMutation({
    mutationFn: () =>
      api.putDomainConfig(props.propertyId, {
        key: props.configKey,
        value: raw,
        reason: props.reason,
      }),
    onSuccess: () => {
      props.onSaved();
      setStatus('saved');
    },
    onError: () => setStatus('error'),
  });
  const [status, setStatus] = useAutoSave({ dirty, reason: props.reason, save: () => save.mutate() });
  return (
    <div className="ui-stack">
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
      <AutoSaveStatusIndicator status={status} dirty={dirty} reason={props.reason} />
    </div>
  );
}

function DomainCurrencies(props: {
  label: string;
  configKey: string;
  initial: unknown;
  reason: string;
  hint?: string;
  propertyId: string;
  onSaved: () => void;
}) {
  const initialList = useMemo(
    () =>
      Array.isArray(props.initial)
        ? props.initial.filter((v): v is string => typeof v === 'string')
        : [],
    [props.initial],
  );
  const initialKey = useMemo(() => [...new Set(initialList)].sort().join(','), [initialList]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialList));
  useEffect(() => {
    setSelected(new Set(initialList));
  }, [initialKey]);
  const initialSet = useMemo(() => new Set(initialList), [initialKey]);
  const dirty =
    selected.size !== initialSet.size || [...selected].some((c) => !initialSet.has(c));
  const save = useMutation({
    mutationFn: () =>
      api.putDomainConfig(props.propertyId, {
        key: props.configKey,
        value: CURRENCIES.filter((c) => selected.has(c.code)).map((c) => c.code),
        reason: props.reason,
      }),
    onSuccess: () => {
      props.onSaved();
      setStatus('saved');
    },
    onError: () => setStatus('error'),
  });
  const [status, setStatus] = useAutoSave({
    dirty,
    reason: props.reason,
    save: () => save.mutate(),
  });
  const [open, setOpen] = useState(false);
  const selectedCodes = CURRENCIES.filter((c) => selected.has(c.code)).map((c) => c.code);
  return (
    <div className="ui-stack">
      <Field
        label={props.label}
        hint={props.hint}
        control={
          <Button
            type="button"
            intent="default"
            aria-label="Select currencies…"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            {selectedCodes.length === 0
              ? 'Select currencies…'
              : `Currencies: ${selectedCodes.join(', ')}`}
          </Button>
        }
      />
      <AutoSaveStatusIndicator status={status} dirty={dirty} reason={props.reason} />
      {open ? (
        <Dialog
          open
          wide
          title={props.label}
          onClose={() => setOpen(false)}
          footer={
            <Button type="button" intent="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          }
        >
          <p className="muted">{selectedCodes.length} selected</p>
          <div className="settings-currencies__grid">
            {CURRENCIES.map((c) => (
              <label key={c.code} className="settings-currencies__item">
                <Checkbox
                  checked={selected.has(c.code)}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(c.code);
                      else next.delete(c.code);
                      return next;
                    })
                  }
                />
                <span translate="no">{c.code}</span>
                <span className="muted">{c.name}</span>
              </label>
            ))}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function PropertyNameField(props: {
  name: string;
  onChange: (name: string) => void;
  initial: string;
  reason: string;
  propertyId: string;
  onSaved: () => void;
}) {
  const dirty = props.name !== props.initial;
  const save = useMutation({
    mutationFn: () => api.updatePropertyDetails(props.propertyId, { name: props.name }),
    onSuccess: () => {
      props.onSaved();
      setStatus('saved');
    },
    onError: () => setStatus('error'),
  });
  const [status, setStatus] = useAutoSave({
    dirty,
    reason: props.reason,
    save: () => save.mutate(),
  });
  return (
    <div className="ui-stack">
      <Field
        label="Property name"
        control={
          <Input value={props.name} onChange={(e) => props.onChange(e.target.value)} autoComplete="off" />
        }
      />
      <AutoSaveStatusIndicator status={status} dirty={dirty} reason={props.reason} />
    </div>
  );
}

export function SettingsScreen({
  tab,
}: {
  tab?: 'property' | 'charges' | 'products' | 'maintenance' | 'sources' | 'tax';
}) {
  const propertyId = tenant.propertyId;
  const { date } = useFormat();
  const queryClient = useQueryClient();
  const activeTab = tab ?? 'property';
  const [reason, setReason] = useState('');
  const [propName, setPropName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [archiveCode, setArchiveCode] = useState<string | null>(null);
  const [routingArchiveId, setRoutingArchiveId] = useState<string | null>(null);

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

  const timeZoneOptions = useMemo(() => {
    const current = lookup(keys, 'pms.time.time_zone');
    return typeof current === 'string' && !IANA_TIME_ZONES.includes(current)
      ? [current, ...IANA_TIME_ZONES]
      : IANA_TIME_ZONES;
  }, [keys]);

  if (failClosed) {
    return (
      <div className="main" data-testid="settings-screen">
        {unsavedGuard}
        <Alert>Property unreachable — cannot load settings.</Alert>
      </div>
    );
  }

  return (
    <div className="ui-page-stack settings-screen">
      <PageHeader
        title="Settings"
        subtitle={
          propertyQ.data?.property?.name ? (
            <>
              {propertyQ.data.property.name}
              <span className="sep">·</span>
              changes are audited
            </>
          ) : (
            'Changes are audited'
          )
        }
      />
      <div className="ui-page-stack" data-testid="settings-screen">
      {unsavedGuard}
      <Tabs label="Settings">
        <Link className="ui-tab" to="/settings/property" aria-current={activeTab === 'property' ? 'page' : undefined}>Property</Link>
        <Link className="ui-tab" to="/settings/charges" aria-current={activeTab === 'charges' ? 'page' : undefined}>Charges</Link>
        <Link className="ui-tab" to="/settings/products" aria-current={activeTab === 'products' ? 'page' : undefined}>Products</Link>
        <Link className="ui-tab" to="/settings/maintenance" aria-current={activeTab === 'maintenance' ? 'page' : undefined}>Maintenance</Link>
        <Link className="ui-tab" to="/settings/sources" aria-current={activeTab === 'sources' ? 'page' : undefined}>Sources & segments</Link>
        <Link className="ui-tab" to="/settings/tax" aria-current={activeTab === 'tax' ? 'page' : undefined}>Tax</Link>
      </Tabs>
      {message ? (
        <p className="muted" aria-live="polite">
          {message}
        </p>
      ) : null}

      {activeTab === 'property' ? (
        configQ.isPending ? (
          <Skeleton label="Loading settings" lines={5} />
        ) : (
          <>
          <Alert intent="attention">
            <span className="ui-alert__title">A reason is required before saving</span>
            <span>Every configuration change is written to the audit log with this note.</span>
          </Alert>
          <Card>
            <CardContent>
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Property</CardTitle>
            </CardHeader>
            <CardContent>
<div className="settings-property__grid">
                <PropertyNameField
                  name={propName}
                  onChange={setPropName}
                  initial={propertyQ.data?.property?.name ?? ''}
                  reason={reason}
                  propertyId={propertyId}
                  onSaved={async () => {
                    setMessage('Saved.');
                    await queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
                  }}
                />
                <DomainSelect
                  label="Time zone"
                  configKey="pms.time.time_zone"
                  initial={lookup(keys, 'pms.time.time_zone')}
                  options={timeZoneOptions}
                  {...common}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Availability</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="settings-property__grid">
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
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Night audit</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="settings-property__grid">
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
              </div>
              <NightAuditChecksSettings
                keys={keys}
                reason={reason}
                propertyId={propertyId}
                onSaved={onSaved}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Money</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="settings-property__grid">
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
<DomainCurrencies
                  label="Currencies list"
                  configKey="pms.money.currencies_list"
                  initial={lookup(keys, 'pms.money.currencies_list')}
                  hint="Not the FX allowlist — foreign tenders use FX rates on the folio."
                  {...common}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Folio</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="settings-property__grid">
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
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Reservations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="settings-property__grid">
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
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Housekeeping</CardTitle>
            </CardHeader>
            <CardContent>
              <DomainBool
                label="Require inspection"
                configKey="pms.housekeeping.require_inspection"
                initial={lookup(keys, 'pms.housekeeping.require_inspection')}
                {...common}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ops (unread)</CardTitle>
            </CardHeader>
            <CardContent>
              <DomainBool
                label="Auto assign rooms"
                configKey="pms.ops.auto_assign_rooms"
                initial={lookup(keys, 'pms.ops.auto_assign_rooms')}
                hint="When on, check-in without a room picks the lowest room code of the booked type that is vacant and ready."
                {...common}
              />
              <SectionLabel>FX Rates</SectionLabel>
              <p className="muted">
                Foreign-currency quotes are property-scoped and edited on the folio. Open an in-house
                stay’s folio → FX rates.
              </p>
              <Link className="ui-link-btn" to="/in-house">
                Open in-house board
              </Link>
            </CardContent>
          </Card>
        </>
        )
      ) : null}

      {activeTab === 'charges' ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Charge codes</CardTitle>
            </CardHeader>
            {charges.length === 0 && chargesQ.isSuccess ? (
              <CardContent>
                <EmptyState title="No charge codes." />
              </CardContent>
            ) : (
              <CardContent flush>
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
                    <DataTableCell>
                      <Badge rung={c.status === 'active' ? 'settled' : 'informational'}>
                        {badgeStatusWord(c.status)}
                      </Badge>
                    </DataTableCell>
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
                        <Button type="button" onClick={() => setArchiveCode(c.code)}>
                          Archive {c.code}
                        </Button>
                      )}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
                  </DataTable>
              </CardContent>
            )}
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Create Charge Code</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="ui-stack"
            onSubmit={(e) => {
              e.preventDefault();
              createCharge.mutate();
            }}
          >
            <FieldGroup inline>
            <Field
              label="Code"
              control={
                <Input
                  placeholder="ROOM"
                  value={chargeCode}
                  onChange={(e) => setChargeCode(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Name"
              control={
                <Input
                  placeholder="Room charge"
                  value={chargeName}
                  onChange={(e) => setChargeName(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Button type="submit" intent="primary">
              {createCharge.isPending ? 'Saving…' : 'Create Charge Code'}
            </Button>
            </FieldGroup>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Routing rules</CardTitle>
            </CardHeader>
            <CardContent>
            <p className="muted">
              Auto-transfer runs at night audit. Destination window must already be open on the stay.
            </p>
            {routingRules.length === 0 && routingRulesQ.isSuccess ? (
              <EmptyState title="No routing rules." />
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
                          disabled={archiveRoutingRule.isPending}
                          onClick={() => setRoutingArchiveId(r.ruleId)}
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
              className="ui-stack"
              onSubmit={(e) => {
                e.preventDefault();
                addRoutingRule.mutate();
              }}
            >
              <FieldGroup inline>
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
                disabled={addRoutingRule.isPending || activeChargeCodes.length === 0}
              >
                {addRoutingRule.isPending ? 'Saving…' : 'Add routing rule'}
              </Button>
              </FieldGroup>
            </form>
            </CardContent>
          </Card>
        </>
      ) : null}

      {activeTab === 'products' ? <ProductsSettings onMessage={setMessage} /> : null}
      {activeTab === 'maintenance' ? <MaintenanceSettings onMessage={setMessage} /> : null}
      {activeTab === 'sources' ? <SourcesSettings onMessage={setMessage} /> : null}
      {activeTab === 'tax' ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Create Tax Rule</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="ui-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  createTax.mutate();
                }}
              >
                <FieldGroup inline>
                <Field
                  label="Name"
                  control={
                    <Input
                      placeholder="City tax"
                      value={taxName}
                      onChange={(e) => setTaxName(e.target.value)}
                      autoComplete="off"
                    />
                  }
                />
                <Field
                  label="Rule key"
                  control={
                    <Input
                      placeholder="city_tax"
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
                      placeholder="0.1000"
                      value={taxRate}
                      onChange={(e) => setTaxRate(e.target.value)}
                      autoComplete="off"
                    />
                  }
                />
                <Field
                  label="Tax group"
                  control={
                    <Input
                      placeholder="ROOM"
                      value={taxGroup}
                      onChange={(e) => setTaxGroup(e.target.value)}
                      autoComplete="off"
                    />
                  }
                />
                <Field
                  label="Output charge code"
                  control={
                    <Input
                      placeholder="TAX"
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
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tax rules</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="muted">
                Superseding closes this rule and opens a new one. Posted tax lines stay.
              </p>
            </CardContent>
            <CardContent flush>
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
                    {date(r.validFrom)}
                    {r.validTo ? ` – ${date(r.validTo)}` : ' – open'}
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
                              placeholder="0.1000"
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
                        <Button type="submit">
                          Supersede
                        </Button>
                      </form>
                    )}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
                </DataTable>
            </CardContent>
          </Card>
        </>
      ) : null}

      {archiveCode ? (
        <ConfirmDialog
          title={`Archive ${archiveCode}?`}
          description={`Archive ${archiveCode}?`}
          confirmLabel="Archive"
          intent="destructive"
          onCancel={() => setArchiveCode(null)}
          onConfirm={() => archiveCharge.mutate(archiveCode)}
        />
      ) : null}
      {routingArchiveId ? (
        <ConfirmDialog
          title="Archive routing rule?"
          description={`Archive routing rule ${routingArchiveId}?`}
          confirmLabel="Archive"
          intent="destructive"
          onCancel={() => setRoutingArchiveId(null)}
          onConfirm={() => {
            archiveRoutingRule.mutate(routingArchiveId);
            setRoutingArchiveId(null);
          }}
        />
      ) : null}
      </div>
    </div>
  );
}
