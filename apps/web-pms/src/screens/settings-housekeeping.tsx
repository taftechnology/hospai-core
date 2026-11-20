import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  HK_REQUEST_TYPES_MAX,
  HK_REQUEST_TYPE_CODE_RE,
  HK_REQUEST_TYPE_LABEL_MAX,
  HK_TASK_TYPES_MAX,
  HK_TASK_TYPE_LABEL_MAX,
  HK_TASK_TYPE_CODE_RE,
  HOUSEKEEPING_REQUEST_DEPARTMENTS,
  isHousekeepingRequestDepartment,
  type HousekeepingRequestDepartment,
  type HousekeepingRequestType,
  type HousekeepingTaskType,
} from '@hospai/contracts';
import { Button, Field, Input, NativeSelect, SectionLabel } from '@hospai/ui-kit';
import { api } from '../client.js';
import { AutoSaveStatusIndicator, useAutoSave } from './settings-domain-fields.js';

export const TASK_TYPES_KEY = 'pms.housekeeping.task_types';
export const REQUEST_TYPES_KEY = 'pms.housekeeping.request_types';

const DEPARTMENT_WORD: Record<HousekeepingRequestDepartment, string> = {
  housekeeping: 'Housekeeping',
  front_office: 'Front office',
  maintenance: 'Maintenance',
  food_beverage: 'Food and beverage',
};

type Row = HousekeepingTaskType;

/** A code the operator never sees: `Mini bar restock` -> `mini_bar_restock`, unique in the list. */
export function codeForLabel(
  label: string,
  taken: ReadonlySet<string>,
  codeRe: RegExp = HK_TASK_TYPE_CODE_RE,
): string {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);
  if (!base || !/^[a-z]/.test(base)) base = `type_${base}`.replace(/_+$/, '').slice(0, 28);
  let code = base;
  let n = 2;
  while (taken.has(code) || !codeRe.test(code)) {
    code = `${base}_${n++}`.slice(0, 32);
  }
  return code;
}

function parseRows(initial: unknown): Row[] {
  if (!Array.isArray(initial)) return [];
  return initial
    .filter(
      (t): t is Row =>
        Boolean(t) &&
        typeof (t as Row).code === 'string' &&
        typeof (t as Row).label === 'string',
    )
    .map((t) => ({ code: t.code, label: t.label }));
}

