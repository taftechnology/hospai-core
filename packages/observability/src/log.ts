import { logFields, type ObservabilityContext } from './context.js';

type LogPayload = Record<string, unknown> & { msg: string };

function emit(level: 'info' | 'warn' | 'error', ctx: ObservabilityContext, payload: LogPayload): void {
  console.log(JSON.stringify({ ...logFields(ctx), level, ...payload }));
}

export function logInfo(ctx: ObservabilityContext, payload: LogPayload): void {
  emit('info', ctx, payload);
}

export function logWarn(ctx: ObservabilityContext, payload: LogPayload): void {
  emit('warn', ctx, payload);
}

export function logError(ctx: ObservabilityContext, payload: LogPayload): void {
  emit('error', ctx, payload);
}

/** Parse JSON log lines emitted by this package (for tests). */
export function parseLogLine(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}
