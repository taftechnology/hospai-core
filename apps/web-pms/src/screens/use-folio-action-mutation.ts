import { permissionForForbidden } from '@hospai/client-core';
import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';
import { asClassified } from '../client.js';

export function messageForFolioMutationError(err: unknown, fallback: string): string {
  const c = asClassified(err);
  if (c.class === 'forbidden') {
    const perm = permissionForForbidden(c.body);
    return perm
      ? `Requires permission ${perm}. Ask a manager.`
      : 'Forbidden — insufficient permission.';
  }
  if (c.class === 'not_configured') {
    return 'Card payments are not configured for this property.';
  }
  if (c.class === 'idempotency_key_reused') {
    return 'An earlier submission of this form already posted; refresh the folio to see it.';
  }
  if (c.class === 'fail_closed') {
    return 'Property unreachable.';
  }
  if (c.class === 'queue_unavailable') {
    return 'Could not queue — queue unavailable.';
  }
  return `${fallback} (${c.class})`;
}

/**
 * useMutation whose onError path classifies folio mutation failures.
 */
export function useFolioActionMutation<TData, TVariables = void>(opts: {
  fallback: string;
  setMessage: (message: string | null) => void;
  /** Return true if the error was handled locally (policy blocks, cancel, etc.). */
  onLocalError?: (err: unknown) => boolean;
  mutationFn: (variables: TVariables) => Promise<TData>;
  onSuccess?: UseMutationOptions<TData, unknown, TVariables>['onSuccess'];
}): UseMutationResult<TData, unknown, TVariables> {
  const { fallback, setMessage, onLocalError, mutationFn, onSuccess } = opts;
  return useMutation<TData, unknown, TVariables>({
    mutationFn,
    onSuccess,
    onError: (err) => {
      if (onLocalError?.(err)) return;
      setMessage(messageForFolioMutationError(err, fallback));
    },
  });
}
