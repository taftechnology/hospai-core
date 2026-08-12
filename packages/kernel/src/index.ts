import { z } from 'zod';
import { getConfigEntry } from '@hospai/contracts';

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

/** Config entries are declared in `@hospai/contracts` CONFIG_REGISTER — not via defineConfig. */
export function validateConfigWrite(key: string, value: unknown): unknown {
  const entry = getConfigEntry(key);
  if (!entry) throw new UndeclaredConfigError(key);
  if (entry.class === 'SECRET') {
    throw new SecretConfigRejectedError(key, entry.secretDestination ?? 'payments');
  }
  return entry.schema.parse(value);
}

export { defineModule, ModuleManifestSchema } from './define-module.js';
export { MODULE_REGISTRY } from './registry.js';
export { z };
