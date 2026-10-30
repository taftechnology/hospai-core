import type { ModuleManifest, ModuleTxnCtx } from '@hospai/contracts';
import { MODULE_REGISTRY } from '@hospai/kernel';
import { onRoomOooChanged, type RoomOooChangedPayload } from '@hospai/pms-maintenance';

export type ModuleEventHandler = (ctx: ModuleTxnCtx, payload: unknown) => void;

/** Static map: manifest handler name → sync function (no dynamic import). */
export const MODULE_EVENT_HANDLERS: Record<string, ModuleEventHandler> = {
  onRoomOooChanged: (ctx, payload) => onRoomOooChanged(ctx, payload as RoomOooChangedPayload),
};

export function shouldDispatchModuleSubscribers(depth: { n: number }): boolean {
  return depth.n === 0;
}

export function subscribersForEvent(
  eventType: string,
  registry: readonly ModuleManifest[] = MODULE_REGISTRY,
): Array<{ moduleId: string; handler: string }> {
  const out: Array<{ moduleId: string; handler: string }> = [];
  for (const manifest of registry) {
    const subs = manifest.subscribes ?? [];
    for (const sub of subs) {
      if (sub.event === eventType) {
        out.push({ moduleId: manifest.id, handler: sub.handler });
      }
    }
  }
  return out;
}

export function dispatchModuleSubscribers(args: {
  depth: { n: number };
  eventType: string;
  ctx: ModuleTxnCtx;
  payload: unknown;
  handlers?: Record<string, ModuleEventHandler>;
  registry?: readonly ModuleManifest[];
}): void {
  if (args.depth.n > 0) return;

  const handlers = args.handlers ?? MODULE_EVENT_HANDLERS;
  const registry = args.registry ?? MODULE_REGISTRY;

  for (const { handler } of subscribersForEvent(args.eventType, registry)) {
    const fn = handlers[handler];
    if (!fn) throw new Error(`missing_module_handler:${handler}`);
    args.depth.n++;
    try {
      fn(args.ctx, args.payload);
    } finally {
      args.depth.n--;
    }
  }
}
