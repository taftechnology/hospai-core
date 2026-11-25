/**
 * Point-in-time recovery port (restore drill, spec 2026-11-25 §9). Cloudflare's PITR API exists only on
 * deployed Durable Objects; local workerd has none. `PropertyDO` therefore reaches it through this
 * interface: the real `ctx.storage` in production, a recording fake in tests (installed through the
 * unsafe-local test hook on `PropertyDO`, never in a production path).
 */
export interface PitrPort {
  /** The bookmark for "now". */
  getCurrentBookmark(): Promise<string>;
  /** The bookmark for an instant, epoch ms. Rejects outside the 30-day window. */
  getBookmarkForTime(timeMs: number): Promise<string>;
  /** Arms the restore for the object's next start. Resolves with the bookmark that undoes it. */
  onNextSessionRestoreBookmark(bookmark: string): Promise<string>;
  /** Forcibly restarts the object, which applies an armed restore. */
  abort(): void;
}

/** The slice of `DurableObjectState` the real port uses. */
type PitrCtx = {
  storage: {
    getCurrentBookmark(): Promise<string>;
    getBookmarkForTime(timestamp: number | Date): Promise<string>;
    onNextSessionRestoreBookmark(bookmark: string): Promise<string>;
  };
  abort(reason?: string): void;
};

export function realPitrPort(ctx: PitrCtx): PitrPort {
  return {
    getCurrentBookmark: () => ctx.storage.getCurrentBookmark(),
    getBookmarkForTime: (timeMs) => ctx.storage.getBookmarkForTime(timeMs),
    onNextSessionRestoreBookmark: (bookmark) => ctx.storage.onNextSessionRestoreBookmark(bookmark),
    abort: () => ctx.abort('property_restore'),
  };
}

/** Delay between the `prepareRestore` reply and `abort()`, so the reply is on its way before the restart. */
export const RESTORE_ABORT_DELAY_MS = 50;
