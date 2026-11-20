import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_GUEST_SETTINGS, type GuestSettings } from '@hospai/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Input,
  Skeleton,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { useUnsavedChanges } from './use-unsaved-changes.js';

export function SettingsGuests() {
  const orgId = tenant.orgId;
  const queryClient = useQueryClient();
  const settingsQ = useQuery({
    queryKey: ['org-guest-settings', orgId],
    queryFn: () => api.getGuestSettings(orgId),
    retry: false,
  });
  const [reason, setReason] = useState('');
  const [draft, setDraft] = useState<GuestSettings>(DEFAULT_GUEST_SETTINGS);
  const [saved, setSaved] = useState(false);
  const stored = settingsQ.data?.value;
  useEffect(() => {
    if (stored) setDraft(stored);
  }, [stored]);

  const dirty =
    stored != null &&
    (reason.trim().length > 0 ||
      draft.requireEmail !== stored.requireEmail ||
      draft.requirePhone !== stored.requirePhone ||
      draft.matchOnEmail !== stored.matchOnEmail ||
      draft.matchOnPhone !== stored.matchOnPhone ||
      draft.requireIdAtCheckIn !== stored.requireIdAtCheckIn ||
      draft.consentNoticeVersion !== stored.consentNoticeVersion);
  const unsavedGuard = useUnsavedChanges(dirty);

  const save = useMutation({
    mutationFn: () => api.putGuestSettings(orgId, draft, reason, settingsQ.data?.version ?? 0),
    onSuccess: async () => {
      setSaved(true);
      // The reason belongs to this save; clearing it also clears the unsaved-changes guard.
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['org-guest-settings', orgId] });
    },
  });

  if (settingsQ.isPending) return <Skeleton label="Loading guest settings" lines={4} />;
  if (settingsQ.isError) {
    return (
      <Alert intent="exception">
        {classifiedUserMessage(asClassified(settingsQ.error), { fallback: 'Could not load guest settings.' })}
      </Alert>
    );
  }

  const saveError = save.isError
    ? classifiedUserMessage(asClassified(save.error), { fallback: 'Could not save guest settings.' })
    : null;

  return (
    <>
      {unsavedGuard}
      <Alert intent="informational">
        <span className="ui-alert__title">These rules apply to new guest profiles</span>
        <span>Existing profiles stay editable. A reason is required before saving.</span>
      </Alert>
      <Card>
        <CardContent>
          <Field
            label="Reason"
            control={
              <Input
                value={reason}
                onChange={(e) => {
                  setSaved(false);
                  setReason(e.target.value);
                }}
                placeholder="Why this change…"
                autoComplete="off"
              />
            }
          />
        </CardContent>
      </Card>
      {saveError ? <Alert intent="exception">{saveError}</Alert> : null}
      {saved && !save.isPending ? <Alert intent="settled">Saved.</Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle>Required on new profiles</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="settings-property__grid">
            <Field
              label="Require email on new guest profiles"
              hint="A new guest profile without an email is refused."
              control={
                <Checkbox
                  checked={draft.requireEmail}
                  onChange={(e) => {
                    setSaved(false);
                    setDraft((prev) => ({ ...prev, requireEmail: e.target.checked }));
                  }}
                />
              }
            />
            <Field
              label="Require phone on new guest profiles"
              hint="A new guest profile without a phone is refused."
              control={
                <Checkbox
                  checked={draft.requirePhone}
                  onChange={(e) => {
                    setSaved(false);
                    setDraft((prev) => ({ ...prev, requirePhone: e.target.checked }));
                  }}
                />
              }
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Duplicate check at this property</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="settings-property__grid">
            <Field
              label="Match on email at this property"
              hint="A new guest profile whose email matches a guest already linked to this property is refused."
              control={
                <Checkbox
                  checked={draft.matchOnEmail}
                  onChange={(e) => {
                    setSaved(false);
                    setDraft((prev) => ({ ...prev, matchOnEmail: e.target.checked }));
                  }}
                />
              }
            />
            <Field
              label="Match on phone at this property"
              hint="A new guest profile whose phone matches a guest already linked to this property is refused. The match uses digits only."
              control={
                <Checkbox
                  checked={draft.matchOnPhone}
                  onChange={(e) => {
                    setSaved(false);
                    setDraft((prev) => ({ ...prev, matchOnPhone: e.target.checked }));
                  }}
                />
              }
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Check-in and consent</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="settings-property__grid">
            <Field
              label="Require an identity document at check-in"
              hint="Check-in is refused until this property has a live identity document for the guest."
              control={
                <Checkbox
                  checked={draft.requireIdAtCheckIn}
                  onChange={(e) => {
                    setSaved(false);
                    setDraft((prev) => ({ ...prev, requireIdAtCheckIn: e.target.checked }));
                  }}
                />
              }
            />
            <Field
              label="Consent notice version"
              hint="Required before staff can record consent. Letters, digits, dot, underscore, or hyphen. Leave blank until the notice is published."
              control={
                <Input
                  value={draft.consentNoticeVersion ?? ''}
                  maxLength={40}
                  autoComplete="off"
                  onChange={(e) => {
                    setSaved(false);
                    const next = e.target.value.trim();
                    setDraft((prev) => ({ ...prev, consentNoticeVersion: next.length > 0 ? next : null }));
                  }}
                />
              }
            />
          </div>
        </CardContent>
      </Card>
      <Button
        type="button"
        data-testid="guest-settings-save"
        disabled={!reason.trim() || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </Button>
    </>
  );
}
