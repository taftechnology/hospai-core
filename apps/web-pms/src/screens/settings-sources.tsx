import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { NamedListEntry, OperationalConfigKey } from '@hospai/client-core';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyState,
  Field,
  Input,
  RowActions,
  Skeleton,
  VisuallyHidden,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { ConfirmDialog } from '../shell/ConfirmDialog.js';
import { badgeStatusWord } from '../status/badge-status-word.js';
import { FormDialog } from '../shell/FormDialog.js';

const CODE_RE = /^[A-Z0-9_]{1,32}$/;
const MAX_ENTRIES = 50;

const LISTS: Array<{ key: OperationalConfigKey; title: string; noun: 'source' | 'segment'; testId: string }> = [
  { key: 'pms.property.sources', title: 'Booking sources', noun: 'source', testId: 'booking-sources' },
  {
    key: 'pms.property.market_segments',
    title: 'Market segments',
    noun: 'segment',
    testId: 'market-segments',
  },
];

type Draft = {
  key: OperationalConfigKey;
  mode: 'add' | 'rename';
  code: string;
  name: string;
};

type ArchiveTarget = {
  key: OperationalConfigKey;
  noun: 'source' | 'segment';
  entry: NamedListEntry;
};

function failure(err: unknown, fallback: string): string {
  return classifiedUserMessage(asClassified(err), { fallback });
}

function entriesOf(
  items: Array<{ key: string; value: NamedListEntry[] }> | undefined,
  key: OperationalConfigKey,
): NamedListEntry[] {
  return items?.find((item) => item.key === key)?.value ?? [];
}

/**
 * Settings → Sources & segments (roadmap R1.6). Each save writes the whole
 * named list; codes are archived, never removed.
 */
