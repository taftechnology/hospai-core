import {
  HK_CASE_CLOSURE_MAX,
  HK_CASE_DETAIL_MAX,
  HK_CASE_ITEM_MAX,
} from '@hospai/contracts';
import { HousekeepingReasonRequiredError } from './errors.js';
import { optionalText } from './task.js';
import { requiredText } from './lost-item.js';

export const caseItem = (raw: unknown) => requiredText(raw, HK_CASE_ITEM_MAX);
export const caseDetail = (raw: unknown) => optionalText(raw, HK_CASE_DETAIL_MAX);

export function requiredClosureNote(raw: unknown): string {
  const text = optionalText(raw, HK_CASE_CLOSURE_MAX);
  if (!text) throw new HousekeepingReasonRequiredError();
  return text;
}
