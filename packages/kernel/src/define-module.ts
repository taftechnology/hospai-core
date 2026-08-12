import { z } from 'zod';
import type { ModuleManifest } from '@hospai/contracts';

export const ModuleManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  entitlement: z.string().min(1),
  requires: z.array(z.string()).default([]),
  schema: z.object({
    prefix: z.string().nullable().optional(),
    tables: z.array(z.string()),
  }),
  writes: z.array(z.string()),
  publishes: z.array(z.string()).default([]),
  subscribes: z.array(z.object({ event: z.string(), handler: z.string() })).default([]),
  permissions: z.array(z.string()).default([]),
  meters: z.array(z.string()).default([]),
  lifecycle: z
    .object({
      onActivate: z.string().optional(),
      onDeactivate: z.string().optional(),
      onPurge: z.string().optional(),
    })
    .optional(),
});

export function defineModule(mod: ModuleManifest): ModuleManifest {
  return ModuleManifestSchema.parse(mod);
}
