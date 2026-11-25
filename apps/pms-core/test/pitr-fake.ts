import type { PitrPort } from '../src/pitr-port.js';

/** A `PitrPort` that records its calls, plus the hook a test uses to stand in for a restart. */
export type RecordingPitrPort = PitrPort & {
  readonly calls: string[];
  /** Runs inside `abort`, where a real restart would apply the restore and clear the DO's in-memory state. */
  onAbort: (() => void) | null;
};

/**
 * Test double for `PitrPort` (PITR does not run in local workerd). Records every call in order. `abort`
 * restarts nothing; `onAbort` lets a test do what a restart would.
 */
export function makeRecordingPitrPort(opts: {
  /** Make `getBookmarkForTime` reject (an instant outside the real window). */
  failBookmarkForTime?: boolean;
} = {}): RecordingPitrPort {
  let seq = 0;
  const port: RecordingPitrPort = {
    calls: [],
    onAbort: null,
    async getCurrentBookmark() {
      port.calls.push('getCurrentBookmark');
      return `fake-current-${seq}`;
    },
    async getBookmarkForTime(timeMs: number) {
      port.calls.push(`getBookmarkForTime:${timeMs}`);
      if (opts.failBookmarkForTime) throw new Error('fake: time outside PITR window');
      return `fake-bookmark-${timeMs}`;
    },
    async onNextSessionRestoreBookmark(bookmark: string) {
      port.calls.push(`onNextSessionRestoreBookmark:${bookmark}`);
      seq += 1;
      return `fake-undo-${seq}-of-${bookmark}`;
    },
    abort() {
      port.calls.push('abort');
      port.onAbort?.();
    },
  };
  return port;
}
