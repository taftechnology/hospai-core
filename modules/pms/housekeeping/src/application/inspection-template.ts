import type {
  InspectionTemplate,
  InspectionTemplateItem,
  InspectionTemplateItemInput,
  InspectionTemplateList,
  ModuleSql,
  ModuleTxnCtx,
} from '@hospai/contracts';
import {
  HK_INSPECTION_DEFAULT_THRESHOLD,
  HK_INSPECTION_ITEMS_MAX,
  HK_INSPECTION_LABEL_MAX,
  HK_INSPECTION_SECTION_MAX,
  HK_INSPECTION_TEMPLATE_NAME_MAX,
  HK_INSPECTION_TEMPLATES_MAX,
  HK_INSPECTION_WEIGHT_MAX,
  HK_INSPECTION_WEIGHT_MIN,
} from '@hospai/contracts';
import {
  HousekeepingInvalidRequestError,
  HousekeepingLimitError,
  HousekeepingRecordNotFoundError,
} from '../domain/errors.js';
import { requiredText } from '../domain/lost-item.js';

type TemplateDbRow = {
  template_id: string;
  name: string;
  active: number;
  pass_threshold: number;
  created_at: number;
  updated_at: number;
};
type ItemDbRow = {
  item_id: string;
  template_id: string;
  section: string;
  label: string;
  weight: number;
  mandatory: number;
  sort_order: number;
};

const TEMPLATE_COLS = 'template_id, name, active, pass_threshold, created_at, updated_at';
const ITEM_COLS = 'item_id, template_id, section, label, weight, mandatory, sort_order';

function mapItem(r: ItemDbRow): InspectionTemplateItem {
  return {
    itemId: r.item_id,
    section: r.section,
    label: r.label,
    weight: Number(r.weight),
    mandatory: Number(r.mandatory) === 1,
    sortOrder: Number(r.sort_order),
  };
}

function mapTemplate(r: TemplateDbRow, items: ItemDbRow[]): InspectionTemplate {
  return {
    templateId: r.template_id,
    name: r.name,
    active: Number(r.active) === 1,
    passThreshold: Number(r.pass_threshold),
    items: items.map(mapItem),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function loadTemplate(sql: ModuleSql, templateId: string): InspectionTemplate | null {
  const rows = sql
    .exec(`SELECT ${TEMPLATE_COLS} FROM housekeeping_inspection_template WHERE template_id = ?`, templateId)
    .toArray() as TemplateDbRow[];
  if (!rows[0]) return null;
  const items = sql
    .exec(
      `SELECT ${ITEM_COLS} FROM housekeeping_inspection_template_item
       WHERE template_id = ? ORDER BY sort_order, item_id`,
      templateId,
    )
    .toArray() as ItemDbRow[];
  return mapTemplate(rows[0], items);
}

export function readInspectionTemplates(sql: ModuleSql): InspectionTemplateList {
  const rows = sql
    .exec(
      `SELECT ${TEMPLATE_COLS} FROM housekeeping_inspection_template ORDER BY active DESC, name, template_id LIMIT ?`,
      HK_INSPECTION_TEMPLATES_MAX,
    )
    .toArray() as TemplateDbRow[];
  const items = sql
    .exec(
      `SELECT ${ITEM_COLS} FROM housekeeping_inspection_template_item ORDER BY template_id, sort_order, item_id LIMIT ?`,
      HK_INSPECTION_TEMPLATES_MAX * HK_INSPECTION_ITEMS_MAX,
    )
    .toArray() as ItemDbRow[];
  const byTemplate = new Map<string, ItemDbRow[]>();
  for (const it of items) {
    const list = byTemplate.get(it.template_id) ?? [];
    list.push(it);
    byTemplate.set(it.template_id, list);
  }
  return {
    ok: true,
    templates: rows.map((r) => mapTemplate(r, byTemplate.get(r.template_id) ?? [])),
  };
}

export type SaveInspectionTemplateInput = {
  /** Absent creates a template; present edits it (items replaced as one set). */
  templateId?: string;
  name: string;
  active?: boolean;
  passThreshold?: number;
  items: InspectionTemplateItemInput[];
};

function validateItems(raw: unknown): InspectionTemplateItemInput[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new HousekeepingInvalidRequestError();
  if (raw.length > HK_INSPECTION_ITEMS_MAX) throw new HousekeepingLimitError();
  return raw.map((r) => {
    const o = r as Partial<InspectionTemplateItemInput> | null;
    if (
      !o ||
      typeof o !== 'object' ||
      !Number.isInteger(o.weight) ||
      (o.weight as number) < HK_INSPECTION_WEIGHT_MIN ||
      (o.weight as number) > HK_INSPECTION_WEIGHT_MAX ||
      typeof o.mandatory !== 'boolean'
    ) {
      throw new HousekeepingInvalidRequestError();
    }
    return {
      section: requiredText(o.section, HK_INSPECTION_SECTION_MAX),
      label: requiredText(o.label, HK_INSPECTION_LABEL_MAX),
      weight: o.weight as number,
      mandatory: o.mandatory,
    };
  });
}

export function saveInspectionTemplate(
  ctx: ModuleTxnCtx,
  input: SaveInspectionTemplateInput,
): { ok: true; template: InspectionTemplate; before: InspectionTemplate | null } {
  const name = requiredText(input.name, HK_INSPECTION_TEMPLATE_NAME_MAX);
  const threshold = input.passThreshold ?? HK_INSPECTION_DEFAULT_THRESHOLD;
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
    throw new HousekeepingInvalidRequestError();
  }
  if (input.active !== undefined && typeof input.active !== 'boolean') {
    throw new HousekeepingInvalidRequestError();
  }
  const items = validateItems(input.items);
  const now = Date.now();

  let templateId: string;
  let before: InspectionTemplate | null = null;
  if (input.templateId === undefined) {
    const n = ctx.sql
      .exec(`SELECT COUNT(*) AS n FROM housekeeping_inspection_template`)
      .toArray() as Array<{ n: number }>;
    if (Number(n[0]?.n ?? 0) >= HK_INSPECTION_TEMPLATES_MAX) throw new HousekeepingLimitError();
    templateId = `htpl_${crypto.randomUUID()}`;
    ctx.sql.exec(
      `INSERT INTO housekeeping_inspection_template (template_id, name, active, pass_threshold, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      templateId,
      name,
      input.active === false ? 0 : 1,
      threshold,
      now,
      now,
    );
  } else {
    templateId = input.templateId;
    before = loadTemplate(ctx.sql, templateId);
    if (!before) throw new HousekeepingRecordNotFoundError();
    ctx.sql.exec(
      `UPDATE housekeeping_inspection_template SET name = ?, active = ?, pass_threshold = ?, updated_at = ?
       WHERE template_id = ?`,
      name,
      (input.active ?? before.active) ? 1 : 0,
      threshold,
      now,
      templateId,
    );
    ctx.sql.exec(`DELETE FROM housekeeping_inspection_template_item WHERE template_id = ?`, templateId);
  }
  items.forEach((item, index) => {
    ctx.sql.exec(
      `INSERT INTO housekeeping_inspection_template_item (item_id, template_id, section, label, weight, mandatory, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      `hti_${crypto.randomUUID()}`,
      templateId,
      item.section,
      item.label,
      item.weight,
      item.mandatory ? 1 : 0,
      index,
    );
  });
  return { ok: true as const, template: loadTemplate(ctx.sql, templateId)!, before };
}
