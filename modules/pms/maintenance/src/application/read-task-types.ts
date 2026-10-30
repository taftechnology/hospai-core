import type { MaintenanceTaskTypeRow, ModuleSql } from '@hospai/contracts';

export function readMaintenanceTaskTypes(sql: ModuleSql): { taskTypes: MaintenanceTaskTypeRow[] } {
  const rows = sql
    .exec(
      `SELECT * FROM maintenance_task_type ORDER BY name ASC`,
    )
    .toArray() as Array<{
    task_type_id: string;
    name: string;
    category: string;
    default_priority: string;
    checklist: string;
    active: number;
    created_at: number;
    updated_at: number;
  }>;

  return {
    taskTypes: rows.map((row) => ({
      taskTypeId: row.task_type_id,
      name: row.name,
      category: row.category as MaintenanceTaskTypeRow['category'],
      defaultPriority: row.default_priority as MaintenanceTaskTypeRow['defaultPriority'],
      checklist: JSON.parse(row.checklist) as string[],
      active: row.active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}
