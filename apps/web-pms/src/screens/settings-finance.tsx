import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  formatInvoiceNumber,
  getConfigEntry,
  invoiceNumberProblem,
  type InvoiceSeries,
} from '@hospai/contracts';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, NativeSelect } from '@hospai/ui-kit';
import { Link } from 'react-router';
import { api, asClassified } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import {
  SettingsDomainBool,
  SettingsDomainManualSelectSave,
  SettingsDomainManualStringSave,
  type DomainKey,
} from './settings-domain-fields.js';

function lookup(keys: DomainKey[], key: string): unknown {
  return keys.find((k) => k.key === key)?.value;
}

function configValue(keys: DomainKey[], key: string): unknown {
  const stored = lookup(keys, key);
  if (stored !== undefined) return stored;
  return getConfigEntry(key)?.default;
}

function asSeries(value: unknown): InvoiceSeries {
  return value === 'gst_financial_year' ? 'gst_financial_year' : 'continuous';
}

function useDomainKeySave(props: {
  propertyId: string;
  reason: string;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (payload: { key: string; value: unknown }) =>
      api.putDomainConfig(props.propertyId, {
        key: payload.key,
        value: payload.value,
        reason: props.reason,
      }),
    onSuccess: () => {
      setError(null);
      props.onSaved();
    },
    onError: (err) => {
      setError(classifiedUserMessage(asClassified(err), {}));
    },
  });
  return { save, error, setError };
}