export function SourcesSettings({ onMessage }: { onMessage: (message: string) => void }) {
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const configQ = useQuery({
    queryKey: ['operational-config', propertyId],
    queryFn: () => api.listOperationalConfig(propertyId),
    retry: false,
  });

  const save = useMutation({
    mutationFn: (input: {
      key: OperationalConfigKey;
      value: NamedListEntry[];
      reason: string;
      surface: 'dialog' | 'page';
    }) => api.putOperationalConfig(propertyId, input.key, input.value, input.reason),
    onSuccess: () => {
      setDraft(null);
      setArchiveTarget(null);
      onMessage('Saved.');
      void queryClient.invalidateQueries({ queryKey: ['operational-config', propertyId] });
    },
    onError: (err, input) => {
      const message = failure(err, 'Could not save the list.');
      if (input.surface === 'dialog') setDialogError(message);
      else setPageError(message);
    },
  });

  function write(
    key: OperationalConfigKey,
    value: NamedListEntry[],
    reason: string,
    surface: 'dialog' | 'page',
  ) {
    setPageError(null);
    save.mutate({ key, value, reason, surface });
  }

  if (configQ.isError) {
    return (
      <Alert data-testid="sources-error">
        {failure(configQ.error, 'Could not load sources and segments.')}
      </Alert>
    );
  }
  if (!configQ.isSuccess) return <Skeleton aria-label="Loading sources and segments" />;

  const items = configQ.data.items;
  const draftEntries = draft ? entriesOf(items, draft.key) : [];
  const draftNoun = LISTS.find((list) => list.key === draft?.key)?.noun ?? 'source';
  const codeOk = draft != null && CODE_RE.test(draft.code);
  const codeUnique =
    draft == null ||
    draft.mode === 'rename' ||
    !draftEntries.some((entry) => entry.code === draft.code);
  const nameOk = draft != null && draft.name.trim().length >= 1 && draft.name.trim().length <= 60;
  const draftValid = codeOk && codeUnique && nameOk;

  function commitDraft() {
    if (!draft || !draftValid) return;
    const current = entriesOf(items, draft.key);
    const name = draft.name.trim();
    const next =
      draft.mode === 'add'
        ? [...current, { code: draft.code, name, status: 'active' as const }]
        : current.map((entry) => (entry.code === draft.code ? { ...entry, name } : entry));
    const verb = draft.mode === 'add' ? 'Add' : 'Rename';
    write(draft.key, next, `${verb} ${draftNoun} ${draft.code}`, 'dialog');
  }

  return (
    <>
      {pageError ? <Alert>{pageError}</Alert> : null}
      {LISTS.map((list) => {
        const entries = entriesOf(items, list.key);
        const full = entries.length >= MAX_ENTRIES;
        return (
          <Card key={list.key} data-testid={list.testId}>
            <CardHeader>
              <CardTitle>{list.title}</CardTitle>
              {full ? <p className="muted">This list is full (50 entries).</p> : null}
              <Button
                type="button"
                size="sm"
                disabled={full}
                onClick={() => {
                  setDialogError(null);
                  setDraft({ key: list.key, mode: 'add', code: '', name: '' });
                }}
              >
                Add
              </Button>
            </CardHeader>
            <CardContent flush={entries.length > 0}>
              {entries.length === 0 ? (
                <EmptyState
                  title={list.noun === 'source' ? 'No booking sources' : 'No market segments'}
                  description={
                    list.noun === 'source'
                      ? 'Add a source such as Walk-in or OTA. Archived codes stay on the list.'
                      : 'Add a segment such as Leisure or Corporate. Archived codes stay on the list.'
                  }
                />
              ) : (
                <DataTable>
                  <DataTableHead>
                    <DataTableRow>
                      <DataTableHeaderCell>Code</DataTableHeaderCell>
                      <DataTableHeaderCell>Name</DataTableHeaderCell>
                      <DataTableHeaderCell>Status</DataTableHeaderCell>
                      <DataTableHeaderCell align="right">
                        <VisuallyHidden>Actions</VisuallyHidden>
                      </DataTableHeaderCell>
                    </DataTableRow>
                  </DataTableHead>
                  <DataTableBody>
                    {entries.map((entry) => (
                      <DataTableRow key={entry.code}>
                        <DataTableCell>{entry.code}</DataTableCell>
                        <DataTableCell>{entry.name}</DataTableCell>
                        <DataTableCell>
                          <Badge rung={entry.status === 'active' ? 'settled' : 'neutral'}>
                            {badgeStatusWord(entry.status)}
                          </Badge>
                        </DataTableCell>
                        <DataTableCell align="right">
                          <RowActions>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                setDialogError(null);
                                setDraft({
                                  key: list.key,
                                  mode: 'rename',
                                  code: entry.code,
                                  name: entry.name,
                                });
                              }}
                            >
                              Rename
                            </Button>
                            {entry.status === 'active' ? (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  setArchiveTarget({ key: list.key, noun: list.noun, entry })
                                }
                              >
                                Archive
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  write(
                                    list.key,
                                    entries.map((row) =>
                                      row.code === entry.code ? { ...row, status: 'active' as const } : row,
                                    ),
                                    `Restore ${list.noun} ${entry.code}`,
                                    'page',
                                  )
                                }
                              >
                                Restore
                              </Button>
                            )}
                          </RowActions>
                        </DataTableCell>
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </DataTable>
              )}
            </CardContent>
          </Card>
        );
      })}

      {draft ? (
        <FormDialog
          title={`${draft.mode === 'add' ? 'Add' : 'Rename'} ${draftNoun}`}
          onClose={() => setDraft(null)}
          actions={
            <>
              <Button type="button" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                intent="primary"
                disabled={!draftValid || save.isPending}
                onClick={commitDraft}
              >
                Save
              </Button>
            </>
          }
        >
          <Field
            label="Code"
            error={
              draft.mode === 'add' && draft.code.length > 0 && !codeOk
                ? 'Use 1–32 characters: A–Z, 0–9, and underscore.'
                : draft.mode === 'add' && draft.code.length > 0 && !codeUnique
                  ? 'That code is already on the list.'
                  : undefined
            }
            control={
              <Input
                value={draft.code}
                disabled={draft.mode === 'rename'}
                autoComplete="off"
                onChange={(e) =>
                  setDraft({ ...draft, code: e.target.value.toUpperCase() })
                }
              />
            }
          />
          <Field
            label="Name"
            control={
              <Input
                value={draft.name}
                autoComplete="off"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            }
          />
          {dialogError ? <Alert>{dialogError}</Alert> : null}
        </FormDialog>
      ) : null}

      {archiveTarget ? (
        <ConfirmDialog
          title={`Archive ${archiveTarget.noun}?`}
          description={`${archiveTarget.entry.name} leaves the booking pickers. The code stays on the list so existing stays still show it.`}
          confirmLabel="Archive"
          intent="destructive"
          onCancel={() => setArchiveTarget(null)}
          onConfirm={() => {
            const target = archiveTarget;
            const current = entriesOf(items, target.key);
            setArchiveTarget(null);
            write(
              target.key,
              current.map((row) =>
                row.code === target.entry.code ? { ...row, status: 'archived' as const } : row,
              ),
              `Archive ${target.noun} ${target.entry.code}`,
              'page',
            );
          }}
        />
      ) : null}
    </>
  );
}
