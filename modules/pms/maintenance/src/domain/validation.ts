import {
  isMaintenanceCategory,
  isMaintenancePriority,
  maintenanceChecklistItemOverCap,
  maintenanceChecklistOverCap,
  maintenanceDescriptionOverCap,
  maintenanceResolutionNoteOverCap,
  maintenanceTaskTypeNameOverCap,
  type MaintenanceCategory,
  type MaintenancePriority,
} from '@hospai/contracts';
import { MaintenanceLimitExceededError, MaintenanceValidationError } from './errors.js';

export function requireTicketId(id: unknown): string {
  if (typeof id !== 'string' || !id.trim()) throw new MaintenanceValidationError();
  return id.trim();
}

export function requireTaskTypeId(id: unknown): string {
  if (typeof id !== 'string' || !id.trim()) throw new MaintenanceValidationError();
  return id.trim();
}

export function requireDescription(text: unknown): string {
  if (typeof text !== 'string') throw new MaintenanceValidationError();
  const trimmed = text.trim();
  if (trimmed.length < 1) throw new MaintenanceValidationError();
  if (maintenanceDescriptionOverCap(trimmed)) throw new MaintenanceLimitExceededError();
  return trimmed;
}

export function requireOptionalDescription(text: unknown): string | undefined {
  if (text === undefined) return undefined;
  if (typeof text !== 'string') throw new MaintenanceValidationError();
  const trimmed = text.trim();
  if (maintenanceDescriptionOverCap(trimmed)) throw new MaintenanceLimitExceededError();
  return trimmed;
}

export function requireResolutionNote(text: unknown): string {
  if (typeof text !== 'string') throw new MaintenanceValidationError();
  const trimmed = text.trim();
  if (trimmed.length < 1) throw new MaintenanceValidationError();
  if (maintenanceResolutionNoteOverCap(trimmed)) throw new MaintenanceLimitExceededError();
  return trimmed;
}

export function requireOptionalResolutionNote(text: unknown): string | undefined {
  if (text === undefined) return undefined;
  if (typeof text !== 'string') throw new MaintenanceValidationError();
  const trimmed = text.trim();
  if (maintenanceResolutionNoteOverCap(trimmed)) throw new MaintenanceLimitExceededError();
  return trimmed;
}

export function requireCategory(value: unknown): MaintenanceCategory {
  if (!isMaintenanceCategory(value)) throw new MaintenanceValidationError();
  return value;
}

export function requirePriority(value: unknown): MaintenancePriority {
  if (!isMaintenancePriority(value)) throw new MaintenanceValidationError();
  return value;
}

export function requireTaskTypeName(name: unknown): string {
  if (typeof name !== 'string') throw new MaintenanceValidationError();
  const trimmed = name.trim();
  if (trimmed.length < 1) throw new MaintenanceValidationError();
  if (maintenanceTaskTypeNameOverCap(trimmed)) throw new MaintenanceLimitExceededError();
  return trimmed;
}

export function requireChecklistStrings(items: unknown): string[] {
  if (!Array.isArray(items)) throw new MaintenanceValidationError();
  if (maintenanceChecklistOverCap(items)) throw new MaintenanceLimitExceededError();
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') throw new MaintenanceValidationError();
    const trimmed = item.trim();
    if (maintenanceChecklistItemOverCap(trimmed)) throw new MaintenanceLimitExceededError();
    out.push(trimmed);
  }
  return out;
}

export function requireChecklistDone(items: unknown, expectedLen: number): boolean[] {
  if (!Array.isArray(items)) throw new MaintenanceValidationError();
  if (items.length !== expectedLen) throw new MaintenanceValidationError();
  if (maintenanceChecklistOverCap(items)) throw new MaintenanceLimitExceededError();
  return items.map((v) => {
    if (typeof v !== 'boolean') throw new MaintenanceValidationError();
    return v;
  });
}
