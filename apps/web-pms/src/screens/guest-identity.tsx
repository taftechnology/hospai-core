import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACCESSIBILITY_CODES,
  ACCESSIBILITY_LABELS,
  BEDDING_PREFERENCE_CODES,
  BEDDING_PREFERENCE_LABELS,
  CONSENT_PURPOSE_LABELS,
  CONSENT_PURPOSES,
  CONSENT_SOURCE_LABELS,
  CONSENT_SOURCES,
  DIETARY_PREFERENCE_CODES,
  DIETARY_PREFERENCE_LABELS,
  GUEST_DOCUMENT_KIND_LABELS,
  GUEST_DOCUMENT_KINDS,
  maskedDocumentNumber,
  ROOM_PREFERENCE_CODES,
  ROOM_PREFERENCE_LABELS,
  type ConsentPurpose,
  type ConsentSource,
  type GuestDocumentFields,
  type GuestDocumentKind,
  type GuestPreferences,
} from '@hospai/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Dialog,
  EmptyState,
  Field,
  FileInput,
  Input,
  NativeSelect,
  RowActions,
  SectionLabel,
  Skeleton,
  StatField,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { useFormat } from '../shell/PropertyFormat.js';

export const ID_DOCUMENT_BLOCK_REASON = 'Record an identity document before check-in.';

const NATIONALITY_KINDS = new Set<GuestDocumentKind>(['PASSPORT', 'VISA', 'NATIONAL_ID']);
const DATE_FIELDS = new Set(['dateOfBirth', 'issueDate', 'expiryDate']);

const FIELD_ROWS: Array<[keyof GuestDocumentFields, string]> = [
  ['number', 'Number'],
  ['numberLast4', 'Last 4 digits'],
  ['issuingCountry', 'Issuing country'],
  ['nationality', 'Nationality'],
  ['visaType', 'Visa type'],
  ['dateOfBirth', 'Date of birth'],
  ['issueDate', 'Issue date'],
  ['expiryDate', 'Expires'],
  ['placeOfIssue', 'Place of issue'],
];

type DocSummary = {
  id: string;
  kind: string;
  hasScan: boolean;
  scanContentType: string | null;
  createdAt: number;
};

type ScanFile = { contentType: string; bytes: Uint8Array };

type IdForm = {
  kind: GuestDocumentKind;
  number: string;
  last4: string;
  issuingCountry: string;
  nationality: string;
  visaType: string;
  dateOfBirth: string;
  issueDate: string;
  expiryDate: string;
  placeOfIssue: string;
};

const EMPTY_ID_FORM: IdForm = {
  kind: 'PASSPORT',
  number: '',
  last4: '',
  issuingCountry: '',
  nationality: '',
  visaType: '',
  dateOfBirth: '',
  issueDate: '',
  expiryDate: '',
  placeOfIssue: '',
};

type WriteResult = { body?: unknown; classified: Parameters<typeof classifiedUserMessage>[0] };

function documentsKey(propertyId: string, guestRef: string) {
  return ['guest-documents', propertyId, guestRef] as const;
}

function documentKey(propertyId: string, guestRef: string, documentId: string) {
  return ['guest-document', propertyId, guestRef, documentId] as const;
}

function scanKey(propertyId: string, guestRef: string, documentId: string) {
  return ['guest-document-scan', propertyId, guestRef, documentId] as const;
}

function consentKey(propertyId: string, guestRef: string) {
  return ['guest-consent', propertyId, guestRef] as const;
}

function documentsOf(data: unknown): DocSummary[] {
  if (!data || typeof data !== 'object' || !('documents' in data)) return [];
  const docs = (data as { documents: unknown }).documents;
  return Array.isArray(docs) ? (docs as DocSummary[]) : [];
}

function assertWritten(result: WriteResult, message: string) {
  const body = result.body;
  if (!body || typeof body !== 'object' || !('ok' in body) || (body as { ok: unknown }).ok !== true) {
    throw Object.assign(new Error(message), { classified: result.classified });
  }
}

