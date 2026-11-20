import type {
  HousekeepingTaskStageList,
  InspectionAnswer,
  InspectionList,
  InspectionListRow,
  InspectionResult,
  ModuleSql,
} from '@hospai/contracts';
import { HK_INSPECTIONS_LIST_MAX, HK_TASK_STAGES_MAX } from '@hospai/contracts';
import { HousekeepingTaskNotFoundError } from '../domain/errors.js';
import { loadTask } from './task-row.js';

type InspectionDbRow = {
  inspection_id: string;
  business_date: string;
  room_id: string;
  room_code: string;
  task_id: string | null;
  template_id: string;
  template_name: string;
  pass_threshold: number;
  inspector_ref: string;
  attendant_ref: string | null;
  answers_json: string;
  remarks: string | null;
  score_percent: number;
  result: string;
  created_at: number;
  created_by: string;
};

const COLS = `i.inspection_id, i.business_date, i.room_id, m.code AS room_code, i.task_id, i.template_id,
  i.template_name, i.pass_threshold, i.inspector_ref, i.attendant_ref, i.answers_json, i.remarks,
  i.score_percent, i.result, i.created_at, i.created_by`;
const FROM = 'housekeeping_inspection i JOIN room m ON m.room_id = i.room_id';

function mapInspection(r: InspectionDbRow): InspectionListRow {
  return {
    inspectionId: r.inspection_id,
    businessDate: r.business_date,
    roomId: r.room_id,
    roomCode: r.room_code,
    taskId: r.task_id,
    templateId: r.template_id,
    templateName: r.template_name,
    inspectorRef: r.inspector_ref,
    attendantRef: r.attendant_ref,
    answers: JSON.parse(r.answers_json) as InspectionAnswer[],
    remarks: r.remarks,
    scorePercent: Number(r.score_percent),
    result: r.result as InspectionResult,
    passThreshold: Number(r.pass_threshold),
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

export function loadInspection(sql: ModuleSql, inspectionId: string): InspectionListRow | null {
  const rows = sql
    .exec(`SELECT ${COLS} FROM ${FROM} WHERE i.inspection_id = ?`, inspectionId)
    .toArray() as InspectionDbRow[];
  return rows[0] ? mapInspection(rows[0]) : null;
}

export type ReadInspectionsFilters = {
  from?: string;
  to?: string;
  roomId?: string;
  result?: string;
  inspectorRef?: string;
  taskId?: string;
};

export function readInspections(sql: ModuleSql, filters: ReadInspectionsFilters): InspectionList {
  const where: string[] = ['1 = 1'];
  const binds: unknown[] = [];
  const add = (clause: string, value: string | undefined) => {
    if (value) {
      where.push(clause);
      binds.push(value);
    }
  };
  add('i.business_date >= ?', filters.from);
  add('i.business_date <= ?', filters.to);
  add('i.room_id = ?', filters.roomId);
  add('i.result = ?', filters.result);
  add('i.inspector_ref = ?', filters.inspectorRef);
  add('i.task_id = ?', filters.taskId);
  const rows = sql
    .exec(
      `SELECT ${COLS} FROM ${FROM} WHERE ${where.join(' AND ')}
       ORDER BY i.business_date DESC, i.created_at DESC, i.inspection_id LIMIT ?`,
      ...binds,
      HK_INSPECTIONS_LIST_MAX + 1,
    )
    .toArray() as InspectionDbRow[];
  return {
    ok: true,
    inspections: rows.slice(0, HK_INSPECTIONS_LIST_MAX).map(mapInspection),
    truncated: rows.length > HK_INSPECTIONS_LIST_MAX,
  };
}

export function readTaskStages(sql: ModuleSql, taskId: string): HousekeepingTaskStageList {
  if (!loadTask(sql, taskId)) throw new HousekeepingTaskNotFoundError();
  const rows = sql
    .exec(
      `SELECT stage_id, task_id, stage, at, actor, note FROM housekeeping_task_stage
       WHERE task_id = ? ORDER BY at, rowid LIMIT ?`,
      taskId,
      HK_TASK_STAGES_MAX,
    )
    .toArray() as Array<{
    stage_id: string;
    task_id: string;
    stage: string;
    at: number;
    actor: string;
    note: string | null;
  }>;
  return {
    ok: true,
    taskId,
    stages: rows.map((r) => ({
      stageId: r.stage_id,
      taskId: r.task_id,
      stage: r.stage as HousekeepingTaskStageList['stages'][number]['stage'],
      at: r.at,
      actor: r.actor,
      note: r.note,
    })),
  };
}
