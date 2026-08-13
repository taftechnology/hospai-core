import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
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
      <label>
        {props.label}{' '}
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
      </label>
      {props.hint ? <p className="muted">{props.hint}</p> : null}
      <button type="submit" disabled={save.isPending || !props.reason.trim()}>
        {save.isPending ? 'Saving…' : `Save ${props.label}`}
      </button>
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
  const input = props.json ? (
    <textarea
      value={raw}
      readOnly={props.readOnly}
      autoComplete="off"
      spellCheck={props.spellCheck ?? true}
      onChange={(e) => setRaw(e.target.value)}
    />
  ) : (
    <input
      type={props.inputType ?? 'text'}
      value={raw}
      readOnly={props.readOnly}
      disabled={props.readOnly}
      autoComplete="off"
      spellCheck={props.spellCheck ?? true}
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
      <label>
        {props.label} {input}
      </label>
      {props.hint ? <p className="muted">{props.hint}</p> : null}
      {props.readOnly ? null : (
        <button type="submit" disabled={save.isPending || !props.reason.trim()}>
          {save.isPending ? 'Saving…' : `Save ${props.label}`}
        </button>
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
      <label>
        {props.label}{' '}
        <select value={raw} onChange={(e) => setRaw(e.target.value)}>
          {props.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={save.isPending || !props.reason.trim()}>
        {save.isPending ? 'Saving…' : `Save ${props.label}`}
      </button>
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
  const taxQ = useQuery({
    queryKey: ['tax-rules', propertyId],
    queryFn: () => api.listTaxRules(propertyId),
    enabled: activeTab === 'tax',
    retry: false,
  });

  const keys = (configQ.data?.keys ?? []) as DomainKey[];
  const charges = (chargesQ.data?.codes ?? []) as ChargeRow[];
  const rules = (taxQ.data?.rules ?? []) as TaxRow[];

  useEffect(() => {
    const n = propertyQ.data?.property?.name;
    if (typeof n === 'string') setPropName(n);
  }, [propertyQ.data]);

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
        <div className="error" role="alert">
          Property unreachable — cannot load settings.
        </div>
      </div>
    );
  }

  return (
    <div className="main" data-testid="settings-screen">
      {unsavedGuard}
      <h1>Settings</h1>
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
          <label>
            Reason{' '}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this change…"
              autoComplete="off"
            />
          </label>

          <h2>Property</h2>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              await api.updatePropertyDetails(propertyId, { name: propName });
              setMessage('Saved.');
            }}
          >
            <label>
              Property name{' '}
              <input value={propName} onChange={(e) => setPropName(e.target.value)} autoComplete="off" />
            </label>
            <button type="submit">Save Property name</button>
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
            hint="Stored for later. Check-in still requires an explicit room."
            {...common}
          />

          <section className="panel">
            <h2>FX Rates</h2>
            <p className="muted">
              Foreign-currency quotes are property-scoped and edited on the folio. Open an in-house
              stay’s folio → FX rates.
            </p>
            <Link to="/in-house">Open in-house board</Link>
          </section>
        </>
        )
      ) : null}

      {activeTab === 'charges' ? (
        <>
          {charges.length === 0 && chargesQ.isSuccess ? (
            <p className="muted">No charge codes.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Tax group</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {charges.map((c) => (
                  <tr key={c.code}>
                    <td translate="no">{c.code}</td>
                    <td>{c.name}</td>
                    <td>{c.status}</td>
                    <td>{c.taxGroup ?? '—'}</td>
                    <td>
                      {SYSTEM_CHARGE_CODES.has(c.code) ? (
                        <span className="muted">System code — cannot archive.</span>
                      ) : c.status === 'archived' ? (
                        <button
                          type="button"
                          onClick={() => api.setChargeCodeStatus(propertyId, c.code, 'active')}
                        >
                          Restore {c.code}
                        </button>
                      ) : (
                        <button type="button" onClick={() => setArchiveCode(c.code)}>
                          Archive {c.code}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              createCharge.mutate();
            }}
          >
            <h2>Create Charge Code</h2>
            <label>
              Code{' '}
              <input
                value={chargeCode}
                onChange={(e) => setChargeCode(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                translate="no"
              />
            </label>
            <label>
              Name{' '}
              <input value={chargeName} onChange={(e) => setChargeName(e.target.value)} autoComplete="off" />
            </label>
            <button type="submit">{createCharge.isPending ? 'Saving…' : 'Create Charge Code'}</button>
          </form>
        </>
      ) : null}

      {activeTab === 'tax' ? (
        <>
          <p className="muted">
            Superseding closes this rule and opens a new one. Posted tax lines stay.
          </p>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Type</th>
                <th>Rate</th>
                <th>Group</th>
                <th>Output</th>
                <th>Valid</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.taxRuleId}>
                  <td>{r.name}</td>
                  <td translate="no">{r.ruleKey}</td>
                  <td>{r.ruleType}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.rate}</td>
                  <td>{r.taxGroup}</td>
                  <td translate="no">{r.outputChargeCode}</td>
                  <td>
                    {r.validFrom}
                    {r.validTo ? `–${r.validTo}` : '–open'}
                  </td>
                  <td>
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
                        <label>
                          New rate{' '}
                          <input
                            value={superRate}
                            onChange={(e) => setSuperRate(e.target.value)}
                            autoComplete="off"
                            style={{ fontVariantNumeric: 'tabular-nums' }}
                          />
                        </label>
                        <label>
                          New valid from{' '}
                          <input
                            type="date"
                            value={superFrom}
                            onChange={(e) => setSuperFrom(e.target.value)}
                            autoComplete="off"
                          />
                        </label>
                        <button type="submit">Supersede</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              createTax.mutate();
            }}
          >
            <h2>Create Tax Rule</h2>
            <label>
              Name <input value={taxName} onChange={(e) => setTaxName(e.target.value)} autoComplete="off" />
            </label>
            <label>
              Rule key{' '}
              <input
                value={taxKey}
                onChange={(e) => setTaxKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              Rule type{' '}
              <select value={taxType} onChange={(e) => setTaxType(e.target.value)}>
                <option value="PERCENTAGE">PERCENTAGE</option>
                <option value="PER_PERSON_PER_NIGHT">PER_PERSON_PER_NIGHT</option>
                <option value="FLAT">FLAT</option>
              </select>
            </label>
            <label>
              Rate{' '}
              <input
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                autoComplete="off"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              />
            </label>
            <label>
              Tax group{' '}
              <input value={taxGroup} onChange={(e) => setTaxGroup(e.target.value)} autoComplete="off" />
            </label>
            <label>
              Output charge code{' '}
              <input
                value={taxOutput}
                onChange={(e) => setTaxOutput(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              Valid from{' '}
              <input
                type="date"
                value={taxFrom}
                onChange={(e) => setTaxFrom(e.target.value)}
                autoComplete="off"
              />
            </label>
            <button type="submit">{createTax.isPending ? 'Saving…' : 'Create Tax Rule'}</button>
          </form>
        </>
      ) : null}

      {archiveCode ? (
        <div role="dialog" aria-modal="true" className="panel">
          <p>Archive {archiveCode}?</p>
          <button type="button" onClick={() => setArchiveCode(null)}>
            Cancel
          </button>
          <button type="button" onClick={() => archiveCharge.mutate(archiveCode)}>
            Archive
          </button>
        </div>
      ) : null}
    </div>
  );
}
