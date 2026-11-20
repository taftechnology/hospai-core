import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  HK_TASK_TYPES_MAX,
  HK_TASK_TYPE_LABEL_MAX,
  HK_TASK_TYPE_CODE_RE,
  type HousekeepingTaskType,
} from '@hospai/contracts';
import { Button, Field, Input, SectionLabel } from '@hospai/ui-kit';
import { api } from '../client.js';
import { AutoSaveStatusIndicator, useAutoSave } from './settings-domain-fields.js';

export const TASK_TYPES_KEY = 'pms.housekeeping.task_types';

type Row = HousekeepingTaskType;

/** A code the operator never sees: `Mini bar restock` -> `mini_bar_restock`, unique in the list. */
export function codeForLabel(label: string, taken: ReadonlySet<string>): string {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);
  if (!base || !/^[a-z]/.test(base)) base = `type_${base}`.replace(/_+$/, '').slice(0, 28);
  let code = base;
  let n = 2;
  while (taken.has(code) || !HK_TASK_TYPE_CODE_RE.test(code)) {
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
