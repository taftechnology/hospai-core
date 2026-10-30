import type { MaintenanceTaskTypeRow, ModuleTxnCtx } from '@hospai/contracts';
import { MAINTENANCE_TASK_TYPES_MAX } from '@hospai/contracts';
import { MaintenanceLimitExceededError, MaintenanceValidationError } from '../domain/errors.js';
import {
  requireCategory,
  requireChecklistStrings,
  requirePriority,
  requireTaskTypeId,
  requireTaskTypeName,
} from '../domain/validation.js';
import { emitTaskTypeChanged, loadTaskType } from './shared.js';

export type CreateTaskTypeInput = {
  taskTypeId: string;
  name: unknown;
  category: unknown;
  defaultPriority: unknown;
  checklist: unknown;
};

export function createTaskType(
  ctx: ModuleTxnCtx,
  input: CreateTaskTypeInput,
): { ok: true; taskType: MaintenanceTaskTypeRow } {
  const taskTypeId = requireTaskTypeId(input.taskTypeId);
  if (loadTaskType(ctx, taskTypeId)) throw new MaintenanceValidationError();

  const count = ctx.sql
    .exec(`SELECT COUNT(*) AS n FROM maintenance_task_type`)
    .toArray() as Array<{ n: number }>;
  if ((count[0]?.n ?? 0) >= MAINTENANCE_TASK_TYPES_MAX) {
    throw new MaintenanceLimitExceededError();
  }

  const name = requireTaskTypeName(input.name);
  const category = requireCategory(input.category);
  const defaultPriority = requirePriority(input.defaultPriority);
  const checklist = requireChecklistStrings(input.checklist);
  const checklistJson = JSON.stringify(checklist);
  const now = Date.now();

  ctx.sql.exec(
    `INSERT INTO maintenance_task_type
     (task_type_id, name, category, default_priority, checklist, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    taskTypeId,
    name,
    category,
    defaultPriority,
    checklistJson,
    now,
    now,
  );

  emitTaskTypeChanged(ctx, taskTypeId);
  const row = loadTaskType(ctx, taskTypeId)!;
  return {
    ok: true,
    taskType: {
      taskTypeId: row.task_type_id,
      name: row.name,
      category: row.category as MaintenanceTaskTypeRow['category'],
      defaultPriority: row.default_priority as MaintenanceTaskTypeRow['defaultPriority'],
      checklist: JSON.parse(row.checklist) as string[],
      active: row.active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}
