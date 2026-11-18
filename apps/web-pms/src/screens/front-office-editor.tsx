import type { NamedListEntry } from '@hospai/client-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  NativeSelect,
  Textarea,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { isQueuedResult, queuedWriteCopy } from '../copy/is-queued-result.js';

const COMMENT_MAX = 2000;

function namedList(
  items: Array<{ key: string; value: NamedListEntry[] }> | undefined,
  key: string,
): NamedListEntry[] {
  return items?.find((item) => item.key === key)?.value ?? [];
}

/** Active entries, plus any current code that is archived or not on the list. */
function optionExtras(entries: NamedListEntry[], codes: Array<string | null | undefined>): string[] {
  const active = new Set(
    entries.filter((entry) => entry.status === 'active').map((entry) => entry.code),
  );
  const extras: string[] = [];
  for (const code of codes) {
    const trimmed = code?.trim() ?? '';
    if (trimmed && !active.has(trimmed) && !extras.includes(trimmed)) extras.push(trimmed);
  }
  return extras;
}

export function FrontOfficeEditor({
  reservationId,
  frontOfficeComment,
  vipFlag,
  dndFlag,
  sourceCode,
  marketSegmentCode,
  disabled,
  actions,
}: {
  reservationId: string;
  frontOfficeComment?: string | null;
  vipFlag?: boolean;
  dndFlag?: boolean;
  sourceCode?: string | null;
  marketSegmentCode?: string | null;
  disabled?: boolean;
  actions?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const propertyId = tenant.propertyId;
  const [comment, setComment] = useState(frontOfficeComment ?? '');
  const [vip, setVip] = useState(Boolean(vipFlag));
  const [dnd, setDnd] = useState(Boolean(dndFlag));
  const [source, setSource] = useState(sourceCode ?? '');
  const [segment, setSegment] = useState(marketSegmentCode ?? '');
  const [message, setMessageText] = useState<string | null>(null);
  const [messageIntent, setMessageIntent] = useState<'exception' | 'attention' | 'settled'>(
    'exception',
  );
  const setMessage = (text: string, intent: 'exception' | 'attention' | 'settled' = 'exception') => {
    setMessageIntent(intent);
    setMessageText(text);
  };

  const configQ = useQuery({
    queryKey: ['operational-config', propertyId],
    queryFn: () => api.listOperationalConfig(propertyId),
    retry: false,
  });
  const settled = configQ.isSuccess || configQ.isError;
  const sources = namedList(configQ.data?.items, 'pms.property.sources');
  const segments = namedList(configQ.data?.items, 'pms.property.market_segments');
  const activeSources = sources.filter((entry) => entry.status === 'active');
  const activeSegments = segments.filter((entry) => entry.status === 'active');
  const sourceExtras = optionExtras(sources, [source, sourceCode]);
  const segmentExtras = optionExtras(segments, [segment, marketSegmentCode]);
  const showSource = settled && (sources.length > 0 || Boolean(sourceCode));
  const showSegment = settled && (segments.length > 0 || Boolean(marketSegmentCode));

  useEffect(() => {
    setComment(frontOfficeComment ?? '');
    setVip(Boolean(vipFlag));
    setDnd(Boolean(dndFlag));
    setSource(sourceCode ?? '');
    setSegment(marketSegmentCode ?? '');
  }, [frontOfficeComment, vipFlag, dndFlag, sourceCode, marketSegmentCode]);

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
          sourceCode: source === '' ? null : source,
          marketSegmentCode: segment === '' ? null : segment,
        },
      ),
    onSuccess: (result) => {
      if (isQueuedResult(result)) {
        setMessage(queuedWriteCopy(), 'attention');
        return;
      }
      setMessage('Front office saved.', 'settled');
      void queryClient.invalidateQueries({
        queryKey: ['reservation', propertyId, reservationId],
      });
    },
    onError: (err) =>
      setMessage(classifiedUserMessage(asClassified(err), { fallback: 'Front-office update failed.' })),
  });

  const saveDisabled = Boolean(disabled) || tooLong || save.isPending;

  return (
    <Card data-testid="front-office-editor">
      <CardHeader>
        <CardTitle>Front office</CardTitle>
      </CardHeader>
      <CardContent>
      <div className="ui-row">
        {vip ? (
          <Badge rung="attention" data-testid="vip-badge">
            VIP
          </Badge>
        ) : null}
        {dnd ? (
          <Badge rung="neutral" data-testid="dnd-badge">
            DND
          </Badge>
        ) : null}
      </div>
      {showSource ? (
        <Field
          label="Source"
          control={
            <NativeSelect
              data-testid="fo-source"
              value={source}
              disabled={disabled}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">None</option>
              {activeSources.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name} ({entry.code})
                </option>
              ))}
              {sourceExtras.map((code) => (
                <option key={code} value={code}>
                  {code} (archived)
                </option>
              ))}
            </NativeSelect>
          }
        />
      ) : null}
      {showSegment ? (
        <Field
          label="Market segment"
          control={
            <NativeSelect
              data-testid="fo-segment"
              value={segment}
              disabled={disabled}
              onChange={(e) => setSegment(e.target.value)}
            >
              <option value="">None</option>
              {activeSegments.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name} ({entry.code})
                </option>
              ))}
              {segmentExtras.map((code) => (
                <option key={code} value={code}>
                  {code} (archived)
                </option>
              ))}
            </NativeSelect>
          }
        />
      ) : null}
      <Field
        label="Comment"
        size="full"
        control={
          <Textarea
            data-testid="front-office-comment"
            value={comment}
            disabled={disabled}
            onChange={(e) => setComment(e.target.value)}
          />
        }
      />
      <div className="ui-row">
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
      </div>
      <div className="ui-row">
        <Button
          type="button"
          data-testid="front-office-save"
          disabled={saveDisabled}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
        {actions}
      </div>
      {tooLong ? <Alert>Comment must be 2000 characters or fewer.</Alert> : null}
      {message ? (
        <Alert intent={messageIntent} data-testid="front-office-message">
          {message}
        </Alert>
      ) : null}
      </CardContent>
    </Card>
  );
}
