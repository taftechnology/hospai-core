import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  AMENITY_WHEN,
  DEFAULT_MINIBAR_CONFIG,
  HK_AMENITIES_MAX,
  HK_AMENITY_NAME_MAX,
  HK_AMENITY_QTY_MAX,
  HK_AMENITY_RULES_MAX,
  HK_AMENITY_RULE_LINES_MAX,
  HK_AMENITY_UNIT_MAX,
  HK_MINIBAR_ITEMS_MAX,
  MINIBAR_CONFIG_KEY,
  MinibarConfigSchema,
  type AmenityRow,
  type AmenityRuleRow,
  type AmenityWhen,
  type MinibarConfig,
  HK_INSPECTION_DEFAULT_THRESHOLD,
  HK_INSPECTION_ITEMS_MAX,
  HK_INSPECTION_LABEL_MAX,
  HK_INSPECTION_SECTION_MAX,
  HK_INSPECTION_TEMPLATE_NAME_MAX,
  HK_INSPECTION_TEMPLATES_MAX,
  HK_INSPECTION_WEIGHT_MAX,
  HK_INSPECTION_WEIGHT_MIN,
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
  type InspectionTemplate,
  type InspectionTemplateItemInput,
} from '@hospai/contracts';
import { amenitiesKey, inspectionTemplatesKey } from '@hospai/pms-housekeeping/ui';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  NativeSelect,
  SectionLabel,
  Skeleton,
} from '@hospai/ui-kit';
import { api, asClassified } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { AutoSaveStatusIndicator, useAutoSave } from './settings-domain-fields.js';

export const MINIBAR_KEY = MINIBAR_CONFIG_KEY;
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

// ---------------------------------------------------------------------------
// R4.11 Part B: inspection templates
// ---------------------------------------------------------------------------

type TemplateItemDraft = InspectionTemplateItemInput;
type TemplateDraft = {
  templateId?: string;
  name: string;
  active: boolean;
  passThreshold: string;
  items: TemplateItemDraft[];
};

function blankItem(section = ''): TemplateItemDraft {
  return { section, label: '', weight: 1, mandatory: false };
}

function draftOf(template?: InspectionTemplate): TemplateDraft {
  if (!template) {
    return {
      name: '',
      active: true,
      passThreshold: String(HK_INSPECTION_DEFAULT_THRESHOLD),
      items: [blankItem()],
    };
  }
  return {
    templateId: template.templateId,
    name: template.name,
    active: template.active,
    passThreshold: String(template.passThreshold),
    items: template.items.map(({ section, label, weight, mandatory }) => ({ section, label, weight, mandatory })),
  };
}

const WEIGHTS = Array.from(
  { length: HK_INSPECTION_WEIGHT_MAX - HK_INSPECTION_WEIGHT_MIN + 1 },
  (_, i) => HK_INSPECTION_WEIGHT_MIN + i,
);

function thresholdOf(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= 0 && n <= 100 ? n : null;
}

/**
 * Settings → Housekeeping: inspection templates (R4.11 Part B). Each template is a set of weighted,
 * ordered items with a pass threshold. Templates are never deleted, only deactivated, and editing
 * one never changes an inspection already recorded.
 */
