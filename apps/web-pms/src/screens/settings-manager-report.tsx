import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  MANAGER_REPORT_LABEL_MAX,
  MANAGER_REPORT_MAX_BUCKETS,
  MANAGER_REPORT_OTHER_BUCKET,
  ManagerReportConfigSchema,
  managerRowDef,
  readManagerReportConfig,
  type ManagerReportConfig,
} from '@hospai/contracts';
import {
  Alert,
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
  Input,
  NativeSelect,
  Skeleton,
  VisuallyHidden,
} from '@hospai/ui-kit';
import { api, asClassified } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import type { DomainKey } from './settings-domain-fields.js';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Charge codes the system posts itself; they are never F&B. */
const NOT_FNB = new Set(['ROOM', 'PAYMENT']);

type SourceRow = { code: string; name: string; status: string };
type ChargeRow = { code: string; name: string; status: string };

function lookup(keys: DomainKey[], key: string): unknown {
  return keys.find((k) => k.key === key)?.value;
}

function same(a: ManagerReportConfig, b: ManagerReportConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Settings → Reports → Manager Report (R4.32). Edits the DOMAIN key `pms.reports.manager_report`,
 * which pms-core reads when it closes a day (F&B codes) and when it builds the report (occupancy
 * rules, rows, source buckets, fiscal year). Reason-required, like the other DOMAIN settings.
 */
export function ManagerReportSettings(props: {
  keys: DomainKey[];
  reason: string;
  propertyId: string;
  onSaved: () => void | Promise<void>;
  reasonControl: ReactNode;
}) {
  const stored = useMemo(
    () => readManagerReportConfig(lookup(props.keys, 'pms.reports.manager_report')),
    [props.keys],
  );
  const [draft, setDraft] = useState<ManagerReportConfig>(stored);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => setDraft(stored), [stored]);

  const sourcesQ = useQuery({
    queryKey: ['operational-config', props.propertyId],
    queryFn: () => api.listOperationalConfig(props.propertyId),
    retry: false,
  });
  const chargesQ = useQuery({
    queryKey: ['charge-codes', props.propertyId, 'active'],
    queryFn: () => api.listChargeCodes(props.propertyId, { status: 'active' }),
    retry: false,
  });
  const sources = (
    (sourcesQ.data?.items.find((i) => i.key === 'pms.property.sources')?.value ?? []) as SourceRow[]
  ).slice();
  // A code already mapped but no longer in the source list stays editable.
  for (const code of Object.keys(draft.sourceBuckets)) {
    if (!sources.some((s) => s.code === code)) sources.push({ code, name: code, status: 'active' });
  }
  const charges = ((chargesQ.data?.codes ?? []) as ChargeRow[]).filter(
    (c) => c.status === 'active' && !NOT_FNB.has(c.code),
  );

  const dirty = !same(draft, stored);
  const reasonOk = props.reason.trim().length > 0;
  const bucketCount = new Set(Object.values(draft.sourceBuckets)).size;
  const parsed = ManagerReportConfigSchema.safeParse(draft);

  const save = useMutation({
    mutationFn: () =>
      api.putDomainConfig(props.propertyId, {
        key: 'pms.reports.manager_report',
        value: draft,
        reason: props.reason,
      }),
    onSuccess: async () => {
      setError(null);
      setNotice('Manager Report settings saved.');
      await props.onSaved();
    },
    onError: (err) => {
      setNotice(null);
      setError(
        classifiedUserMessage(asClassified(err), { fallback: 'Could not save the Manager Report settings.' }),
      );
    },
  });

  const setRow = (rowId: string, patch: Partial<ManagerReportConfig['rows'][number]>) =>
    setDraft({ ...draft, rows: draft.rows.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)) });
  const move = (index: number, by: -1 | 1) => {
    const rows = draft.rows.slice();
    const target = index + by;
    if (target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target]!, rows[index]!];
    setDraft({ ...draft, rows });
  };
  const setBucket = (code: string, label: string) => {
    const next = { ...draft.sourceBuckets };
    if (label.trim() === '') delete next[code];
    else next[code] = label;
    setDraft({ ...draft, sourceBuckets: next });
  };
  const toggleFnb = (code: string, on: boolean) =>
    setDraft({
      ...draft,
      fnbChargeCodes: on
        ? [...draft.fnbChargeCodes.filter((c) => c !== code), code]
        : draft.fnbChargeCodes.filter((c) => c !== code),
    });

  const blocker =
    bucketCount > MANAGER_REPORT_MAX_BUCKETS
      ? `Use at most ${MANAGER_REPORT_MAX_BUCKETS} different bucket names.`
      : !parsed.success
        ? 'A label is empty or too long, or a setting is out of range.'
        : null;

  return (
    <>
      <Alert intent="attention">
        <span className="ui-alert__title">A reason is required before saving</span>
        <span>Every configuration change is written to the audit log with this note.</span>
      </Alert>
      <Card>
        <CardContent>{props.reasonControl}</CardContent>
      </Card>

      {error ? <Alert intent="exception" data-testid="manager-settings-error">{error}</Alert> : null}
      {notice ? <Alert intent="settled" data-testid="manager-settings-success">{notice}</Alert> : null}

      <Card data-testid="manager-settings-occupancy">
        <CardHeader>
          <CardTitle>Occupancy rules</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="ui-stack">
            <Field
              label="Leave out-of-order rooms out of rooms available"
              hint="Changes rooms available, occupancy % and RevPAR."
              control={
                <Checkbox
                  checked={draft.occupancy.excludeOutOfOrder}
                  onChange={(e) =>
                    setDraft({ ...draft, occupancy: { ...draft.occupancy, excludeOutOfOrder: e.target.checked } })
                  }
                />
              }
            />
            <Field
              label="Count no-shows as rooms sold"
              hint="Changes rooms sold, occupancy % and ADR."
              control={
                <Checkbox
                  checked={draft.occupancy.countNoShowAsSold}
                  onChange={(e) =>
                    setDraft({ ...draft, occupancy: { ...draft.occupancy, countNoShowAsSold: e.target.checked } })
                  }
                />
              }
            />
            <p className="muted">
              Checkout day: the night of departure is never a night sold. This is fixed and cannot be changed.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="manager-settings-rows">
        <CardHeader>
          <CardTitle>Rows</CardTitle>
        </CardHeader>
        <CardContent flush>
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Row</DataTableHeaderCell>
                <DataTableHeaderCell>Show</DataTableHeaderCell>
                <DataTableHeaderCell>Label on the report</DataTableHeaderCell>
                <DataTableHeaderCell>Decimals</DataTableHeaderCell>
                <DataTableHeaderCell>Order</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {draft.rows.map((row, index) => {
                const def = managerRowDef(row.rowId);
                if (!def) return null;
                return (
                  <DataTableRow key={row.rowId} data-testid={`manager-settings-row-${row.rowId}`}>
                    <DataTableCell>
                      {def.perBucket ? `${def.label} by source bucket` : def.label}
                    </DataTableCell>
                    <DataTableCell>
                      <Field
                        label={<VisuallyHidden>Show {def.label}</VisuallyHidden>}
                        control={
                          <Checkbox
                            checked={row.enabled}
                            onChange={(e) => setRow(row.rowId, { enabled: e.target.checked })}
                          />
                        }
                      />
                    </DataTableCell>
                    <DataTableCell>
                      <Field
                        label={<VisuallyHidden>Label for {def.label}</VisuallyHidden>}
                        control={
                          <Input
                            value={row.label}
                            maxLength={MANAGER_REPORT_LABEL_MAX}
                            autoComplete="off"
                            onChange={(e) => setRow(row.rowId, { label: e.target.value })}
                          />
                        }
                      />
                    </DataTableCell>
                    <DataTableCell>
                      {def.ratio ? (
                        <Field
                          label={<VisuallyHidden>Decimals for {def.label}</VisuallyHidden>}
                          control={
                            <NativeSelect
                              value={String(row.decimals)}
                              onChange={(e) => setRow(row.rowId, { decimals: Number(e.target.value) })}
                            >
                              <option value="0">0</option>
                              <option value="1">1</option>
                              <option value="2">2</option>
                            </NativeSelect>
                          }
                        />
                      ) : (
                        <span className="muted">Fixed</span>
                      )}
                    </DataTableCell>
                    <DataTableCell>
                      <Button
                        type="button"
                        aria-label={`Move ${def.label} up`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        Up
                      </Button>{' '}
                      <Button
                        type="button"
                        aria-label={`Move ${def.label} down`}
                        disabled={index === draft.rows.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        Down
                      </Button>
                    </DataTableCell>
                  </DataTableRow>
                );
              })}
            </DataTableBody>
          </DataTable>
        </CardContent>
      </Card>

      <Card data-testid="manager-settings-buckets">
        <CardHeader>
          <CardTitle>Source buckets</CardTitle>
        </CardHeader>
        <CardContent>
          {sourcesQ.isPending ? (
            <Skeleton label="Loading sources" lines={2} />
          ) : sourcesQ.isError ? (
            <Alert>{classifiedUserMessage(asClassified(sourcesQ.error), { fallback: 'Could not load booking sources.' })}</Alert>
          ) : sources.length === 0 ? (
            <EmptyState
              data-testid="manager-settings-no-sources"
              title="No booking sources yet"
              description={`Add sources under Settings, Sources & segments. Until then the report groups everything under ${MANAGER_REPORT_OTHER_BUCKET}.`}
            />
          ) : (
            <div className="ui-stack">
              <p className="muted">
                Give each source the name of the bucket it counts in; sources with the same name share a bucket.
                Leave a name empty to count the source under {MANAGER_REPORT_OTHER_BUCKET}. At most{' '}
                {MANAGER_REPORT_MAX_BUCKETS} buckets.
              </p>
              <DataTable>
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell>Source</DataTableHeaderCell>
                    <DataTableHeaderCell>Bucket</DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {sources.map((s) => (
                    <DataTableRow key={s.code} data-testid={`manager-settings-source-${s.code}`}>
                      <DataTableCell>
                        {s.name}
                        {s.status === 'archived' ? <span className="muted"> (archived)</span> : null}
                        <VisuallyHidden> code {s.code}</VisuallyHidden>
                      </DataTableCell>
                      <DataTableCell>
                        <Field
                          label={<VisuallyHidden>Bucket for {s.name}</VisuallyHidden>}
                          control={
                            <Input
                              value={draft.sourceBuckets[s.code] ?? ''}
                              maxLength={MANAGER_REPORT_LABEL_MAX}
                              placeholder={MANAGER_REPORT_OTHER_BUCKET}
                              autoComplete="off"
                              onChange={(e) => setBucket(s.code, e.target.value)}
                            />
                          }
                        />
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="manager-settings-fnb">
        <CardHeader>
          <CardTitle>F&amp;B revenue</CardTitle>
        </CardHeader>
        <CardContent>
          {chargesQ.isPending ? (
            <Skeleton label="Loading charge codes" lines={2} />
          ) : chargesQ.isError ? (
            <Alert>{classifiedUserMessage(asClassified(chargesQ.error), { fallback: 'Could not load charge codes.' })}</Alert>
          ) : charges.length === 0 ? (
            <EmptyState
              data-testid="manager-settings-no-charges"
              title="No charge codes to choose from"
              description="Add charge codes under Settings, Charges. Everything is counted as other revenue until then."
            />
          ) : (
            <div className="ui-stack">
              <p className="muted">
                Charges on these codes count as F&amp;B revenue. The choice is read when each day closes, so a change
                applies from the next closed day.
              </p>
              {charges.map((c) => (
                <Field
                  key={c.code}
                  label={`${c.name} (${c.code})`}
                  control={
                    <Checkbox
                      checked={draft.fnbChargeCodes.includes(c.code)}
                      onChange={(e) => toggleFnb(c.code, e.target.checked)}
                    />
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="manager-settings-fiscal">
        <CardHeader>
          <CardTitle>Fiscal year</CardTitle>
        </CardHeader>
        <CardContent>
          <Field
            label="Fiscal year starts in"
            hint="The year-to-date column runs from the first of this month."
            control={
              <NativeSelect
                value={String(draft.fiscalYearStartMonth)}
                onChange={(e) => setDraft({ ...draft, fiscalYearStartMonth: Number(e.target.value) })}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </NativeSelect>
            }
          />
        </CardContent>
      </Card>

      {blocker ? <Alert intent="attention" data-testid="manager-settings-blocker">{blocker}</Alert> : null}
      {dirty && !reasonOk ? <p className="muted settings-property__status">Enter a reason to save changes.</p> : null}
      <div>
        <Button
          type="button"
          intent="primary"
          data-testid="manager-settings-save"
          disabled={!dirty || !reasonOk || blocker !== null || save.isPending}
          onClick={() => {
            setNotice(null);
            save.mutate();
          }}
        >
          Save Manager Report settings
        </Button>
      </div>
    </>
  );
}
