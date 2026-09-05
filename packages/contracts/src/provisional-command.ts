/** Queue message body — tier 1 (edge) and tier 2 (client, future) converge here. */
export type ProvisionalCommand = {
  /** Client-generated, stable across retries. Same store as live idempotency (§10.1). */
  idempotencyKey: string;
  requestFingerprint: string;
  propertyId: string;
  orgId: string;
  /** ISO-8601 instant — captured at operator action time (edge acceptance), NEVER replay time. */
  issuedAt: string;
  /** YYYY-MM-DD — business date the operator believed was open when they acted. */
  businessDate: string;
  actor: {
    /** Authenticated user at admission time — audit anchor; replay permission re-checks userId. */
    userId: string;
  };
  command: {
    /** Catalog command id, e.g. `reservations.check_in`. */
    type: string;
    payload: unknown;
  };
  /** HTTP route audit id — telemetry only. */
  routeId: string;
};

export type PendingCommandMessage = {
  v: 1;
  provisional: ProvisionalCommand;
  enqueuedAt: string;
};

/** Passed to eligible PropertyDO try* methods on replay — omitted on live HTTP paths. */
export type ProvisionalContext = {
  issuedAt: string;
  businessDate: string;
  /** Admission-time operator — audit rows via auditUserId; replay permission re-checks actor.userId. */
  auditUserId?: string;
};

export type ProvisionalExceptionRow = {
  exceptionId: string;
  idempotencyKey: string;
  commandType: string;
  payload: unknown;
  issuedAt: string;
  businessDate: string;
  reason: string;
  detail: unknown | null;
  createdAt: number;
  /** Null on open rows. List/count default to unresolved (`resolved_at IS NULL`). */
  resolvedAt?: number | null;
  resolvedBy?: string | null;
  assignedTo?: string | null;
  assignedAt?: number | null;
  assignedBy?: string | null;
  openRetryKey?: string | null;
};
