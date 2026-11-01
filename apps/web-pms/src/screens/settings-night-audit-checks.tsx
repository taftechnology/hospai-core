import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  NIGHT_AUDIT_CHECK_IDS,
  NIGHT_AUDIT_CHECKS_DEFAULT,
  type NightAuditCheckId,
  type NightAuditCheckSeverity,
} from '@hospai/contracts';
import {
  Alert,
  Button,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Field,
  NativeSelect,
  VisuallyHidden,
} from '@hospai/ui-kit';
import { hasPropertyPermission, type PropertyMe } from '../auth/me.js';
import { api, asClassified } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import {
  CHECK_DESCRIPTIONS,
  CHECK_LABELS,
  NIGHT_AUDIT_CHECK_HINT_ANY_FAIL,
  NIGHT_AUDIT_CHECK_HINT_ARRIVALS_NO_SHOW,
  NIGHT_AUDIT_CHECK_HINT_DEPARTURES_EXTEND,
  SEVERITY_WORD,
} from '../copy/night-audit-check-labels.js';

const SEVERITIES = ['off', 'fail', 'warn', 'info'] as const satisfies readonly NightAuditCheckSeverity[];

type DomainKey = { key: string; value: unknown };

function lookup(keys: DomainKey[], key: string): unknown {
  return keys.find((row) => row.key === key)?.value;
}

function domainBool(keys: DomainKey[], key: string, fallback: boolean): boolean {
  const value = lookup(keys, key);
  return typeof value === 'boolean' ? value : fallback;
}

function readChecks(value: unknown): Record<NightAuditCheckId, NightAuditCheckSeverity> {
  const next: Record<NightAuditCheckId, NightAuditCheckSeverity> = { ...NIGHT_AUDIT_CHECKS_DEFAULT };
  if (!value || typeof value !== 'object') return next;
  const record = value as Record<string, unknown>;
  for (const id of NIGHT_AUDIT_CHECK_IDS) {
    const severity = record[id];
    if (severity === 'off' || severity === 'fail' || severity === 'warn' || severity === 'info') {
      next[id] = severity;
    }
  }
  return next;
}

function sameChecks(
  a: Record<NightAuditCheckId, NightAuditCheckSeverity>,
  b: Record<NightAuditCheckId, NightAuditCheckSeverity>,
): boolean {
  return NIGHT_AUDIT_CHECK_IDS.every((id) => a[id] === b[id]);
}

export function NightAuditChecksSettings(props: {
  keys: DomainKey[];
  reason: string;
  propertyId: string;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  // By content: another control's save refetches the keys and must not drop unsaved edits here.
  const storedChecks = JSON.stringify(lookup(props.keys, 'pms.night_audit.checks') ?? null);
  const initial = useMemo(
    () => readChecks(JSON.parse(storedChecks) as unknown),
    [storedChecks],
  );
  const [draft, setDraft] = useState(initial);
  const [notice, setNotice] = useState<{ text: string; intent: 'settled' | 'exception' } | null>(
    null,
  );
  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const meQ = useQuery({
    queryKey: ['me', props.propertyId],
    queryFn: () => api.getMe(props.propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const canConfigure = Boolean(
    meQ.data && hasPropertyPermission(meQ.data as PropertyMe, 'settings:configure'),
  );
  const autoNoShow = domainBool(props.keys, 'pms.night_audit.auto_no_show', true);
  const autoExtend = domainBool(props.keys, 'pms.night_audit.auto_extend', true);
  const dirty = !sameChecks(draft, initial);
  const anyFail = NIGHT_AUDIT_CHECK_IDS.some((id) => draft[id] === 'fail');
  const arrivalsFail = draft.arrivals_not_checked_in === 'fail';
  const departuresFail = draft.departures_not_checked_out === 'fail';

  const save = useMutation({
    mutationFn: () =>
      api.putDomainConfig(props.propertyId, {
        key: 'pms.night_audit.checks',
        value: { ...draft },
        reason: props.reason,
      }),
    onMutate: () => setNotice(null),
    onSuccess: async () => {
      setNotice({ text: 'Saved.', intent: 'settled' });
      props.onSaved();
      await queryClient.invalidateQueries({ queryKey: ['night-audit', props.propertyId] });
    },
    onError: (err) => {
      setNotice({
        text: classifiedUserMessage(asClassified(err), { fallback: 'Save failed. Try again.' }),
        intent: 'exception',
      });
    },
  });

  return (
    <div className="stack">
      {anyFail ? <Alert intent="attention">{NIGHT_AUDIT_CHECK_HINT_ANY_FAIL}</Alert> : null}
      {arrivalsFail && autoNoShow ? (
        <Alert intent="attention">{NIGHT_AUDIT_CHECK_HINT_ARRIVALS_NO_SHOW}</Alert>
      ) : null}
      {departuresFail && autoExtend ? (
        <Alert intent="attention">{NIGHT_AUDIT_CHECK_HINT_DEPARTURES_EXTEND}</Alert>
      ) : null}
      {meQ.isSuccess && !canConfigure ? (
        <p className="muted">Requires permission settings:configure. Ask a manager.</p>
      ) : null}
      <div className="settings__table">
        <DataTable>
          <DataTableHead>
            <DataTableRow>
              <DataTableHeaderCell>Check</DataTableHeaderCell>
              <DataTableHeaderCell>What it counts</DataTableHeaderCell>
              <DataTableHeaderCell>Severity</DataTableHeaderCell>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            <DataTableRow>
              <DataTableCell>{CHECK_LABELS.queued_commands}</DataTableCell>
              <DataTableCell>{CHECK_DESCRIPTIONS.queued_commands}</DataTableCell>
              <DataTableCell>
                Fail <span className="muted">Always on</span>
              </DataTableCell>
            </DataTableRow>
            <DataTableRow>
              <DataTableCell>{CHECK_LABELS.open_exceptions}</DataTableCell>
              <DataTableCell>{CHECK_DESCRIPTIONS.open_exceptions}</DataTableCell>
              <DataTableCell>
                Fail <span className="muted">Always on</span>
              </DataTableCell>
            </DataTableRow>
            {NIGHT_AUDIT_CHECK_IDS.map((id) => (
              <DataTableRow key={id}>
                <DataTableCell>{CHECK_LABELS[id]}</DataTableCell>
                <DataTableCell>{CHECK_DESCRIPTIONS[id]}</DataTableCell>
                <DataTableCell>
                  <Field
                    label={<VisuallyHidden>{CHECK_LABELS[id]}</VisuallyHidden>}
                    size="sm"
                    control={
                      <NativeSelect
                        value={draft[id]}
                        disabled={!canConfigure}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (
                            value === 'off' ||
                            value === 'fail' ||
                            value === 'warn' ||
                            value === 'info'
                          ) {
                            setDraft((prev) => ({ ...prev, [id]: value }));
                          }
                        }}
                      >
                        {SEVERITIES.map((severity) => (
                          <option key={severity} value={severity}>
                            {SEVERITY_WORD[severity]}
                          </option>
                        ))}
                      </NativeSelect>
                    }
                  />
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      </div>
      <div className="ui-row">
        <Button
          type="button"
          intent="primary"
          disabled={!canConfigure || !dirty || !props.reason.trim() || save.isPending}
          onClick={() => {
            if (!canConfigure) return;
            save.mutate();
          }}
        >
          Save
        </Button>
      </div>
      {dirty && canConfigure && !props.reason.trim() ? (
        <p className="muted settings-property__status">Enter a reason to save changes.</p>
      ) : null}
      {notice ? <Alert intent={notice.intent}>{notice.text}</Alert> : null}
    </div>
  );
}
