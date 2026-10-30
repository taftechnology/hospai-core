import type { MaintenanceTaskTypeRow, ModuleTxnCtx } from '@hospai/contracts';
import { MaintenanceValidationError, TaskTypeNotFoundError } from '../domain/errors.js';
import {
  requireCategory,
  requireChecklistStrings,
  requirePriority,
  requireTaskTypeId,
  requireTaskTypeName,
} from '../domain/validation.js';
import { emitTaskTypeChanged, loadTaskType } from './shared.js';

export type UpdateTaskTypeInput = {
  taskTypeId: string;
  name: unknown;
  category: unknown;
  defaultPriority: unknown;
  checklist: unknown;
  active: unknown;
};

export function updateTaskType(
  ctx: ModuleTxnCtx,
  input: UpdateTaskTypeInput,
): { ok: true; taskType: MaintenanceTaskTypeRow; before: MaintenanceTaskTypeRow } {
  const taskTypeId = requireTaskTypeId(input.taskTypeId);
  const existing = loadTaskType(ctx, taskTypeId);
  if (!existing) throw new TaskTypeNotFoundError();

  const before: MaintenanceTaskTypeRow = {
    taskTypeId: existing.task_type_id,
    name: existing.name,
    category: existing.category as MaintenanceTaskTypeRow['category'],
    defaultPriority: existing.default_priority as MaintenanceTaskTypeRow['defaultPriority'],
    checklist: JSON.parse(existing.checklist) as string[],
    active: existing.active === 1,
    createdAt: existing.created_at,
    updatedAt: existing.updated_at,
  };

  const name = requireTaskTypeName(input.name);
  const category = requireCategory(input.category);
  const defaultPriority = requirePriority(input.defaultPriority);
  const checklist = requireChecklistStrings(input.checklist);
  if (typeof input.active !== 'boolean') throw new MaintenanceValidationError();
  const active = input.active ? 1 : 0;
  const now = Date.now();

  ctx.sql.exec(
    `UPDATE maintenance_task_type SET
       name = ?, category = ?, default_priority = ?, checklist = ?, active = ?, updated_at = ?
     WHERE task_type_id = ?`,
    name,
    category,
    defaultPriority,
    JSON.stringify(checklist),
    active,
    now,
    taskTypeId,
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
    before,
  };
}
