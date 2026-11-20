import type { HousekeepingCaseListRow, ModuleTxnCtx } from '@hospai/contracts';
import { isHousekeepingCaseReturned } from '@hospai/contracts';
import { caseDetail, caseItem, requiredClosureNote } from '../domain/case.js';
import {
  HousekeepingInvalidRequestError,
  HousekeepingInvalidTaskTransitionError,
  HousekeepingRecordNotFoundError,
} from '../domain/errors.js';
import { loadCase, mapCaseRow } from './case-row.js';

export type UpdateCaseInput = {
  caseId: string;
  item?: string;
  inspectionDetail?: string | null;
  returnedStatus?: string;
  /** `close` ends the case and needs a closure note. */
  action?: 'close';
  closureNote?: string;
  actorRef: string;
};

export function updateCase(
  ctx: ModuleTxnCtx,
  input: UpdateCaseInput,
): { ok: true; case: HousekeepingCaseListRow; before: HousekeepingCaseListRow } {
  const current = loadCase(ctx.sql, input.caseId);
  if (!current) throw new HousekeepingRecordNotFoundError();
  // Edit and close are only for an open case.
  if (current.status !== 'open') throw new HousekeepingInvalidTaskTransitionError();
  const before = mapCaseRow(current);
  const now = Date.now();

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (input.item !== undefined) {
    sets.push('item = ?');
    binds.push(caseItem(input.item));
  }
  if (input.inspectionDetail !== undefined) {
    sets.push('inspection_detail = ?');
    binds.push(caseDetail(input.inspectionDetail) ?? null);
  }
  if (input.returnedStatus !== undefined) {
    if (!isHousekeepingCaseReturned(input.returnedStatus)) throw new HousekeepingInvalidRequestError();
    sets.push('returned_status = ?');
    binds.push(input.returnedStatus);
  }
  if (input.action !== undefined) {
    if (input.action !== 'close') throw new HousekeepingInvalidRequestError();
    sets.push('status = ?', 'closure_note = ?', 'closed_at = ?', 'closed_by = ?');
    binds.push('closed', requiredClosureNote(input.closureNote), now, input.actorRef);
  }
  if (sets.length === 0) throw new HousekeepingInvalidRequestError();

  sets.push('updated_at = ?');
  binds.push(now);
  ctx.sql.exec(`UPDATE housekeeping_case SET ${sets.join(', ')} WHERE case_id = ?`, ...binds, input.caseId);
  return { ok: true as const, case: mapCaseRow(loadCase(ctx.sql, input.caseId)!), before };
}
