import { permissionForForbidden } from '@hospai/client-core';
import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';
import { asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';

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
  return classifiedUserMessage(c, { fallback });
}

/**
 * useMutation whose onError path classifies folio mutation failures.
 * Forbidden → invalidate `['me', propertyId]` (spec §2.6).
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
  const queryClient = useQueryClient();
  const propertyId = tenant.propertyId;
  return useMutation<TData, unknown, TVariables>({
    mutationFn,
    onSuccess,
    onError: (err) => {
      if (onLocalError?.(err)) return;
      if (asClassified(err).class === 'forbidden') {
        void queryClient.invalidateQueries({ queryKey: ['me', propertyId] });
      }
      setMessage(messageForFolioMutationError(err, fallback));
    },
  });
}
