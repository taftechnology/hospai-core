import type { HousekeepingTaskStage, ModuleSql } from '@hospai/contracts';

/** Appends one row of the task's stage history. Callers run it inside the move's transaction. */
export function appendTaskStage(
  sql: ModuleSql,
  input: { taskId: string; stage: HousekeepingTaskStage; actor: string; note?: string | null; at: number },
): void {
  sql.exec(
    `INSERT INTO housekeeping_task_stage (stage_id, task_id, stage, at, actor, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    `hts_${crypto.randomUUID()}`,
    input.taskId,
    input.stage,
    input.at,
    input.actor,
    input.note ?? null,
  );
}
