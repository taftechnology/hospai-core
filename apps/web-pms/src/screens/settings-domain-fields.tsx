import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Checkbox, Field } from '@hospai/ui-kit';
import { api } from '../client.js';

export type DomainKey = { key: string; value: unknown };

type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const AUTO_SAVE_DELAY_MS = 800;
const SAVED_ACK_MS = 2000;

function useAutoSave(props: { dirty: boolean; reason: string; save: () => void }) {
  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const saveRef = useRef(props.save);
  saveRef.current = props.save;
  useEffect(() => {
    if (!props.dirty || !props.reason.trim()) return;
    setStatus('saving');
    const t = setTimeout(() => saveRef.current(), AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [props.dirty, props.reason]);
  useEffect(() => {
    if (status !== 'saved') return;
    const t = setTimeout(() => setStatus('idle'), SAVED_ACK_MS);
    return () => clearTimeout(t);
  }, [status]);
  return [status, setStatus] as const;
}

function AutoSaveStatusIndicator(props: { status: AutoSaveStatus; dirty: boolean; reason: string }) {
  let text: string | null = null;
  if (props.status === 'saving') text = 'Saving…';
  else if (props.status === 'saved') text = 'Saved.';
  else if (props.status === 'error') text = 'Save failed. Try again.';
  else if (props.dirty && !props.reason.trim()) text = 'Enter a reason to save changes.';
  return text ? (
    <p className="muted settings-property__status" aria-live="polite">
      {text}
    </p>
  ) : (
    <p className="settings-property__status" aria-hidden="true" />
  );
}

export function SettingsDomainBool(props: {
  label: string;
  configKey: string;
  initial: unknown;
  reason: string;
  hint?: string;
  propertyId: string;
  onSaved: () => void;
}) {
  const [on, setOn] = useState(Boolean(props.initial));
  useEffect(() => {
    setOn(Boolean(props.initial));
  }, [props.initial]);
  const dirty = on !== Boolean(props.initial);
  const save = useMutation({
    mutationFn: () =>
      api.putDomainConfig(props.propertyId, {
        key: props.configKey,
        value: on,
        reason: props.reason,
      }),
    onSuccess: () => {
      props.onSaved();
      setStatus('saved');
    },
    onError: () => setStatus('error'),
  });
  const [status, setStatus] = useAutoSave({ dirty, reason: props.reason, save: () => save.mutate() });
  return (
    <div className="ui-stack">
      <Field
        label={props.label}
        hint={props.hint}
        control={<Checkbox checked={on} onChange={(e) => setOn(e.target.checked)} />}
      />
      <AutoSaveStatusIndicator status={status} dirty={dirty} reason={props.reason} />
    </div>
  );
}
