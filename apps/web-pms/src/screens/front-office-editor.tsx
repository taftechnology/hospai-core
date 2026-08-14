import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Field, Textarea } from '@hospai/ui-kit';
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
      <Field
        label="Comment"
        control={
          <Textarea
            data-testid="front-office-comment"
            value={comment}
            disabled={disabled}
            onChange={(e) => setComment(e.target.value)}
          />
        }
      />
      <Field
        label="VIP"
        control={
          <Checkbox
            data-testid="vip-flag"
            checked={vip}
            disabled={disabled}
            onChange={(e) => setVip(e.target.checked)}
          />
        }
      />
      <Field
        label="DND"
        control={
          <Checkbox
            data-testid="dnd-flag"
            checked={dnd}
            disabled={disabled}
            onChange={(e) => setDnd(e.target.checked)}
          />
        }
      />
      <Button
        type="button"
        intent="primary"
        data-testid="front-office-save"
        disabled={saveDisabled}
        onClick={() => save.mutate()}
      >
        Save
      </Button>
      {tooLong ? <Alert>Comment must be 2000 characters or fewer.</Alert> : null}
      {message ? <p className="muted">{message}</p> : null}
    </section>
  );
}
