import {
  OPS_COPY_KINDS,
  OPS_COPY_NOT_COPIED,
  type OpsCopyKind,
  type OpsCopyKindResult,
  type OpsCopyStatus,
} from '@hospai/contracts';
import {
  Alert,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Dialog,
  Field,
  NativeSelect,
  SectionLabel,
} from '@hospai/ui-kit';
import { useState } from 'react';
import { useCopyStatus, useCustomer, useOpsWrite } from '../api/hooks.js';
import { opsKeys } from '../api/keys.js';
import { opsErrorMessage } from '../api/client.js';
import { ReasonFields, WriteResult, useWriteController } from '../components/write.js';
import { COPY_KIND_LABELS, COPY_KIND_SHORT, skipReasonLabel } from '../copy-labels.js';
import { LoadFailure, LoadingBlock } from '../components/common.js';

/** The hand checklist (spec C5): what a copy never carries. Shown as soon as a copy is accepted. */
export function NotCopiedChecklist() {
  return (
    <section className="ops-section" aria-label="Not copied">
      <SectionLabel>Not copied: set these by hand</SectionLabel>
      <ul className="ops-checklist">
        {OPS_COPY_NOT_COPIED.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

const stateRung = (state: string) =>
  state === 'completed' || state === 'done' ? 'settled' : state === 'failed' ? 'exception' : 'attention';

const stateWord: Record<string, string> = {
  pending: 'Waiting',
  running: 'Running',
  done: 'Done',
  completed: 'Done',
  failed: 'Stopped',
};

function createdText(r: OpsCopyKindResult): string {
  if (r.state === 'pending' || r.state === 'running') return '';
  const parts = r.parts
    ? ` (${Object.entries(r.parts)
        .map(([k, n]) => `${n} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`)
        .join(', ')})`
    : '';
  return `${r.created}${parts}`;
}

/** Counts per kind, each skipped item with its reason, and the hand checklist. Polls until the run ends. */
export function CopyResult({ copyId, onResume, resuming }: { copyId: string; onResume?: () => void; resuming?: boolean }) {
  const q = useCopyStatus(copyId);
  if (q.isPending) return <LoadingBlock label="Loading copy progress" />;
  if (q.isError) return <LoadFailure error={q.error} onRetry={() => void q.refetch()} />;
  const status: OpsCopyStatus = q.data;
  const kinds = status.kinds;
  const skipped = kinds.flatMap((k) => (status.results[k]?.skipped ?? []).map((s) => ({ kind: k, ...s })));
  const skippedMore = kinds.reduce((n, k) => n + (status.results[k]?.skippedMore ?? 0), 0);
  return (
    <div className="ops-form" aria-live="polite">
      {status.state === 'completed' ? (
        <Alert intent="settled">
          <AlertTitle>Copy finished</AlertTitle> Skipped items are listed below. Rooms, users and the rest of the checklist are still to do.
        </Alert>
      ) : status.state === 'failed' ? (
        <Alert intent="exception">
          <AlertTitle>The copy stopped</AlertTitle> What was already copied stays. Resume it to finish the rest; nothing is created twice.
        </Alert>
      ) : (
        <Alert intent="informational">
          <AlertTitle>Copying</AlertTitle> This page updates by itself. You can close it; the copy keeps running.
        </Alert>
      )}
      <DataTable>
        <DataTableHead>
          <DataTableRow>
            <DataTableHeaderCell>Kind</DataTableHeaderCell>
            <DataTableHeaderCell>State</DataTableHeaderCell>
            <DataTableHeaderCell>Created</DataTableHeaderCell>
            <DataTableHeaderCell>Skipped</DataTableHeaderCell>
          </DataTableRow>
        </DataTableHead>
        <DataTableBody>
          {kinds.map((k) => {
            const r = status.results[k]!;
            return (
              <DataTableRow key={k}>
                <DataTableCell>{COPY_KIND_SHORT[k]}</DataTableCell>
                <DataTableCell>
                  <Badge rung={stateRung(r.state)}>{stateWord[r.state] ?? r.state}</Badge>
                </DataTableCell>
                <DataTableCell>{createdText(r)}</DataTableCell>
                <DataTableCell>{r.state === 'done' ? String(r.skipped.length + r.skippedMore) : ''}</DataTableCell>
              </DataTableRow>
            );
          })}
        </DataTableBody>
      </DataTable>
      {skipped.length > 0 ? (
        <section className="ops-section" aria-label="Skipped items">
          <SectionLabel>Skipped items</SectionLabel>
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Item</DataTableHeaderCell>
                <DataTableHeaderCell>Kind</DataTableHeaderCell>
                <DataTableHeaderCell>Why</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {skipped.map((s) => (
                <DataTableRow key={`${s.kind}:${s.sourceId}`}>
                  <DataTableCell>{s.label}</DataTableCell>
                  <DataTableCell>{COPY_KIND_SHORT[s.kind]}</DataTableCell>
                  <DataTableCell>{skipReasonLabel(s.reason)}</DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
          {skippedMore > 0 ? <p>And {skippedMore} more skipped items that are not listed.</p> : null}
        </section>
      ) : null}
      <NotCopiedChecklist />
      {status.state === 'failed' && onResume ? (
        <div>
          <Button intent="primary" disabled={resuming} onClick={onResume}>
            {resuming ? 'Working' : 'Resume copy'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

type Props = { orgId: string; targetPropertyId: string; onClose: () => void };

/**
 * "Copy setup from another hotel" (R7.5, ops_admin only). Source choices are the other hotels of the
 * same customer. Once accepted, the dialog becomes the result view. Reason is required, as for every write.
 */
export function CopySetupDialog({ orgId, targetPropertyId, onClose }: Props) {
  const customer = useCustomer(orgId);
  const [source, setSource] = useState('');
  const [kinds, setKinds] = useState<Set<OpsCopyKind>>(() => new Set(OPS_COPY_KINDS));
  const write = useOpsWrite(
    `/properties/${encodeURIComponent(targetPropertyId)}/copy-setup`,
    () => [opsKeys.health(targetPropertyId), opsKeys.actionsAll(), ['ops', 'copy']],
    { keepKeyOnSuccess: true },
  );
  const c = useWriteController(write, () => {
    if (!source) return { error: 'Choose the hotel to copy from.' };
    if (kinds.size === 0) return { error: 'Tick at least one thing to copy.' };
    return {
      payload: { sourcePropertyId: source, kinds: OPS_COPY_KINDS.filter((k) => kinds.has(k)) },
    };
  });

  const others = customer.data?.properties.filter((p) => p.propertyId !== targetPropertyId) ?? [];
  const copyId = write.data?.copyId ?? null;

  function toggle(kind: OpsCopyKind, on: boolean) {
    setKinds((prev) => {
      const next = new Set(prev);
      if (on) next.add(kind);
      else next.delete(kind);
      return next;
    });
  }

  return (
    <Dialog
      open
      title={copyId ? 'Copy setup: progress' : 'Copy setup from another hotel'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{copyId ? 'Close' : 'Cancel'}</Button>
          {copyId ? null : (
            <Button intent="primary" disabled={c.pending || customer.isPending} onClick={c.submit}>
              {c.pending ? 'Working' : 'Copy setup'}
            </Button>
          )}
        </>
      }
    >
      {copyId ? (
        <>
          <CopyResult copyId={copyId} onResume={c.submit} resuming={c.pending} />
          {c.failure ? <Alert intent="exception">{c.failure}</Alert> : null}
        </>
      ) : (
        <div className="ops-form">
          <p>
            Copies the setup into this hotel as it is now: nothing else. The hotel must be empty (no reservation
            ever, and none of the things you tick). The copy runs in the background and each change is recorded in
            this hotel&rsquo;s audit log as HospAI support.
          </p>
          {customer.isError ? <Alert intent="exception">{opsErrorMessage(customer.error)}</Alert> : null}
          <Field
            label="Copy from"
            hint={others.length === 0 && !customer.isPending ? 'This customer has no other hotel to copy from.' : 'Only this customer’s other hotels are listed.'}
            size="lg"
            control={
              <NativeSelect value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">Choose a hotel</option>
                {others.map((p) => (
                  <option key={p.propertyId} value={p.propertyId}>
                    {p.name} ({p.propertyId})
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <fieldset className="ops-fieldset">
            <legend>What to copy</legend>
            {OPS_COPY_KINDS.map((k) => (
              <label key={k} className="ops-check">
                <Checkbox checked={kinds.has(k)} onChange={(e) => toggle(k, e.target.checked)} />
                <span>{COPY_KIND_LABELS[k]}</span>
              </label>
            ))}
          </fieldset>
          <NotCopiedChecklist />
          <ReasonFields c={c} />
          <WriteResult c={c} doneText="The copy is accepted." />
        </div>
      )}
    </Dialog>
  );
}
