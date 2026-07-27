import { z } from 'zod';
import {
  CONFIG_REGISTER,
  type ConfigEntry,
  getConfigEntry,
} from '@hospai/contracts';

export class SecretConfigRejectedError extends Error {
  constructor(
    public readonly key: string,
    public readonly destination: string,
  ) {
    super(`SECRET config ${key} must be managed via ${destination}`);
    this.name = 'SecretConfigRejectedError';
  }
}

export class UndeclaredConfigError extends Error {
  constructor(public readonly key: string) {
    super(`Undeclared config key: ${key}`);
    this.name = 'UndeclaredConfigError';
  }
}

export function defineConfig(entry: ConfigEntry): ConfigEntry {
  const existing = getConfigEntry(entry.key);
  if (existing && existing !== entry) {
    // Allow re-export of register entries; reject conflicting duplicates at register build time.
  }
  const dupes = CONFIG_REGISTER.filter((e) => e.key === entry.key);
  if (dupes.length > 1) {
    throw new Error(`Duplicate config key in register: ${entry.key}`);
  }
  return entry;
}

export function validateConfigWrite(key: string, value: unknown): unknown {
  const entry = getConfigEntry(key);
  if (!entry) throw new UndeclaredConfigError(key);
  if (entry.class === 'SECRET') {
    throw new SecretConfigRejectedError(key, entry.secretDestination ?? 'payments');
  }
  return entry.schema.parse(value);
}

export function defineModule<T extends { id: string }>(mod: T): T {
  if (!mod.id) throw new Error('module id required');
  return mod;
}

export { z };