function blobFromBytes(bytes: Uint8Array, contentType: string): Blob {
  return new Blob(
    [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
    { type: contentType },
  );
}

function isScanOk(data: unknown): data is { ok: true; bytes: Uint8Array; contentType: string } {
  return Boolean(
    data &&
      typeof data === 'object' &&
      'ok' in data &&
      (data as { ok: unknown }).ok === true &&
      'bytes' in data,
  );
}

function isDocRead(data: unknown): data is { kind: string; fields: GuestDocumentFields; hasScan: boolean } {
  if (!data || typeof data !== 'object') return false;
  const row = data as { kind?: unknown; fields?: unknown };
  return typeof row.kind === 'string' && row.fields != null && typeof row.fields === 'object';
}

function readProfile(entry: unknown): { preferences?: GuestPreferences } | null {
  if (!entry || typeof entry !== 'object' || !('profile' in entry)) return null;
  const profile = (entry as { profile?: unknown }).profile;
  if (!profile || typeof profile !== 'object') return null;
  return profile as { preferences?: GuestPreferences };
}

function preferenceLabels(preferences: GuestPreferences | undefined): string[] {
  if (!preferences) return [];
  const labels: string[] = [];
  for (const code of preferences.room ?? []) {
    const label = ROOM_PREFERENCE_LABELS[code];
    if (label) labels.push(label);
  }
  for (const code of preferences.bedding ?? []) {
    const label = BEDDING_PREFERENCE_LABELS[code];
    if (label) labels.push(label);
  }
  for (const code of preferences.dietary ?? []) {
    const label = DIETARY_PREFERENCE_LABELS[code];
    if (label) labels.push(label);
  }
  for (const code of preferences.accessibility ?? []) {
    const label = ACCESSIBILITY_LABELS[code];
    if (label) labels.push(label);
  }
  const other = preferences.other?.trim();
  if (other) labels.push(other);
  return labels;
}

function consentWord(status: string): string {
  if (status === 'GRANTED') return 'Granted';
  if (status === 'WITHDRAWN') return 'Withdrawn';
  return status;
}

function alpha2(value: string): boolean {
  return /^[A-Za-z]{2}$/.test(value.trim());
}

function formReady(form: IdForm): boolean {
  if (form.kind === 'AADHAAR') return /^\d{4}$/.test(form.last4);
  if (!form.number.trim() || !alpha2(form.issuingCountry)) return false;
  if (NATIONALITY_KINDS.has(form.kind) && !alpha2(form.nationality)) return false;
  return true;
}

function fieldsFor(form: IdForm): Record<string, string> {
  if (form.kind === 'AADHAAR') {
    const fields: Record<string, string> = { numberLast4: form.last4 };
    copyOptional(form, fields);
    return fields;
  }
  const fields: Record<string, string> = {
    number: form.number.trim(),
    issuingCountry: form.issuingCountry.trim(),
  };
  if (NATIONALITY_KINDS.has(form.kind)) fields.nationality = form.nationality.trim();
  if (form.kind === 'VISA' && form.visaType.trim()) fields.visaType = form.visaType.trim();
  copyOptional(form, fields);
  return fields;
}

function copyOptional(form: IdForm, fields: Record<string, string>) {
  if (form.dateOfBirth) fields.dateOfBirth = form.dateOfBirth;
  if (form.issueDate) fields.issueDate = form.issueDate;
  if (form.expiryDate) fields.expiryDate = form.expiryDate;
  if (form.placeOfIssue.trim()) fields.placeOfIssue = form.placeOfIssue.trim();
}

function fieldValue(key: keyof GuestDocumentFields, fields: GuestDocumentFields, date: (iso: string) => string): string {
  if (key === 'numberLast4') return maskedDocumentNumber(fields);
  const value = fields[key];
  if (!value) return '';
  if (DATE_FIELDS.has(key)) return date(value);
  return value;
}

async function readScanFile(file: File): Promise<ScanFile> {
  const buf = await file.arrayBuffer();
  return { contentType: file.type || 'application/octet-stream', bytes: new Uint8Array(buf) };
}

function downloadScan(bytes: Uint8Array, contentType: string, filename: string) {
  const url = URL.createObjectURL(blobFromBytes(bytes, contentType));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function useGuestDocumentList(propertyId: string, guestRef: string, enabled = true) {
  return useQuery({
    queryKey: documentsKey(propertyId, guestRef),
    queryFn: () => api.listGuestDocuments(propertyId, guestRef),
    enabled: enabled && Boolean(guestRef),
  });
}

/** Batch profile when the stay/check-in guest query already decrypted one; otherwise `['guest', propertyId, guestRef]`. */
export function useGuestPreferences(
  propertyId: string,
  guestRef: string | undefined,
  batch: unknown,
  batchSettled: boolean,
): GuestPreferences | undefined {
  const guests =
    batch && typeof batch === 'object' && 'guests' in batch
      ? (batch as { guests?: Record<string, unknown> }).guests
      : undefined;
  const entry = guestRef ? guests?.[guestRef] : undefined;
  const profile = readProfile(entry);
  const detail = useQuery({
    queryKey: ['guest', propertyId, guestRef ?? ''],
    queryFn: () => api.getGuest(propertyId, guestRef!),
    enabled: Boolean(guestRef) && batchSettled && profile == null,
  });
  if (profile) return profile.preferences;
  return readProfile(detail.data)?.preferences;
}

export function GuestDocumentBadges({ propertyId, guestRef }: { propertyId: string; guestRef: string }) {
  const list = useGuestDocumentList(propertyId, guestRef);
  if (!list.isSuccess) return null;
  const onFile = documentsOf(list.data).length > 0;
  return (
    <div className="ui-row" data-testid="guest-document-badges">
      <Badge rung={onFile ? 'settled' : 'neutral'} data-testid="id-on-file">
        {onFile ? 'ID on file' : 'No ID on file'}
      </Badge>
    </div>
  );
}

export function GuestPreferenceBadges({ preferences }: { preferences?: GuestPreferences }) {
  const labels = preferenceLabels(preferences);
  if (labels.length === 0) return null;
  return (
    <div className="ui-row" data-testid="guest-preference-badges">
      {labels.map((label) => (
        <Badge key={label} rung="neutral">
          {label}
        </Badge>
      ))}
    </div>
  );
}

export function SelectedGuestDocument({ propertyId, guestRef }: { propertyId: string; guestRef: string }) {
  const format = useFormat();
  const list = useGuestDocumentList(propertyId, guestRef);
  const newest = documentsOf(list.data)[0];
  const detail = useQuery({
    queryKey: newest ? documentKey(propertyId, guestRef, newest.id) : ['guest-document', propertyId, guestRef, 'none'],
    queryFn: () => api.readGuestDocument(propertyId, guestRef, newest!.id),
    enabled: Boolean(newest),
    gcTime: 0,
    staleTime: 0,
  });
  const image = Boolean(newest?.hasScan && newest.scanContentType?.startsWith('image/'));
  const scan = useQuery({
    queryKey: newest ? scanKey(propertyId, guestRef, newest.id) : ['guest-document-scan', propertyId, guestRef, 'none'],
    queryFn: () => api.getGuestDocumentScan(propertyId, guestRef, newest!.id),
    enabled: Boolean(newest && image),
    gcTime: 0,
    staleTime: 0,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isScanOk(scan.data)) return;
    const next = URL.createObjectURL(blobFromBytes(scan.data.bytes, scan.data.contentType));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [scan.data]);
  if (!newest || !isDocRead(detail.data)) return null;
  const fields = detail.data.fields;
  const masked = maskedDocumentNumber(fields);
  const kind = GUEST_DOCUMENT_KIND_LABELS[detail.data.kind as GuestDocumentKind] ?? detail.data.kind;
  const expiry = typeof fields.expiryDate === 'string' ? format.date(fields.expiryDate) : '';
  return (
    <div data-testid="selected-guest-document">
      <SectionLabel>Identity on file</SectionLabel>
      <p>
        {kind}
        {` · ${masked}`}
        {expiry ? ` · expires ${expiry}` : ''}
      </p>
      {url ? <img src={url} alt="Identity document" /> : null}
    </div>
  );
}

export function RecordIdDocumentDialog({
  open,
  onClose,
  propertyId,
  guestRef,
  onRecorded,
}: {
  open: boolean;
  onClose: () => void;
  propertyId: string;
  guestRef: string;
  onRecorded?: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<IdForm>(EMPTY_ID_FORM);
  const [scan, setScan] = useState<ScanFile | null>(null);
  const [fileEpoch, setFileEpoch] = useState(0);
  const [dialogError, setDialogError] = useState<string | null>(null);

  function reset() {
    setForm(EMPTY_ID_FORM);
    setScan(null);
    setFileEpoch((n) => n + 1);
    setDialogError(null);
  }

  function dismiss() {
    reset();
    onClose();
  }

  const add = useMutation({
    mutationFn: async () => {
      const documentId = `doc_${crypto.randomUUID().replace(/-/g, '')}`;
      const created = await api.addGuestDocument(
        propertyId,
        guestRef,
        { documentId, kind: form.kind, fields: fieldsFor(form) },
        `guest-doc:${propertyId}:${guestRef}:${crypto.randomUUID()}`,
      );
      assertWritten(created, 'add');
      if (scan && form.kind !== 'AADHAAR') {
        try {
          const attached = await api.attachGuestDocumentScan(
            propertyId,
            guestRef,
            documentId,
            scan,
            `guest-scan:${documentId}:${crypto.randomUUID()}`,
          );
          assertWritten(attached, 'scan');
        } catch (err) {
          await queryClient.invalidateQueries({ queryKey: documentsKey(propertyId, guestRef) });
          throw err;
        }
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: documentsKey(propertyId, guestRef) });
      onRecorded?.();
      dismiss();
    },
    onError: (err) => {
      setDialogError(classifiedUserMessage(asClassified(err), { fallback: 'Could not record the document.' }));
    },
  });

  return (
    <Dialog
      open={open}
      title="Record identity document"
      onClose={dismiss}
      data-testid="record-id-document"
      footer={
        <>
          <Button type="button" onClick={dismiss}>
            Cancel
          </Button>{' '}
          <Button type="button" disabled={!formReady(form) || add.isPending} onClick={() => add.mutate()}>
            Record document
          </Button>
        </>
      }
    >
      <div className="ui-stack">
        {dialogError ? <Alert intent="exception">{dialogError}</Alert> : null}
        <Field
          label="Document kind"
          control={
            <NativeSelect
              value={form.kind}
              onChange={(e) => {
                const kind = e.target.value as GuestDocumentKind;
                setForm((prev) => ({ ...prev, kind }));
                if (kind === 'AADHAAR') setScan(null);
              }}
            >
              {GUEST_DOCUMENT_KINDS.map((item) => (
                <option key={item} value={item}>
                  {GUEST_DOCUMENT_KIND_LABELS[item]}
                </option>
              ))}
            </NativeSelect>
          }
        />
        {form.kind === 'AADHAAR' ? (
          <>
            <p>Aadhaar is recorded as the last four digits only. A scan is not kept.</p>
            <Field
              label="Last four digits"
              control={
                <Input
                  value={form.last4}
                  maxLength={4}
                  onChange={(e) => setForm((prev) => ({ ...prev, last4: e.target.value }))}
                />
              }
            />
          </>
        ) : (
          <>
            <Field
              label="Number"
              control={
                <Input value={form.number} onChange={(e) => setForm((prev) => ({ ...prev, number: e.target.value }))} />
              }
            />
            <Field
              label="Issuing country"
              control={
                <Input
                  value={form.issuingCountry}
                  maxLength={2}
                  onChange={(e) => setForm((prev) => ({ ...prev, issuingCountry: e.target.value }))}
                />
              }
            />
            {NATIONALITY_KINDS.has(form.kind) ? (
              <Field
                label="Nationality"
                control={
                  <Input
                    value={form.nationality}
                    maxLength={2}
                    onChange={(e) => setForm((prev) => ({ ...prev, nationality: e.target.value }))}
                  />
                }
              />
            ) : null}
            {form.kind === 'VISA' ? (
              <Field
                label="Visa type"
                control={
                  <Input
                    value={form.visaType}
                    maxLength={40}
                    onChange={(e) => setForm((prev) => ({ ...prev, visaType: e.target.value }))}
                  />
                }
              />
            ) : null}
          </>
        )}
        <Field
          label="Date of birth"
          control={
            <Input
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm((prev) => ({ ...prev, dateOfBirth: e.target.value }))}
            />
          }
        />
        <Field
          label="Issue date"
          control={
            <Input
              type="date"
              value={form.issueDate}
              onChange={(e) => setForm((prev) => ({ ...prev, issueDate: e.target.value }))}
            />
          }
        />
        <Field
          label="Expires"
          control={
            <Input
              type="date"
              value={form.expiryDate}
              onChange={(e) => setForm((prev) => ({ ...prev, expiryDate: e.target.value }))}
            />
          }
        />
        <Field
          label="Place of issue"
          control={
            <Input
              value={form.placeOfIssue}
              maxLength={80}
              onChange={(e) => setForm((prev) => ({ ...prev, placeOfIssue: e.target.value }))}
            />
          }
        />
        {form.kind === 'AADHAAR' ? null : (
          <Field
            label="Scan"
            hint="JPEG, PNG, or PDF. Optional."
            control={
              <FileInput
                key={fileEpoch}
                accept="image/jpeg,image/png,application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) {
                    setScan(null);
                    return;
                  }
                  void readScanFile(file).then(setScan);
                }}
              />
            }
          />
        )}
      </div>
    </Dialog>
  );
}

