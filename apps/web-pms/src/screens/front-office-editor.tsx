import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, tenant } from '../client.js';

const COMMENT_MAX = 2000;

export function FrontOfficeEditor({
  reservationId,
  frontOfficeComment,
  vipFlag,
  dndFlag,
  disabled,
}: {
  reservationId: string;
  frontOfficeComment?: string | null;
  vipFlag?: boolean;
  dndFlag?: boolean;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const propertyId = tenant.propertyId;
  const [comment, setComment] = useState(frontOfficeComment ?? '');
  const [vip, setVip] = useState(Boolean(vipFlag));
  const [dnd, setDnd] = useState(Boolean(dndFlag));
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setComment(frontOfficeComment ?? '');
    setVip(Boolean(vipFlag));
    setDnd(Boolean(dndFlag));
  }, [frontOfficeComment, vipFlag, dndFlag]);

  const tooLong = comment.length > COMMENT_MAX;
  const save = useMutation({
    mutationFn: () =>
      api.updateFrontOffice(
        propertyId,
        reservationId,
        `front-office:${reservationId}:${crypto.randomUUID()}`,
        {
          frontOfficeComment: comment.trim(),
          vipFlag: vip,
          dndFlag: dnd,
        },
      ),
    onSuccess: () => {
      setMessage('Front office saved.');
      void queryClient.invalidateQueries({
        queryKey: ['reservation', propertyId, reservationId],
      });
    },
    onError: () => setMessage('Front-office update failed.'),
  });

  const saveDisabled = Boolean(disabled) || tooLong || save.isPending;

  return (
    <section className="stack" data-testid="front-office-editor">
      <h2>Front office</h2>
      <label>
        Comment{' '}
        <textarea
          data-testid="front-office-comment"
          value={comment}
          disabled={disabled}
          onChange={(e) => setComment(e.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          data-testid="vip-flag"
          checked={vip}
          disabled={disabled}
          onChange={(e) => setVip(e.target.checked)}
        />{' '}
        VIP
      </label>
      <label>
        <input
          type="checkbox"
          data-testid="dnd-flag"
          checked={dnd}
          disabled={disabled}
          onChange={(e) => setDnd(e.target.checked)}
        />{' '}
        DND
      </label>
      <button
        type="button"
        data-testid="front-office-save"
        disabled={saveDisabled}
        onClick={() => save.mutate()}
      >
        Save
      </button>
      {tooLong ? (
        <p className="error" role="alert">
          Comment must be 2000 characters or fewer.
        </p>
      ) : null}
      {message ? <p className="muted">{message}</p> : null}
    </section>
  );
}
