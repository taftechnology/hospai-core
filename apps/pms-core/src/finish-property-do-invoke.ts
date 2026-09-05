import type { CommandError, FeatureKey, Permission } from '@hospai/contracts';
import { commandFailureResponse } from './command-error-http.js';

function json(data: unknown, status: number, headers?: HeadersInit): Response {
  return Response.json(data, { status, headers });
}

type FinishPropertyDoOpts<T extends { ok: boolean }> = {
  invoked: { kind: 'response'; response: Response } | { kind: 'ok'; result: T };
  permission: Permission;
  feature?: FeatureKey;
  successStatus?: number;
  headers?: HeadersInit;
  onFailure?: (result: Extract<T, { ok: false }>) => Response | null;
};

export function finishPropertyDoInvoke<T extends { ok: boolean }>(
  opts: FinishPropertyDoOpts<T>,
): Response {
  if (opts.invoked.kind === 'response') return opts.invoked.response;
  const result = opts.invoked.result;
  if (result.ok) return json(result, opts.successStatus ?? 200, opts.headers);
  const custom = opts.onFailure?.(result as Extract<T, { ok: false }>);
  if (custom) return custom;
  const err = (result as unknown as { ok: false; error: CommandError }).error;
  return commandFailureResponse(err, opts.permission, {
    feature: opts.feature,
    headers: opts.headers,
  });
}