function ViewDocumentDialog({
  open,
  onClose,
  propertyId,
  guestRef,
  summary,
  canWrite,
  onAttached,
}: {
  open: boolean;
  onClose: () => void;
  propertyId: string;
  guestRef: string;
  summary: DocSummary | null;
  canWrite: boolean;
  onAttached: (message: string) => void;
}) {
  const format = useFormat();
  const queryClient = useQueryClient();
  const documentId = summary?.id ?? '';
  const detail = useQuery({
    queryKey: documentKey(propertyId, guestRef, documentId || 'none'),
    queryFn: () => api.readGuestDocument(propertyId, guestRef, documentId),
    enabled: open && Boolean(documentId),
    gcTime: 0,
    staleTime: 0,
  });
  const kind = (isDocRead(detail.data) ? detail.data.kind : summary?.kind) ?? '';
  const hasScan = isDocRead(detail.data) ? detail.data.hasScan : Boolean(summary?.hasScan);
  const contentType = summary?.scanContentType ?? '';
  const image = hasScan && contentType.startsWith('image/');
  const pdf = hasScan && contentType === 'application/pdf';
  const scan = useQuery({
    queryKey: scanKey(propertyId, guestRef, documentId || 'none'),
    queryFn: () => api.getGuestDocumentScan(propertyId, guestRef, documentId),
    enabled: open && Boolean(documentId) && hasScan && (image || pdf),
    gcTime: 0,
    staleTime: 0,
  });
  const [url, setUrl] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !image || !isScanOk(scan.data)) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blobFromBytes(scan.data.bytes, scan.data.contentType));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [open, image, scan.data]);

  const attach = useMutation({
    mutationFn: async (file: ScanFile) => {
      const result = await api.attachGuestDocumentScan(
        propertyId,
        guestRef,
        documentId,
        file,
        `guest-scan:${documentId}:${crypto.randomUUID()}`,
      );
      assertWritten(result, 'scan');
    },
    onSuccess: async () => {
      setScanError(null);
      onAttached('Scan attached.');
      await queryClient.invalidateQueries({ queryKey: documentsKey(propertyId, guestRef) });
      await queryClient.invalidateQueries({ queryKey: documentKey(propertyId, guestRef, documentId) });
      await queryClient.invalidateQueries({ queryKey: scanKey(propertyId, guestRef, documentId) });
    },
    onError: (err) => {
      setScanError(classifiedUserMessage(asClassified(err), { fallback: 'Could not attach the scan.' }));
    },
  });

  const fields = isDocRead(detail.data) ? detail.data.fields : null;
  const kindLabel = GUEST_DOCUMENT_KIND_LABELS[kind as GuestDocumentKind] ?? kind;
  const loadedScan = isScanOk(scan.data) ? scan.data : null;
  const showImage = Boolean(url && image && contentType.startsWith('image/'));
  const showPdf = Boolean(pdf && loadedScan);

  return (
    <Dialog
      open={open}
      title="Identity document"
      onClose={onClose}
      data-testid="view-id-document"
      footer={
        <Button type="button" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="ui-stack">
        {detail.isPending ? <Skeleton label="Loading identity document" lines={4} /> : null}
        {detail.isError ? (
          <Alert intent="exception">
            {classifiedUserMessage(asClassified(detail.error), { fallback: 'Could not load this document.' })}
          </Alert>
        ) : null}
        {scanError ? <Alert intent="exception">{scanError}</Alert> : null}
        {kindLabel ? <StatField label="Kind" value={kindLabel} /> : null}
        {fields ? (
          <div className="ui-stat-grid">
            {FIELD_ROWS.map(([key, label]) => {
              const raw = fields[key];
              if (!raw) return null;
              return <StatField key={key} label={label} value={fieldValue(key, fields, format.date)} />;
            })}
          </div>
        ) : null}
        {(image || pdf) && scan.isPending ? <Skeleton label="Loading scan" lines={2} /> : null}
        {(image || pdf) && scan.isError ? (
          <Alert intent="exception">
            {classifiedUserMessage(asClassified(scan.error), { fallback: 'Could not load the scan.' })}
          </Alert>
        ) : null}
        {(image || pdf) && scan.data && !loadedScan && !scan.isPending ? (
          <Alert intent="exception">Could not load the scan.</Alert>
        ) : null}
        {showImage ? <img src={url ?? undefined} alt="Identity document" /> : null}
        {showPdf && loadedScan ? (
          <Button
            type="button"
            onClick={() => {
              downloadScan(loadedScan.bytes, loadedScan.contentType, `${kindLabel || 'identity-document'}.pdf`);
            }}
          >
            Download
          </Button>
        ) : null}
        {canWrite && kind !== 'AADHAAR' && documentId ? (
          <Field
            label={hasScan ? 'Replace scan' : 'Attach scan'}
            hint="JPEG, PNG, or PDF."
            control={
              <FileInput
                accept="image/jpeg,image/png,application/pdf"
                disabled={attach.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void readScanFile(file).then((next) => attach.mutate(next));
                }}
              />
            }
          />
        ) : null}
      </div>
    </Dialog>
  );
}

