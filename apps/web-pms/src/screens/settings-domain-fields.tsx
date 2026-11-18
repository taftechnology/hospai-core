import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  NativeSelect,
  type FieldProps,
} from '@hospai/ui-kit';
import { api, asClassified } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';

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
    <div className="ui-stack" data-config-key={props.configKey}>
      <Field
        label={props.label}
        hint={props.hint}
        control={<Checkbox checked={on} onChange={(e) => setOn(e.target.checked)} />}
      />
      <AutoSaveStatusIndicator status={status} dirty={dirty} reason={props.reason} />
    </div>
  );
}

function domainSaveDisabled(reason: string, extra?: boolean) {
  return !reason.trim() || extra === true;
}

export function SettingsDomainManualSave(props: {
  label: string;
  configKey: string;
  initial: unknown;
  reason: string;
  propertyId: string;
  onSaved: () => void;
  saveLabel: string;
  saveDisabled?: boolean;
  hint?: string;
  control: (bind: { value: string; onChange: (v: string) => void; id: string }) => FieldProps['control'];
  serialize: (draft: string) => unknown;
  draftFromInitial: (initial: unknown) => string;
}) {
  const fieldId = `domain-${props.configKey.replace(/\./g, '-')}`;
  const [draft, setDraft] = useState(() => props.draftFromInitial(props.initial));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(props.draftFromInitial(props.initial));
  }, [props.initial]);

  const save = useMutation({
    mutationFn: () =>
      api.putDomainConfig(props.propertyId, {
        key: props.configKey,
        value: props.serialize(draft),
        reason: props.reason,
      }),
    onSuccess: () => {
      setError(null);
      props.onSaved();
    },
    onError: (err) => {
      setError(classifiedUserMessage(asClassified(err), {}));
    },
  });

  const disabled =
    domainSaveDisabled(props.reason, props.saveDisabled) ||
    save.isPending ||
    draft === props.draftFromInitial(props.initial);

  return (
    <div className="ui-stack">
      {error ? <Alert intent="exception">{error}</Alert> : null}
      <Field
        label={props.label}
        hint={props.hint}
        control={props.control({ value: draft, onChange: setDraft, id: fieldId })}
      />
      <Button type="button" disabled={disabled} onClick={() => save.mutate()}>
        {props.saveLabel}
      </Button>
    </div>
  );
}

export function SettingsDomainManualStringSave(
  props: Omit<
    Parameters<typeof SettingsDomainManualSave>[0],
    'control' | 'serialize' | 'draftFromInitial'
  >,
) {
  return (
    <SettingsDomainManualSave
      {...props}
      draftFromInitial={(initial) => String(initial ?? '')}
      serialize={(draft) => draft}
      control={({ value, onChange, id }) => (
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
      )}
    />
  );
}

export function SettingsDomainManualSelectSave(
  props: Omit<
    Parameters<typeof SettingsDomainManualSave>[0],
    'control' | 'serialize' | 'draftFromInitial'
  > & {
    options: Array<{ value: string; label: string }>;
  },
) {
  const { options, ...rest } = props;
  return (
    <SettingsDomainManualSave
      {...rest}
      draftFromInitial={(initial) => String(initial ?? '')}
      serialize={(draft) => draft}
      control={({ value, onChange, id }) => (
        <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      )}
    />
  );
}

export function SettingsDomainManualIntSave(
  props: Omit<
    Parameters<typeof SettingsDomainManualSave>[0],
    'control' | 'serialize' | 'draftFromInitial'
  >,
) {
  return (
    <SettingsDomainManualSave
      {...props}
      draftFromInitial={(initial) => String(initial ?? '')}
      serialize={(draft) => {
        const n = Number(draft);
        return Number.isFinite(n) ? Math.trunc(n) : 1;
      }}
      control={({ value, onChange, id }) => (
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
      )}
    />
  );
}