export function SettingsFinanceTab(props: {
  keys: DomainKey[];
  reason: string;
  propertyId: string;
  onSaved: () => void;
  reasonControl: ReactNode;
  timeZone: string | undefined;
}) {
  const common = { reason: props.reason, propertyId: props.propertyId, onSaved: props.onSaved };
  const { save: domainSave, error: saveError } = useDomainKeySave(common);

  const storedSeries = asSeries(configValue(props.keys, 'pms.invoice.series'));
  const storedPrefix = String(configValue(props.keys, 'pms.invoice.prefix') ?? '');
  const storedSuffix = String(configValue(props.keys, 'pms.invoice.suffix') ?? '');
  const storedStarting = configValue(props.keys, 'pms.invoice.starting_idx');

  const [seriesDraft, setSeriesDraft] = useState(storedSeries);
  const [prefixDraft, setPrefixDraft] = useState(storedPrefix);
  const [suffixDraft, setSuffixDraft] = useState(storedSuffix);
  const [startingDraft, setStartingDraft] = useState(String(storedStarting ?? ''));

  // One effect per key, so saving one field does not wipe unsaved edits in the others.
  useEffect(() => setSeriesDraft(storedSeries), [storedSeries]);
  useEffect(() => setPrefixDraft(storedPrefix), [storedPrefix]);
  useEffect(() => setSuffixDraft(storedSuffix), [storedSuffix]);
  useEffect(() => setStartingDraft(String(storedStarting ?? '')), [storedStarting]);

  const invoiceDate = props.timeZone ? propertyLocalToday(props.timeZone) : null;
  const counter = Math.max(Number(startingDraft) || 1, 1);

  const numberingProblem = useMemo(() => {
    if (!invoiceDate) return null;
    return invoiceNumberProblem({
      series: seriesDraft,
      prefix: prefixDraft,
      suffix: suffixDraft,
      counter,
      invoiceDate,
    });
  }, [seriesDraft, prefixDraft, suffixDraft, counter, invoiceDate]);

  const numberingSaveBlocked = Boolean(numberingProblem) || !props.reason.trim();

  const exampleLine =
    invoiceDate != null
      ? `Example: ${formatInvoiceNumber({
          series: seriesDraft,
          prefix: prefixDraft,
          suffix: suffixDraft,
          counter,
          invoiceDate,
        })}`
      : null;

  const seriesDirty = seriesDraft !== storedSeries;
  const prefixDirty = prefixDraft !== storedPrefix;
  const suffixDirty = suffixDraft !== storedSuffix;
  const startingDirty = startingDraft !== String(storedStarting ?? '');

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
          <CardTitle>Invoice numbering</CardTitle>
        </CardHeader>
        <CardContent>
          <>
            {saveError ? <Alert intent="exception">{saveError}</Alert> : null}
            {numberingProblem ? <Alert intent="exception">{numberingProblem}</Alert> : null}
            <div className="settings-property__grid">
              <div className="ui-stack">
                <Field
                  label="Series"
                  control={
                    <NativeSelect
                      value={seriesDraft}
                      onChange={(e) => setSeriesDraft(asSeries(e.target.value))}
                    >
                      <option value="continuous">One continuous series</option>
                      <option value="gst_financial_year">
                        Each financial year, April–March (GST)
                      </option>
                    </NativeSelect>
                  }
                />
                <Button
                  type="button"
                  disabled={numberingSaveBlocked || !seriesDirty || domainSave.isPending}
                  onClick={() =>
                    domainSave.mutate({ key: 'pms.invoice.series', value: seriesDraft })
                  }
                >
                  Save series
                </Button>
              </div>
              <div className="ui-stack">
                <Field
                  label="Prefix"
                  control={
                    <Input
                      value={prefixDraft}
                      onChange={(e) => setPrefixDraft(e.target.value)}
                      autoComplete="off"
                    />
                  }
                />
                <Button
                  type="button"
                  disabled={numberingSaveBlocked || !prefixDirty || domainSave.isPending}
                  onClick={() =>
                    domainSave.mutate({ key: 'pms.invoice.prefix', value: prefixDraft })
                  }
                >
                  Save prefix
                </Button>
              </div>
              <div className="ui-stack">
                <Field
                  label="Suffix"
                  control={
                    <Input
                      value={suffixDraft}
                      onChange={(e) => setSuffixDraft(e.target.value)}
                      autoComplete="off"
                    />
                  }
                />
                <Button
                  type="button"
                  disabled={numberingSaveBlocked || !suffixDirty || domainSave.isPending}
                  onClick={() =>
                    domainSave.mutate({ key: 'pms.invoice.suffix', value: suffixDraft })
                  }
                >
                  Save suffix
                </Button>
              </div>
              <div className="ui-stack">
                <Field
                  label="Starting number"
                  hint={
                    seriesDraft === 'gst_financial_year'
                      ? "Used for the first invoice only, for example to carry on from your old system's number. Later financial years start at 1."
                      : "Used for the first invoice only, for example to carry on from your old system's number."
                  }
                  control={
                    <Input
                      value={startingDraft}
                      onChange={(e) => setStartingDraft(e.target.value)}
                      autoComplete="off"
                    />
                  }
                />
                <Button
                  type="button"
                  disabled={numberingSaveBlocked || !startingDirty || domainSave.isPending}
                  onClick={() => {
                    const n = Number(startingDraft);
                    domainSave.mutate({
                      key: 'pms.invoice.starting_idx',
                      value: Number.isFinite(n) ? Math.trunc(n) : 1,
                    });
                  }}
                >
                  Save starting number
                </Button>
              </div>
            </div>
            {exampleLine ? <p className="muted">{exampleLine}</p> : null}
            <p className="muted">
              Each property numbers its own invoices. If two properties share a GSTIN, give them
              different prefixes.
            </p>
          </>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="settings-property__grid">
            <SettingsDomainManualSelectSave
              label="Invoice at check-out"
              hint="When required, check-out is refused until the folio has an invoice. Generate it from the folio."
              configKey="pms.invoice.gen_mode"
              initial={configValue(props.keys, 'pms.invoice.gen_mode')}
              saveLabel="Save invoice at check-out"
              options={[
                // pms-core does not generate at check-out: 'Automatically' refuses check-out until the folio has an invoice.
                { value: 'Automatically', label: 'Required before check-out' },
                { value: 'Manually', label: 'Optional' },
              ]}
              {...common}
            />
            <SettingsDomainBool
              label="Allow an invoice while a balance is due"
              configKey="pms.invoice.allow_pending"
              initial={configValue(props.keys, 'pms.invoice.allow_pending')}
              {...common}
            />
            <SettingsDomainManualSelectSave
              label="Invoice date"
              configKey="pms.invoice.date_rule"
              initial={configValue(props.keys, 'pms.invoice.date_rule')}
              saveLabel="Save invoice date"
              options={[
                { value: 'CHECKOUT', label: 'Departure date' },
                { value: 'BUSINESS_DATE', label: 'Business date when generated' },
              ]}
              {...common}
            />
            <SettingsDomainManualStringSave
              label="Title"
              configKey="pms.invoice.title"
              initial={configValue(props.keys, 'pms.invoice.title')}
              saveLabel="Save title"
              {...common}
            />
            <SettingsDomainManualStringSave
              label="Footer"
              configKey="pms.invoice.footer"
              initial={configValue(props.keys, 'pms.invoice.footer')}
              saveLabel="Save footer"
              {...common}
            />
            <SettingsDomainBool
              label="Show tax lines"
              configKey="pms.invoice.show_taxfee"
              initial={configValue(props.keys, 'pms.invoice.show_taxfee')}
              {...common}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Card payments</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            No live card gateway is connected in this version. Card authorisation and capture on the
            folio run only against the simulated processor in a local sandbox, and are refused
            elsewhere. Payment terminals and address verification (AVS) come with the first live
            gateway.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Related settings</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="ui-list">
            <li>
              <Link className="ui-link-btn" to="/settings/charges">
                Charge codes and folio routing rules
              </Link>
            </li>
            <li>
              <Link className="ui-link-btn" to="/settings/tax">
                Tax rules
              </Link>
            </li>
            <li>
              <Link className="ui-link-btn" to="/city-ledger">
                City ledger
              </Link>
            </li>
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
