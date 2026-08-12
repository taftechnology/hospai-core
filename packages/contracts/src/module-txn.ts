import type { Sync } from './sync.js';

/** Structural — matches do-runtime SqlStorageLike without a contracts→do-runtime dep. */
export type ModuleSql = {
  exec(query: string, ...bindings: unknown[]): { toArray(): unknown[] };
};

export type ModuleOutboxEventInput = {
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

export type ModuleTxnCtx = {
  sql: ModuleSql;
  appendOutbox: (evt: ModuleOutboxEventInput) => void;
  orgId: string;
  propertyId: string;
};

export type SyncUseCase<In, Out> = (ctx: ModuleTxnCtx, input: In) => Sync<Out>;
export type SyncRead<Filters, Out> = (sql: ModuleSql, filters: Filters) => Sync<Out>;
