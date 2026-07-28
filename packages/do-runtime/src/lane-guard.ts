export const DEFAULT_QUIET_MS = 250;
export const DEFAULT_MAX_CHUNK_MS = 50;

export type LaneGuardOptions = {
  quietMs?: number;
  maxChunkMs?: number;
  now?: () => number;
};

export class LaneGuard {
  private lastInteractiveAt = 0;
  private readonly quietMs: number;
  private readonly maxChunkMs: number;
  private readonly now: () => number;

  constructor(opts?: LaneGuardOptions) {
    this.quietMs = opts?.quietMs ?? DEFAULT_QUIET_MS;
    this.maxChunkMs = opts?.maxChunkMs ?? DEFAULT_MAX_CHUNK_MS;
    this.now = opts?.now ?? (() => Date.now());
  }

  /** Call at the start of every INTERACTIVE command (before mutation). */
  touchInteractive(at?: number): void {
    this.lastInteractiveAt = at ?? this.now();
  }

  /** True when BACKGROUND work may start. */
  admitBackground(at?: number): boolean {
    return this.msUntilBackgroundAdmitted(at) === 0;
  }

  /** Ms until BACKGROUND admission; 0 when already admissible. */
  msUntilBackgroundAdmitted(at?: number): number {
    const t = at ?? this.now();
    const elapsed = t - this.lastInteractiveAt;
    if (elapsed >= this.quietMs) return 0;
    return this.quietMs - elapsed;
  }

  /** Deadline for a BULK chunk, or null when inside the quiet window. */
  bulkDeadline(at?: number): number | null {
    const t = at ?? this.now();
    if (!this.admitBackground(t)) return null;
    return t + this.maxChunkMs;
  }
}