function PrefChecks<T extends string>({
  label,
  codes,
  labels,
  selected,
  onToggle,
}: {
  label: string;
  codes: readonly T[];
  labels: Record<T, string>;
  selected: readonly T[];
  onToggle: (code: T) => void;
}) {
  return (
    <div className="ui-stack">
      <p>{label}</p>
      {codes.map((code) => (
        <Field
          key={code}
          label={labels[code]}
          control={<Checkbox checked={selected.includes(code)} onChange={() => onToggle(code)} />}
        />
      ))}
    </div>
  );
}

export function GuestIdentityPanels({
  propertyId,
  guestRef,
  displayName,
  preferences,
  canWrite,
}: {
  propertyId: string;
  guestRef: string;
  displayName: string;
  preferences?: GuestPreferences;
  canWrite: boolean;
}) {
  const format = useFormat();
  const queryClient = useQueryClient();
  const orgId = tenant.orgId;
  const list = useGuestDocumentList(propertyId, guestRef);
  const consent = useQuery({
    queryKey: consentKey(propertyId, guestRef),
    queryFn: () => api.getGuestConsent(propertyId, guestRef),
    enabled: Boolean(guestRef),
  });
  const settings = useQuery({
    queryKey: ['org-guest-settings', orgId],
    queryFn: () => api.getGuestSettings(orgId),
  });
  const notice = settings.data?.value.consentNoticeVersion ?? null;
  const [docSaved, setDocSaved] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removeReason, setRemoveReason] = useState('');
  const [prefs, setPrefs] = useState<GuestPreferences>(preferences ?? {});
  const [prefNotice, setPrefNotice] = useState<string | null>(null);
  const [consentPurpose, setConsentPurpose] = useState<ConsentPurpose>('MARKETING_EMAIL');
  const [consentSource, setConsentSource] = useState<ConsentSource>('DESK');
  const [consentDialog, setConsentDialog] = useState<'GRANTED' | 'WITHDRAWN' | null>(null);
  const [consentNotice, setConsentNotice] = useState<string | null>(null);

  useEffect(() => {
    setPrefs(preferences ?? {});
  }, [preferences]);

  const remove = useMutation({
    mutationFn: async () => {
      if (!removeId) throw new Error('missing');
      const result = await api.removeGuestDocument(
        propertyId,
        guestRef,
        removeId,
        removeReason.trim(),
        `guest-doc-remove:${removeId}:${crypto.randomUUID()}`,
      );
      assertWritten(result, 'remove');
    },
    onSuccess: async () => {
      setRemoveId(null);
      setRemoveReason('');
      setDocError(null);
      setDocSaved('Identity document removed.');
      await queryClient.invalidateQueries({ queryKey: documentsKey(propertyId, guestRef) });
    },
    onError: (err) => {
      setDocSaved(null);
      setDocError(classifiedUserMessage(asClassified(err), { fallback: 'Could not remove the document.' }));
    },
  });

  const savePrefs = useMutation({
    mutationFn: () =>
      api.updateGuest(
        propertyId,
        guestRef,
        { displayName, preferences: prefs },
        `guest-prefs:${guestRef}:${crypto.randomUUID()}`,
      ),
    onSuccess: async (result) => {
      if (!result.body || typeof result.body !== 'object' || !('ok' in result.body) || result.body.ok !== true) {
        setPrefNotice(classifiedUserMessage(result.classified, { fallback: 'Could not save preferences.' }));
        return;
      }
      setPrefNotice('Preferences saved.');
      await queryClient.invalidateQueries({ queryKey: ['guest', propertyId, guestRef] });
    },
  });

  const recordConsent = useMutation({
    mutationFn: async (status: 'GRANTED' | 'WITHDRAWN') => {
      const result = await api.updateGuestConsent(
        propertyId,
        guestRef,
        { purpose: consentPurpose, status, source: consentSource },
        `guest-consent:${guestRef}:${status}:${crypto.randomUUID()}`,
      );
      assertWritten(result, 'consent');
    },
    onSuccess: async () => {
      setConsentDialog(null);
      setConsentNotice('Consent recorded.');
      await queryClient.invalidateQueries({ queryKey: consentKey(propertyId, guestRef) });
    },
    onError: (err) => {
      setConsentNotice(classifiedUserMessage(asClassified(err), { fallback: 'Could not record consent.' }));
    },
  });

  const docs = documentsOf(list.data);
  const viewing = docs.find((doc) => doc.id === viewId) ?? null;

  function toggle<T extends string>(group: keyof GuestPreferences, code: T) {
    setPrefs((prev) => {
      const current = (prev[group] as T[] | undefined) ?? [];
      const next = current.includes(code) ? current.filter((item) => item !== code) : [...current, code];
      return { ...prev, [group]: next };
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Identity documents</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="ui-stack">
            {docSaved ? <Alert intent="settled">{docSaved}</Alert> : null}
            {docError ? <Alert intent="exception">{docError}</Alert> : null}
            {list.isPending ? <Skeleton label="Loading identity documents" lines={3} /> : null}
            {list.isError ? (
              <Alert intent="exception">
                {classifiedUserMessage(asClassified(list.error), {
                  fallback: 'Could not load identity documents.',
                })}
              </Alert>
            ) : null}
            {list.isSuccess && docs.length === 0 ? (
              <EmptyState title="No identity document recorded at this property." />
            ) : null}
            {list.isSuccess && docs.length > 0 ? (
              <DataTable data-testid="guest-documents">
                <caption>Identity documents at this property.</caption>
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell>Kind</DataTableHeaderCell>
                    <DataTableHeaderCell>Recorded</DataTableHeaderCell>
                    <DataTableHeaderCell>Scan</DataTableHeaderCell>
                    <DataTableHeaderCell>Actions</DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {docs.map((doc) => (
                    <DataTableRow key={doc.id}>
                      <DataTableCell>
                        {GUEST_DOCUMENT_KIND_LABELS[doc.kind as GuestDocumentKind] ?? doc.kind}
                      </DataTableCell>
                      <DataTableCell>{format.instantDate(doc.createdAt)}</DataTableCell>
                      <DataTableCell>{doc.hasScan ? 'Yes' : 'No'}</DataTableCell>
                      <DataTableCell>
                        <RowActions>
                          <Button type="button" size="sm" onClick={() => setViewId(doc.id)}>
                            View
                          </Button>
                          {canWrite ? (
                            <Button type="button" size="sm" onClick={() => setRemoveId(doc.id)}>
                              Remove
                            </Button>
                          ) : null}
                        </RowActions>
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            ) : null}
            {canWrite ? (
              <Button type="button" onClick={() => setAddOpen(true)}>
                Add document
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="ui-stack">
            {prefNotice ? (
              <Alert intent={prefNotice === 'Preferences saved.' ? 'settled' : 'exception'}>{prefNotice}</Alert>
            ) : null}
            <GuestPreferenceBadges preferences={preferences} />
            <PrefChecks
              label="Room"
              codes={ROOM_PREFERENCE_CODES}
              labels={ROOM_PREFERENCE_LABELS}
              selected={prefs.room ?? []}
              onToggle={(code) => toggle('room', code)}
            />
            <PrefChecks
              label="Bedding"
              codes={BEDDING_PREFERENCE_CODES}
              labels={BEDDING_PREFERENCE_LABELS}
              selected={prefs.bedding ?? []}
              onToggle={(code) => toggle('bedding', code)}
            />
            <PrefChecks
              label="Dietary"
              codes={DIETARY_PREFERENCE_CODES}
              labels={DIETARY_PREFERENCE_LABELS}
              selected={prefs.dietary ?? []}
              onToggle={(code) => toggle('dietary', code)}
            />
            <PrefChecks
              label="Accessibility"
              codes={ACCESSIBILITY_CODES}
              labels={ACCESSIBILITY_LABELS}
              selected={prefs.accessibility ?? []}
              onToggle={(code) => toggle('accessibility', code)}
            />
            <Field
              label="Other"
              control={
                <Input
                  value={prefs.other ?? ''}
                  maxLength={200}
                  onChange={(e) => setPrefs((prev) => ({ ...prev, other: e.target.value }))}
                />
              }
            />
            {canWrite ? (
              <Button type="button" disabled={savePrefs.isPending} onClick={() => savePrefs.mutate()}>
                Save preferences
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Consent</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="ui-stack">
            {consentNotice ? (
              <Alert intent={consentNotice === 'Consent recorded.' ? 'settled' : 'exception'}>{consentNotice}</Alert>
            ) : null}
            {!notice ? (
              <Alert intent="attention">
                Consent is unavailable until a notice version is set.{' '}
                <Link to="/settings/guests">Settings → Guests</Link>
              </Alert>
            ) : null}
            <ul>
              {CONSENT_PURPOSES.map((purpose) => {
                const row = consent.data?.current?.[purpose];
                const recorded = row
                  ? `${consentWord(row.status)} · notice ${row.noticeVersion} · ${format.instantDate(row.recordedAt)}`
                  : 'Not recorded';
                return (
                  <li key={purpose}>
                    {CONSENT_PURPOSE_LABELS[purpose]}: {recorded}
                  </li>
                );
              })}
            </ul>
            {consent.data?.history && consent.data.history.length > 0 ? (
              <ul>
                {consent.data.history.map((row) => {
                  const purpose =
                    row.purpose in CONSENT_PURPOSE_LABELS
                      ? CONSENT_PURPOSE_LABELS[row.purpose as ConsentPurpose]
                      : row.purpose;
                  const place = row.recordedHere
                    ? 'Recorded at this property'
                    : 'Recorded at another property in your group';
                  return (
                    <li key={row.id}>
                      {purpose}: {consentWord(row.status)} · notice {row.noticeVersion} ·{' '}
                      {format.instantDate(row.recordedAt)} · {place}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {canWrite ? (
              <div className="ui-row">
                <Field
                  label="Purpose"
                  control={
                    <NativeSelect
                      value={consentPurpose}
                      onChange={(e) => setConsentPurpose(e.target.value as ConsentPurpose)}
                    >
                      {CONSENT_PURPOSES.map((purpose) => (
                        <option key={purpose} value={purpose}>
                          {CONSENT_PURPOSE_LABELS[purpose]}
                        </option>
                      ))}
                    </NativeSelect>
                  }
                />
                <Field
                  label="Source"
                  control={
                    <NativeSelect
                      value={consentSource}
                      onChange={(e) => setConsentSource(e.target.value as ConsentSource)}
                    >
                      {CONSENT_SOURCES.map((source) => (
                        <option key={source} value={source}>
                          {CONSENT_SOURCE_LABELS[source]}
                        </option>
                      ))}
                    </NativeSelect>
                  }
                />
                <Button type="button" disabled={!notice} onClick={() => setConsentDialog('GRANTED')}>
                  Grant
                </Button>
                <Button type="button" disabled={!notice} onClick={() => setConsentDialog('WITHDRAWN')}>
                  Withdraw
                </Button>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <RecordIdDocumentDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        propertyId={propertyId}
        guestRef={guestRef}
        onRecorded={() => {
          setDocError(null);
          setDocSaved('Identity document recorded.');
        }}
      />
      <ViewDocumentDialog
        open={viewId !== null}
        onClose={() => setViewId(null)}
        propertyId={propertyId}
        guestRef={guestRef}
        summary={viewing}
        canWrite={canWrite}
        onAttached={(message) => {
          setDocError(null);
          setDocSaved(message);
        }}
      />
      <Dialog
        open={removeId !== null}
        title="Remove identity document"
        onClose={() => {
          setRemoveId(null);
          setRemoveReason('');
        }}
        data-testid="remove-id-document"
        footer={
          <>
            <Button
              type="button"
              onClick={() => {
                setRemoveId(null);
                setRemoveReason('');
              }}
            >
              Cancel
            </Button>{' '}
            <Button
              type="button"
              intent="destructive"
              disabled={removeReason.trim().length < 1 || remove.isPending}
              onClick={() => remove.mutate()}
            >
              Remove
            </Button>
          </>
        }
      >
        <Field
          label="Reason"
          control={<Input value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} />}
        />
      </Dialog>
      <Dialog
        open={consentDialog !== null}
        title={consentDialog === 'WITHDRAWN' ? 'Withdraw consent' : 'Grant consent'}
        onClose={() => setConsentDialog(null)}
        footer={
          <>
            <Button type="button" onClick={() => setConsentDialog(null)}>
              Cancel
            </Button>{' '}
            <Button
              type="button"
              intent={consentDialog === 'WITHDRAWN' ? 'destructive' : 'primary'}
              disabled={recordConsent.isPending || !consentDialog}
              onClick={() => {
                if (consentDialog) recordConsent.mutate(consentDialog);
              }}
            >
              {consentDialog === 'WITHDRAWN' ? 'Withdraw' : 'Grant'}
            </Button>
          </>
        }
      >
        <p>
          {CONSENT_PURPOSE_LABELS[consentPurpose]} from {CONSENT_SOURCE_LABELS[consentSource]}. Notice {notice}.
        </p>
      </Dialog>
    </>
  );
}
