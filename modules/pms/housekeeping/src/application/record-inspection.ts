import type {
  InspectionAnswer,
  InspectionAnswerInput,
  InspectionListRow,
  ModuleTxnCtx,
} from '@hospai/contracts';
import {
  HK_INSPECTION_DEFECT_MAX,
  HK_INSPECTION_ITEMS_MAX,
  HK_INSPECTION_REMARKS_MAX,
  isInspectionItemResult,
  scoreInspection,
} from '@hospai/contracts';
import {
  HousekeepingInvalidRequestError,
  HousekeepingLimitError,
  HousekeepingRecordNotFoundError,
  HousekeepingTaskNotFoundError,
  InvalidAssigneeRefError,
  isStaffRef,
} from '../domain/errors.js';
import { optionalText } from '../domain/task.js';
import { loadInspection } from './read-inspections.js';
import { loadTemplate } from './inspection-template.js';
import { assertActiveRoom, BUSINESS_DATE_RE } from './stay-link.js';
import { appendTaskStage } from './task-stage.js';
import { loadTask } from './task-row.js';

export type RecordInspectionInput = {
  businessDate: string;
  roomId: string;
  taskId?: string | null;
  templateId: string;
  inspectorRef: string;
  attendantRef?: string | null;
  answers: InspectionAnswerInput[];
  remarks?: string | null;
  actorRef: string;
};

export function recordInspection(
  ctx: ModuleTxnCtx,
  input: RecordInspectionInput,
): { ok: true; inspection: InspectionListRow } {
  if (typeof input.businessDate !== 'string' || !BUSINESS_DATE_RE.test(input.businessDate)) {
    throw new HousekeepingInvalidRequestError();
  }
  const roomId = assertActiveRoom(ctx.sql, input.roomId);
  if (!isStaffRef(input.inspectorRef)) throw new InvalidAssigneeRefError();
  if (input.attendantRef !== undefined && input.attendantRef !== null && !isStaffRef(input.attendantRef)) {
    throw new InvalidAssigneeRefError();
  }
  const remarks = optionalText(input.remarks, HK_INSPECTION_REMARKS_MAX) ?? null;

  if (typeof input.templateId !== 'string' || !input.templateId) throw new HousekeepingInvalidRequestError();
  const template = loadTemplate(ctx.sql, input.templateId);
  if (!template) throw new HousekeepingRecordNotFoundError();
  // Recording needs an active template; a deactivated one only keeps its history.
  if (!template.active) throw new HousekeepingInvalidRequestError();

  if (!Array.isArray(input.answers)) throw new HousekeepingInvalidRequestError();
  if (input.answers.length > HK_INSPECTION_ITEMS_MAX) throw new HousekeepingLimitError();
  const byItem = new Map<string, InspectionAnswerInput>();
  for (const a of input.answers) {
    if (!a || typeof a.itemId !== 'string' || !isInspectionItemResult(a.result) || byItem.has(a.itemId)) {
      throw new HousekeepingInvalidRequestError();
    }
    byItem.set(a.itemId, a);
  }
  // Every template item needs an answer, and only template items may be answered.
  if (byItem.size !== template.items.length) throw new HousekeepingInvalidRequestError();
  const answers: InspectionAnswer[] = template.items.map((item) => {
    const a = byItem.get(item.itemId);
    if (!a) throw new HousekeepingInvalidRequestError();
    return {
      section: item.section,
      label: item.label,
      weight: item.weight,
      mandatory: item.mandatory,
      result: a.result,
      defectNote: optionalText(a.defectNote, HK_INSPECTION_DEFECT_MAX) ?? null,
    };
  });

  let taskId: string | null = null;
  let stampTask = false;
  if (input.taskId !== undefined && input.taskId !== null) {
    if (typeof input.taskId !== 'string' || !input.taskId) throw new HousekeepingInvalidRequestError();
    const task = loadTask(ctx.sql, input.taskId);
    if (!task) throw new HousekeepingTaskNotFoundError();
    if (task.room_id !== roomId) throw new HousekeepingInvalidRequestError();
    taskId = task.task_id;
    stampTask = task.status === 'completed' || task.status === 'reviewed';
  }

  const { scorePercent, result } = scoreInspection(answers, template.passThreshold);
  const inspectionId = `insp_${crypto.randomUUID()}`;
  const now = Date.now();
  ctx.sql.exec(
    `INSERT INTO housekeeping_inspection (
       inspection_id, business_date, room_id, task_id, template_id, template_name, pass_threshold,
       inspector_ref, attendant_ref, answers_json, remarks, score_percent, result, created_at, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    inspectionId,
    input.businessDate,
    roomId,
    taskId,
    template.templateId,
    template.name,
    template.passThreshold,
    input.inspectorRef,
    input.attendantRef ?? null,
    JSON.stringify(answers),
    remarks,
    scorePercent,
    result,
    now,
    input.actorRef,
  );
  if (taskId && stampTask) {
    ctx.sql.exec(
      `UPDATE housekeeping_task SET latest_inspection_id = ?, latest_inspection_result = ?, updated_at = ?
       WHERE task_id = ?`,
      inspectionId,
      result,
      now,
      taskId,
    );
    appendTaskStage(ctx.sql, {
      taskId,
      stage: 'inspected',
      actor: input.actorRef,
      note: `${result === 'pass' ? 'Passed' : 'Failed'} at ${scorePercent} percent`,
      at: now,
    });
  }
  return { ok: true as const, inspection: loadInspection(ctx.sql, inspectionId)! };
}