export function InspectionTemplatesSettings(props: { propertyId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: inspectionTemplatesKey(props.propertyId),
    queryFn: () => api.getInspectionTemplates(props.propertyId),
  });
  const [editing, setEditing] = useState<TemplateDraft | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (input: { draft: TemplateDraft; words: string; fromEditor: boolean }) => {
      const threshold = thresholdOf(input.draft.passThreshold) ?? HK_INSPECTION_DEFAULT_THRESHOLD;
      return api.saveInspectionTemplate(
        props.propertyId,
        {
          ...(input.draft.templateId ? { templateId: input.draft.templateId } : {}),
          name: input.draft.name.trim(),
          active: input.draft.active,
          passThreshold: threshold,
          items: input.draft.items.map((i) => ({
            section: i.section.trim(),
            label: i.label.trim(),
            weight: i.weight,
            mandatory: i.mandatory,
          })),
        },
        crypto.randomUUID(),
      );
    },
    onSuccess: async (_r, input) => {
      setEditing(null);
      setDialogError(null);
      setNotice(null);
      setDone(`Template ${input.draft.name.trim()} ${input.words}.`);
      await queryClient.invalidateQueries({ queryKey: inspectionTemplatesKey(props.propertyId) });
    },
    onError: (err, input) => {
      const text = classifiedUserMessage(asClassified(err), { fallback: 'Could not save the template.' });
      if (input.fromEditor) setDialogError(text);
      else setNotice(text);
    },
  });

  const templates = query.data?.templates ?? [];
  const atCap = templates.length >= HK_INSPECTION_TEMPLATES_MAX;

  return (
    <div className="ui-stack" data-testid="hk-inspection-templates">
      <SectionLabel>Inspection templates</SectionLabel>
      <p className="muted">
        The checklists used to score a room inspection, up to {HK_INSPECTION_TEMPLATES_MAX}. A template is
        turned off rather than deleted, and editing one never changes inspections already recorded.
      </p>
      {done ? (
        <Alert intent="settled" data-testid="hk-template-settled">
          {done}
        </Alert>
      ) : null}
      {notice ? <Alert intent="exception">{notice}</Alert> : null}
      {query.isLoading ? <Skeleton label="Loading templates" /> : null}
      {query.isError ? (
        <Alert intent="exception">
          {classifiedUserMessage(asClassified(query.error), { fallback: 'Could not load inspection templates.' })}
        </Alert>
      ) : null}
      {query.isSuccess && templates.length === 0 ? (
        <p className="muted">No inspection templates. Add one so rooms can be inspected.</p>
      ) : null}
      {templates.map((t) => (
        <div className="ui-row" key={t.templateId} data-testid="hk-template-row">
          <span>
            <strong>{t.name}</strong> · {t.items.length} {t.items.length === 1 ? 'item' : 'items'} · passes at{' '}
            {t.passThreshold} percent · {t.active ? 'On' : 'Off'}
          </span>
          <Button
            type="button"
            intent="ghost"
            aria-label={`Edit template ${t.name}`}
            onClick={() => {
              setDialogError(null);
              setEditing(draftOf(t));
            }}
          >
            Edit
          </Button>
          <Button
            type="button"
            intent="ghost"
            aria-label={`${t.active ? 'Turn off' : 'Turn on'} template ${t.name}`}
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                draft: { ...draftOf(t), active: !t.active },
                words: t.active ? 'turned off' : 'turned on',
                fromEditor: false,
              })
            }
          >
            {t.active ? 'Turn off' : 'Turn on'}
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          disabled={atCap}
          onClick={() => {
            setDialogError(null);
            setEditing(draftOf());
          }}
        >
          Add template
        </Button>
      </div>
      {atCap ? <p className="muted">The limit of {HK_INSPECTION_TEMPLATES_MAX} templates is reached.</p> : null}
      {editing ? (
        <TemplateEditorDialog
          key={editing.templateId ?? 'new'}
          initial={editing}
          busy={save.isPending}
          error={dialogError}
          onClose={() => setEditing(null)}
          onSave={(draft) =>
            save.mutate({ draft, words: draft.templateId ? 'saved' : 'added', fromEditor: true })
          }
        />
      ) : null}
    </div>
  );
}