/** Settings → Housekeeping: the list of task types a task can have (`pms.housekeeping.task_types`). */
export function HousekeepingTaskTypesSettings(props: {
  initial: unknown;
  reason: string;
  propertyId: string;
  onSaved: () => void;
}) {
  const baseline = useMemo(() => parseRows(props.initial), [props.initial]);
  const [rows, setRows] = useState<Row[]>(baseline);
  useEffect(() => setRows(baseline), [baseline]);

  const blank = rows.some((r) => !r.label.trim());
  const overCap = rows.length > HK_TASK_TYPES_MAX;
  const invalid = blank || overCap;
  const dirty = JSON.stringify(rows) !== JSON.stringify(baseline);

  const save = useMutation({
    mutationFn: () =>
      api.putDomainConfig(props.propertyId, {
        key: TASK_TYPES_KEY,
        value: rows.map((r) => ({ code: r.code, label: r.label.trim() })),
        reason: props.reason,
      }),
    onSuccess: () => {
      props.onSaved();
      setStatus('saved');
    },
    onError: () => setStatus('error'),
  });
  // Only a valid list is saved; an unfinished row waits for its label.
  const [status, setStatus] = useAutoSave({
    dirty: dirty && !invalid,
    reason: props.reason,
    save: () => save.mutate(),
  });

  function addRow() {
    setRows((prev) => {
      const taken = new Set(prev.map((r) => r.code));
      return [...prev, { code: codeForLabel(`new type ${prev.length + 1}`, taken), label: '' }];
    });
  }

  function setLabel(index: number, label: string) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        // A row added in this session takes its code from the label it is given; stored codes stay.
        const isNew = !baseline.some((b) => b.code === r.code);
        if (!isNew) return { ...r, label };
        const taken = new Set(prev.filter((_, j) => j !== index).map((x) => x.code));
        return { code: codeForLabel(label.trim() || 'type', taken), label };
      }),
    );
  }

  return (
    <div className="ui-stack" data-config-key={TASK_TYPES_KEY} data-testid="hk-task-types">
      <SectionLabel>Task types</SectionLabel>
      <p className="muted">
        The kinds of housekeeping task people can pick, up to {HK_TASK_TYPES_MAX}. Tasks already
        created keep their type if it is removed here.
      </p>
      {rows.map((row, index) => (
        <div className="ui-row" key={index}>
          <Field
            label={`Task type ${index + 1}`}
            control={
              <Input
                value={row.label}
                maxLength={HK_TASK_TYPE_LABEL_MAX}
                autoComplete="off"
                onChange={(e) => setLabel(index, e.target.value)}
              />
            }
          />
          <Button
            type="button"
            intent="ghost"
            aria-label={`Remove task type ${row.label || index + 1}`}
            onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      {rows.length === 0 ? (
        <p className="muted">No task types. Add one so tasks can be created.</p>
      ) : null}
      <div>
        <Button type="button" disabled={rows.length >= HK_TASK_TYPES_MAX} onClick={addRow}>
          Add task type
        </Button>
      </div>
      {blank ? <p className="muted">Give every task type a name to save the list.</p> : null}
      <AutoSaveStatusIndicator status={status} dirty={dirty && !invalid} reason={props.reason} />
    </div>
  );
}

type RequestRow = HousekeepingRequestType;

function parseRequestRows(initial: unknown): RequestRow[] {
  if (!Array.isArray(initial)) return [];
  return initial
    .filter(
      (t): t is RequestRow =>
        Boolean(t) &&
        typeof (t as RequestRow).code === 'string' &&
        typeof (t as RequestRow).label === 'string' &&
        isHousekeepingRequestDepartment((t as RequestRow).department),
    )
    .map((t) => ({ code: t.code, label: t.label, department: t.department }));
}

/**
 * Settings → Housekeeping: the guest request types and the department each one goes to
 * (`pms.housekeeping.request_types`, R4.11). Codes are derived and never shown.
 */
export function HousekeepingRequestTypesSettings(props: {
  initial: unknown;
  reason: string;
  propertyId: string;
  onSaved: () => void;
}) {
  const baseline = useMemo(() => parseRequestRows(props.initial), [props.initial]);
  const [rows, setRows] = useState<RequestRow[]>(baseline);
  useEffect(() => setRows(baseline), [baseline]);

  const blank = rows.some((r) => !r.label.trim());
  const overCap = rows.length > HK_REQUEST_TYPES_MAX;
  const invalid = blank || overCap;
  const dirty = JSON.stringify(rows) !== JSON.stringify(baseline);

  const save = useMutation({
    mutationFn: () =>
      api.putDomainConfig(props.propertyId, {
        key: REQUEST_TYPES_KEY,
        value: rows.map((r) => ({ code: r.code, label: r.label.trim(), department: r.department })),
        reason: props.reason,
      }),
    onSuccess: () => {
      props.onSaved();
      setStatus('saved');
    },
    onError: () => setStatus('error'),
  });
  const [status, setStatus] = useAutoSave({
    dirty: dirty && !invalid,
    reason: props.reason,
    save: () => save.mutate(),
  });

  function addRow() {
    setRows((prev) => {
      const taken = new Set(prev.map((r) => r.code));
      return [
        ...prev,
        {
          code: codeForLabel(`new request ${prev.length + 1}`, taken, HK_REQUEST_TYPE_CODE_RE),
          label: '',
          department: 'housekeeping',
        },
      ];
    });
  }

  function setLabel(index: number, label: string) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        const isNew = !baseline.some((b) => b.code === r.code);
        if (!isNew) return { ...r, label };
        const taken = new Set(prev.filter((_, j) => j !== index).map((x) => x.code));
        return {
          ...r,
          code: codeForLabel(label.trim() || 'request', taken, HK_REQUEST_TYPE_CODE_RE),
          label,
        };
      }),
    );
  }

  return (
    <div className="ui-stack" data-config-key={REQUEST_TYPES_KEY} data-testid="hk-request-types">
      <SectionLabel>Guest request types</SectionLabel>
      <p className="muted">
        The requests a guest can make, and the department each one goes to, up to {HK_REQUEST_TYPES_MAX}.
        Requests already logged keep their type if it is removed here.
      </p>
      {rows.map((row, index) => (
        <div className="ui-row" key={index}>
          <Field
            label={`Request type ${index + 1}`}
            control={
              <Input
                value={row.label}
                maxLength={HK_REQUEST_TYPE_LABEL_MAX}
                autoComplete="off"
                onChange={(e) => setLabel(index, e.target.value)}
              />
            }
          />
          <Field
            label={`Department for request type ${index + 1}`}
            control={
              <NativeSelect
                value={row.department}
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((r, i) =>
                      i === index
                        ? { ...r, department: e.target.value as HousekeepingRequestDepartment }
                        : r,
                    ),
                  )
                }
              >
                {HOUSEKEEPING_REQUEST_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {DEPARTMENT_WORD[d]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Button
            type="button"
            intent="ghost"
            aria-label={`Remove request type ${row.label || index + 1}`}
            onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      {rows.length === 0 ? (
        <p className="muted">No request types. Add one so guest requests can be logged.</p>
      ) : null}
      <div>
        <Button type="button" disabled={rows.length >= HK_REQUEST_TYPES_MAX} onClick={addRow}>
          Add request type
        </Button>
      </div>
      {blank ? <p className="muted">Give every request type a name to save the list.</p> : null}
      <AutoSaveStatusIndicator status={status} dirty={dirty && !invalid} reason={props.reason} />
    </div>
  );
}