function TemplateEditorDialog({
  initial,
  busy,
  error,
  onClose,
  onSave,
}: {
  initial: TemplateDraft;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (draft: TemplateDraft) => void;
}) {
  const [draft, setDraft] = useState<TemplateDraft>(initial);
  const setItem = (index: number, patch: Partial<TemplateItemDraft>) =>
    setDraft((prev) => ({ ...prev, items: prev.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }));
  const move = (index: number, by: -1 | 1) =>
    setDraft((prev) => {
      const target = index + by;
      if (target < 0 || target >= prev.items.length) return prev;
      const items = [...prev.items];
      [items[index], items[target]] = [items[target]!, items[index]!];
      return { ...prev, items };
    });

  const threshold = thresholdOf(draft.passThreshold);
  const problem = !draft.name.trim()
    ? 'Give the template a name.'
    : threshold === null
      ? 'Enter a pass threshold from 0 to 100.'
      : draft.items.length === 0
        ? 'Add at least one item.'
        : draft.items.some((i) => !i.section.trim() || !i.label.trim())
          ? 'Give every item a section and a label.'
          : null;

  function submit() {
    if (!problem && !busy) onSave(draft);
  }

  return (
    <Dialog
      open
      wide
      title={draft.templateId ? 'Edit inspection template' : 'New inspection template'}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={busy || problem !== null} onClick={submit}>
            Save template
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        data-testid="hk-template-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        <div className="ui-row">
          <Field
            label="Template name"
            control={
              <Input
                aria-label="Template name"
                value={draft.name}
                maxLength={HK_INSPECTION_TEMPLATE_NAME_MAX}
                autoComplete="off"
                onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
              />
            }
          />
          <Field
            label="Pass threshold (percent)"
            control={
              <Input
                type="number"
                min={0}
                max={100}
                aria-label="Pass threshold"
                value={draft.passThreshold}
                onChange={(e) => setDraft((prev) => ({ ...prev, passThreshold: e.target.value }))}
              />
            }
          />
          <Field
            label="Active"
            control={
              <Checkbox
                aria-label="Template active"
                checked={draft.active}
                onChange={(e) => setDraft((prev) => ({ ...prev, active: e.target.checked }))}
              />
            }
          />
        </div>
        <SectionLabel>Items, in the order they are inspected</SectionLabel>
        {draft.items.map((item, index) => (
          <div className="ui-row" key={index} data-testid="hk-template-item">
            <Field
              label={`Section ${index + 1}`}
              control={
                <Input
                  aria-label={`Item ${index + 1} section`}
                  value={item.section}
                  maxLength={HK_INSPECTION_SECTION_MAX}
                  autoComplete="off"
                  onChange={(e) => setItem(index, { section: e.target.value })}
                />
              }
            />
            <Field
              label={`Item ${index + 1}`}
              control={
                <Input
                  aria-label={`Item ${index + 1} label`}
                  value={item.label}
                  maxLength={HK_INSPECTION_LABEL_MAX}
                  autoComplete="off"
                  onChange={(e) => setItem(index, { label: e.target.value })}
                />
              }
            />
            <Field
              label={`Weight ${index + 1}`}
              control={
                <NativeSelect
                  aria-label={`Item ${index + 1} weight`}
                  value={String(item.weight)}
                  onChange={(e) => setItem(index, { weight: Number(e.target.value) })}
                >
                  {WEIGHTS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
            <Field
              label={`Required ${index + 1}`}
              hint="A failed required item fails the inspection."
              control={
                <Checkbox
                  aria-label={`Item ${index + 1} required`}
                  checked={item.mandatory}
                  onChange={(e) => setItem(index, { mandatory: e.target.checked })}
                />
              }
            />
            <Button
              type="button"
              intent="ghost"
              aria-label={`Move item ${index + 1} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              Up
            </Button>
            <Button
              type="button"
              intent="ghost"
              aria-label={`Move item ${index + 1} down`}
              disabled={index === draft.items.length - 1}
              onClick={() => move(index, 1)}
            >
              Down
            </Button>
            <Button
              type="button"
              intent="ghost"
              aria-label={`Remove item ${index + 1}`}
              onClick={() => setDraft((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }))}
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            disabled={draft.items.length >= HK_INSPECTION_ITEMS_MAX}
            onClick={() =>
              setDraft((prev) => ({
                ...prev,
                items: [...prev.items, blankItem(prev.items[prev.items.length - 1]?.section ?? '')],
              }))
            }
          >
            Add item
          </Button>
        </div>
        {problem ? <p className="muted">{problem}</p> : null}
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// R4.11 Part C: minibar setup, amenity master and amenity rules
// ---------------------------------------------------------------------------

const AMENITY_WHEN_WORD: Record<AmenityWhen, string> = {
  arrival: 'Arrival',
  stayover: 'Stayover',
  departure: 'Departure',
};

function parseMinibar(initial: unknown): MinibarConfig {
  const parsed = MinibarConfigSchema.safeParse(initial);
  return parsed.success ? parsed.data : { ...DEFAULT_MINIBAR_CONFIG, items: [] };
}

/**
 * The minibar setup (`pms.housekeeping.minibar`, R4.11 Part C): switch it on, choose which products
 * can be picked up, and link each to a Minibar stock item so pickups reduce stock. Prices come from
 * the products catalogue, never from here.
 */
export function MinibarSettings(props: {
  initial: unknown;
  reason: string;
  propertyId: string;
  onSaved: () => void;
}) {
  const baseline = useMemo(() => parseMinibar(props.initial), [props.initial]);
  const [config, setConfig] = useState<MinibarConfig>(baseline);
  useEffect(() => setConfig(baseline), [baseline]);

  const products = useQuery({
    queryKey: ['products', props.propertyId, 'active'],
    queryFn: () => api.listProducts(props.propertyId, { status: 'active' }),
  });
  const stock = useQuery({
    queryKey: ['housekeeping-inventory', props.propertyId, { archived: false }],
    queryFn: () => api.getHousekeepingInventory(props.propertyId, { archived: false }),
  });
  const productList = (products.data?.items ?? []).filter((p) => p.status === 'active');
  const stockList = (stock.data?.items ?? []).filter((i) => i.category === 'minibar' && !i.archived);
  const picked = new Set(config.items.map((i) => i.productId));
  const incomplete = config.items.some((i) => !i.productId);
  const dirty = JSON.stringify(config) !== JSON.stringify(baseline);

  const save = useMutation({
    mutationFn: () =>
      api.putDomainConfig(props.propertyId, {
        key: MINIBAR_CONFIG_KEY,
        value: { enabled: config.enabled, items: config.items.filter((i) => i.productId) },
        reason: props.reason,
      }),
    onSuccess: () => {
      props.onSaved();
      setStatus('saved');
    },
    onError: () => setStatus('error'),
  });
  const [status, setStatus] = useAutoSave({
    dirty: dirty && !incomplete,
    reason: props.reason,
    save: () => save.mutate(),
  });

  const setItem = (index: number, patch: Partial<MinibarConfig['items'][number]>) =>
    setConfig((prev) => ({ ...prev, items: prev.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }));

  return (
    <div className="ui-stack" data-config-key={MINIBAR_CONFIG_KEY} data-testid="hk-minibar-settings">
      <SectionLabel>Minibar</SectionLabel>
      <p className="muted">
        When the minibar is on, a pickup is charged to the guest folio at the product price, with tax, and takes
        the linked stock down. Up to {HK_MINIBAR_ITEMS_MAX} products.
      </p>
      <Field
        label="Minibar enabled"
        control={
          <Checkbox
            aria-label="Minibar enabled"
            checked={config.enabled}
            onChange={(e) => setConfig((prev) => ({ ...prev, enabled: e.target.checked }))}
          />
        }
      />
      {products.isError ? (
        <Alert intent="exception">
          {classifiedUserMessage(asClassified(products.error), { fallback: 'Could not load the products.' })}
        </Alert>
      ) : null}
      {config.items.map((item, index) => (
        <div className="ui-row" key={index} data-testid="hk-minibar-setup-row">
          <Field
            label={`Minibar product ${index + 1}`}
            control={
              <NativeSelect
                aria-label={`Minibar product ${index + 1}`}
                value={item.productId}
                onChange={(e) => setItem(index, { productId: e.target.value })}
              >
                <option value="">Pick a product</option>
                {productList
                  .filter((p) => p.productId === item.productId || !picked.has(p.productId))
                  .map((p) => (
                    <option key={p.productId} value={p.productId}>
                      {p.name}
                    </option>
                  ))}
              </NativeSelect>
            }
          />
          <Field
            label={`Stock item for product ${index + 1}`}
            control={
              <NativeSelect
                aria-label={`Stock item for product ${index + 1}`}
                value={item.inventoryItemId ?? ''}
                onChange={(e) => setItem(index, { inventoryItemId: e.target.value || null })}
              >
                <option value="">Stock not tracked</option>
                {stockList.map((i) => (
                  <option key={i.itemId} value={i.itemId}>
                    {i.name}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Button
            type="button"
            intent="ghost"
            aria-label={`Remove minibar product ${index + 1}`}
            onClick={() => setConfig((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }))}
          >
            Remove
          </Button>
        </div>
      ))}
      {config.items.length === 0 ? <p className="muted">No products yet. Add the products guests can take.</p> : null}
      <div>
        <Button
          type="button"
          disabled={config.items.length >= HK_MINIBAR_ITEMS_MAX}
          onClick={() =>
            setConfig((prev) => ({ ...prev, items: [...prev.items, { productId: '', inventoryItemId: null }] }))
          }
        >
          Add product
        </Button>
      </div>
      {incomplete ? <p className="muted">Pick a product for every row to save the setup.</p> : null}
      <AutoSaveStatusIndicator status={status} dirty={dirty && !incomplete} reason={props.reason} />
    </div>
  );
}

type AmenityDraft = {
  amenityId?: string;
  name: string;
  unit: string;
  standardQuantity: string;
  inventoryItemId: string;
  active: boolean;
};

function amenityDraftOf(a?: AmenityRow): AmenityDraft {
  return a
    ? {
        amenityId: a.amenityId,
        name: a.name,
        unit: a.unit,
        standardQuantity: String(a.standardQuantity),
        inventoryItemId: a.inventoryItemId ?? '',
        active: a.active,
      }
    : { name: '', unit: '', standardQuantity: '1', inventoryItemId: '', active: true };
}

type RuleDraft = {
  ruleId?: string;
  name: string;
  roomTypeId: string;
  when: AmenityWhen;
  lines: Array<{ amenityId: string; quantity: string }>;
  active: boolean;
};

function ruleDraftOf(r?: AmenityRuleRow): RuleDraft {
  return r
    ? {
        ruleId: r.ruleId,
        name: r.name,
        roomTypeId: r.roomTypeId ?? '',
        when: r.when,
        lines: r.lines.map((l) => ({ amenityId: l.amenityId, quantity: String(l.quantity) })),
        active: r.active,
      }
    : { name: '', roomTypeId: '', when: 'arrival', lines: [{ amenityId: '', quantity: '1' }], active: true };
}

const quantityOf = (text: string): number | null => {
  if (!/^\d{1,4}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= 1 && n <= HK_AMENITY_QTY_MAX ? n : null;
};

/**
 * The amenity master and the rule templates (R4.11 Part C). An amenity can link to an Amenities stock
 * item; a dispatch of a linked amenity takes that stock down. Amenities are never charged to the folio.
 */
export function AmenitySettings(props: { propertyId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: amenitiesKey(props.propertyId),
    queryFn: () => api.getAmenities(props.propertyId),
  });
  const stock = useQuery({
    queryKey: ['housekeeping-inventory', props.propertyId, { archived: false }],
    queryFn: () => api.getHousekeepingInventory(props.propertyId, { archived: false }),
  });
  const roomTypes = useQuery({
    queryKey: ['room-types', props.propertyId, 'active'],
    queryFn: () => api.listRoomTypes(props.propertyId, { status: 'active' }),
  });
  const [amenityEditing, setAmenityEditing] = useState<AmenityDraft | null>(null);
  const [ruleEditing, setRuleEditing] = useState<RuleDraft | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const amenities = query.data?.amenities ?? [];
  const rules = query.data?.rules ?? [];
  const stockList = (stock.data?.items ?? []).filter((i) => i.category === 'amenities' && !i.archived);
  const failure = (err: unknown, fallback: string) => classifiedUserMessage(asClassified(err), { fallback });

  const saveAmenity = useMutation({
    mutationFn: (input: { draft: AmenityDraft; words: string; fromEditor: boolean }) =>
      api.saveAmenity(
        props.propertyId,
        {
          ...(input.draft.amenityId ? { amenityId: input.draft.amenityId } : {}),
          name: input.draft.name.trim(),
          unit: input.draft.unit.trim(),
          standardQuantity: quantityOf(input.draft.standardQuantity) ?? 1,
          inventoryItemId: input.draft.inventoryItemId || null,
          active: input.draft.active,
        },
        crypto.randomUUID(),
      ),
    onSuccess: async (_r, input) => {
      setAmenityEditing(null);
      setDialogError(null);
      setNotice(null);
      setDone(`Amenity ${input.draft.name.trim()} ${input.words}.`);
      await queryClient.invalidateQueries({ queryKey: amenitiesKey(props.propertyId) });
    },
    onError: (err, input) => {
      const text = failure(err, 'Could not save the amenity. Names must be unique.');
      if (input.fromEditor) setDialogError(text);
      else setNotice(text);
    },
  });

  const saveRule = useMutation({
    mutationFn: (input: { draft: RuleDraft; words: string; fromEditor: boolean }) =>
      api.saveAmenityRule(
        props.propertyId,
        {
          ...(input.draft.ruleId ? { ruleId: input.draft.ruleId } : {}),
          name: input.draft.name.trim(),
          roomTypeId: input.draft.roomTypeId || null,
          when: input.draft.when,
          lines: input.draft.lines.map((l) => ({ amenityId: l.amenityId, quantity: quantityOf(l.quantity) ?? 1 })),
          active: input.draft.active,
        },
        crypto.randomUUID(),
      ),
    onSuccess: async (_r, input) => {
      setRuleEditing(null);
      setDialogError(null);
      setNotice(null);
      setDone(`Rule ${input.draft.name.trim()} ${input.words}.`);
      await queryClient.invalidateQueries({ queryKey: amenitiesKey(props.propertyId) });
    },
    onError: (err, input) => {
      const text = failure(err, 'Could not save the rule. Names must be unique.');
      if (input.fromEditor) setDialogError(text);
      else setNotice(text);
    },
  });

  const nameOf = (id: string) => amenities.find((a) => a.amenityId === id)?.name ?? 'An amenity';

  return (
    <div className="ui-stack" data-testid="hk-amenity-settings">
      <SectionLabel>Amenities</SectionLabel>
      <p className="muted">
        What can be sent to a room, in what unit and standard quantity, up to {HK_AMENITIES_MAX}. Link an amenity
        to an Amenities stock item to take stock down when it is dispatched. Amenities are not charged to the
        folio. An amenity is turned off rather than deleted.
      </p>
      {done ? (
        <Alert intent="settled" data-testid="hk-amenity-setting-settled">
          {done}
        </Alert>
      ) : null}
      {notice ? <Alert intent="exception">{notice}</Alert> : null}
      {query.isLoading ? <Skeleton label="Loading amenities" /> : null}
      {query.isError ? <Alert intent="exception">{failure(query.error, 'Could not load amenities.')}</Alert> : null}
      {query.isSuccess && amenities.length === 0 ? <p className="muted">No amenities yet.</p> : null}
      {amenities.map((a) => (
        <div className="ui-row" key={a.amenityId} data-testid="hk-amenity-row">
          <span>
            <strong>{a.name}</strong> · {a.standardQuantity} {a.unit} · {a.inventoryItemName ?? 'Stock not linked'} ·{' '}
            {a.active ? 'On' : 'Off'}
          </span>
          <Button
            type="button"
            intent="ghost"
            aria-label={`Edit amenity ${a.name}`}
            onClick={() => {
              setDialogError(null);
              setAmenityEditing(amenityDraftOf(a));
            }}
          >
            Edit
          </Button>
          <Button
            type="button"
            intent="ghost"
            aria-label={`${a.active ? 'Turn off' : 'Turn on'} amenity ${a.name}`}
            disabled={saveAmenity.isPending}
            onClick={() =>
              saveAmenity.mutate({
                draft: { ...amenityDraftOf(a), active: !a.active },
                words: a.active ? 'turned off' : 'turned on',
                fromEditor: false,
              })
            }
          >
            {a.active ? 'Turn off' : 'Turn on'}
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          disabled={amenities.length >= HK_AMENITIES_MAX}
          onClick={() => {
            setDialogError(null);
            setAmenityEditing(amenityDraftOf());
          }}
        >
          Add amenity
        </Button>
      </div>

      <SectionLabel>Amenity rules</SectionLabel>
      <p className="muted">
        A rule says what goes to a room on arrival, during a stay or on departure, up to {HK_AMENITY_RULES_MAX}.
        Dispatches are planned from a rule on the Amenities tab of Housekeeping.
      </p>
      {rules.map((r) => (
        <div className="ui-row" key={r.ruleId} data-testid="hk-amenity-rule-row">
          <span>
            <strong>{r.name}</strong> · {AMENITY_WHEN_WORD[r.when]} ·{' '}
            {r.lines.map((l) => `${nameOf(l.amenityId)} ${l.quantity}`).join(', ')} · {r.active ? 'On' : 'Off'}
          </span>
          <Button
            type="button"
            intent="ghost"
            aria-label={`Edit rule ${r.name}`}
            onClick={() => {
              setDialogError(null);
              setRuleEditing(ruleDraftOf(r));
            }}
          >
            Edit
          </Button>
          <Button
            type="button"
            intent="ghost"
            aria-label={`${r.active ? 'Turn off' : 'Turn on'} rule ${r.name}`}
            disabled={saveRule.isPending}
            onClick={() =>
              saveRule.mutate({
                draft: { ...ruleDraftOf(r), active: !r.active },
                words: r.active ? 'turned off' : 'turned on',
                fromEditor: false,
              })
            }
          >
            {r.active ? 'Turn off' : 'Turn on'}
          </Button>
        </div>
      ))}
      {query.isSuccess && rules.length === 0 ? <p className="muted">No rules yet.</p> : null}
      <div>
        <Button
          type="button"
          disabled={rules.length >= HK_AMENITY_RULES_MAX || amenities.filter((a) => a.active).length === 0}
          onClick={() => {
            setDialogError(null);
            setRuleEditing(ruleDraftOf());
          }}
        >
          Add rule
        </Button>
      </div>

      {amenityEditing ? (
        <Dialog
          open
          title={amenityEditing.amenityId ? 'Edit amenity' : 'New amenity'}
          onClose={() => setAmenityEditing(null)}
          footer={
            <>
              <Button type="button" onClick={() => setAmenityEditing(null)}>
                Cancel
              </Button>
              <Button
                intent="primary"
                disabled={
                  saveAmenity.isPending ||
                  !amenityEditing.name.trim() ||
                  !amenityEditing.unit.trim() ||
                  quantityOf(amenityEditing.standardQuantity) === null
                }
                onClick={() => saveAmenity.mutate({ draft: amenityEditing, words: amenityEditing.amenityId ? 'saved' : 'added', fromEditor: true })}
              >
                Save amenity
              </Button>
            </>
          }
        >
          <form className="ui-stack" data-testid="hk-amenity-form" onSubmit={(e) => e.preventDefault()}>
            {dialogError ? <Alert intent="exception">{dialogError}</Alert> : null}
            <div className="ui-row">
              <Field
                label="Amenity name"
                control={
                  <Input
                    aria-label="Amenity name"
                    value={amenityEditing.name}
                    maxLength={HK_AMENITY_NAME_MAX}
                    autoComplete="off"
                    onChange={(e) => setAmenityEditing({ ...amenityEditing, name: e.target.value })}
                  />
                }
              />
              <Field
                label="Unit"
                control={
                  <Input
                    aria-label="Amenity unit"
                    value={amenityEditing.unit}
                    maxLength={HK_AMENITY_UNIT_MAX}
                    autoComplete="off"
                    onChange={(e) => setAmenityEditing({ ...amenityEditing, unit: e.target.value })}
                  />
                }
              />
              <Field
                label="Standard quantity"
                control={
                  <Input
                    aria-label="Standard quantity"
                    value={amenityEditing.standardQuantity}
                    onChange={(e) => setAmenityEditing({ ...amenityEditing, standardQuantity: e.target.value })}
                  />
                }
              />
              <Field
                label="Stock item"
                control={
                  <NativeSelect
                    aria-label="Amenity stock item"
                    value={amenityEditing.inventoryItemId}
                    onChange={(e) => setAmenityEditing({ ...amenityEditing, inventoryItemId: e.target.value })}
                  >
                    <option value="">Stock not tracked</option>
                    {stockList.map((i) => (
                      <option key={i.itemId} value={i.itemId}>
                        {i.name}
                      </option>
                    ))}
                  </NativeSelect>
                }
              />
              <Field
                label="Active"
                control={
                  <Checkbox
                    aria-label="Amenity active"
                    checked={amenityEditing.active}
                    onChange={(e) => setAmenityEditing({ ...amenityEditing, active: e.target.checked })}
                  />
                }
              />
            </div>
          </form>
        </Dialog>
      ) : null}

      {ruleEditing ? (
        <RuleEditorDialog
          draft={ruleEditing}
          onChange={setRuleEditing}
          amenities={amenities.filter((a) => a.active)}
          roomTypes={(roomTypes.data?.roomTypes ?? []).filter((t) => t.status === 'active')}
          busy={saveRule.isPending}
          error={dialogError}
          onClose={() => setRuleEditing(null)}
          onSave={() => saveRule.mutate({ draft: ruleEditing, words: ruleEditing.ruleId ? 'saved' : 'added', fromEditor: true })}
        />
      ) : null}
    </div>
  );
}

function RuleEditorDialog({
  draft,
  onChange,
  amenities,
  roomTypes,
  busy,
  error,
  onClose,
  onSave,
}: {
  draft: RuleDraft;
  onChange: (next: RuleDraft) => void;
  amenities: AmenityRow[];
  roomTypes: Array<{ roomTypeId: string; name: string }>;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const setLine = (index: number, patch: Partial<RuleDraft['lines'][number]>) =>
    onChange({ ...draft, lines: draft.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) });
  const ids = draft.lines.map((l) => l.amenityId);
  const problem = !draft.name.trim()
    ? 'Give the rule a name.'
    : draft.lines.length === 0
      ? 'Add at least one amenity.'
      : draft.lines.some((l) => !l.amenityId)
        ? 'Pick an amenity on every line.'
        : new Set(ids).size !== ids.length
          ? 'Each amenity can appear once.'
          : draft.lines.some((l) => quantityOf(l.quantity) === null)
            ? `Quantities are whole numbers from 1 to ${HK_AMENITY_QTY_MAX}.`
            : null;

  return (
    <Dialog
      open
      wide
      title={draft.ruleId ? 'Edit amenity rule' : 'New amenity rule'}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={busy || problem !== null} onClick={onSave}>
            Save rule
          </Button>
        </>
      }
    >
      <form className="ui-stack" data-testid="hk-amenity-rule-form" onSubmit={(e) => e.preventDefault()}>
        {error ? <Alert intent="exception">{error}</Alert> : null}
        <div className="ui-row">
          <Field
            label="Rule name"
            control={
              <Input
                aria-label="Rule name"
                value={draft.name}
                maxLength={HK_AMENITY_NAME_MAX}
                autoComplete="off"
                onChange={(e) => onChange({ ...draft, name: e.target.value })}
              />
            }
          />
          <Field
            label="When"
            control={
              <NativeSelect
                aria-label="Rule when"
                value={draft.when}
                onChange={(e) => onChange({ ...draft, when: e.target.value as AmenityWhen })}
              >
                {AMENITY_WHEN.map((w) => (
                  <option key={w} value={w}>
                    {AMENITY_WHEN_WORD[w]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Room type"
            control={
              <NativeSelect
                aria-label="Rule room type"
                value={draft.roomTypeId}
                onChange={(e) => onChange({ ...draft, roomTypeId: e.target.value })}
              >
                <option value="">Every room type</option>
                {roomTypes.map((t) => (
                  <option key={t.roomTypeId} value={t.roomTypeId}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Active"
            control={
              <Checkbox
                aria-label="Rule active"
                checked={draft.active}
                onChange={(e) => onChange({ ...draft, active: e.target.checked })}
              />
            }
          />
        </div>
        <SectionLabel>What goes to the room</SectionLabel>
        {draft.lines.map((line, index) => (
          <div className="ui-row" key={index} data-testid="hk-amenity-rule-line">
            <Field
              label={`Amenity ${index + 1}`}
              control={
                <NativeSelect
                  aria-label={`Rule amenity ${index + 1}`}
                  value={line.amenityId}
                  onChange={(e) => setLine(index, { amenityId: e.target.value })}
                >
                  <option value="">Pick an amenity</option>
                  {amenities.map((a) => (
                    <option key={a.amenityId} value={a.amenityId}>
                      {a.name} ({a.unit})
                    </option>
                  ))}
                </NativeSelect>
              }
            />
            <Field
              label={`Quantity ${index + 1}`}
              control={
                <Input
                  aria-label={`Rule quantity ${index + 1}`}
                  value={line.quantity}
                  onChange={(e) => setLine(index, { quantity: e.target.value })}
                />
              }
            />
            <Button
              type="button"
              intent="ghost"
              aria-label={`Remove rule line ${index + 1}`}
              onClick={() => onChange({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })}
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            disabled={draft.lines.length >= HK_AMENITY_RULE_LINES_MAX}
            onClick={() => onChange({ ...draft, lines: [...draft.lines, { amenityId: '', quantity: '1' }] })}
          >
            Add amenity line
          </Button>
        </div>
        {problem ? <p className="muted">{problem}</p> : null}
      </form>
    </Dialog>
  );
}
