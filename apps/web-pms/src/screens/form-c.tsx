import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  FORM_C_GENDERS,
  FORM_C_KIND_LABELS,
  FORM_C_MAX_PER_RESERVATION,
  FORM_C_REFERENCE_MAX,
  FORM_C_REFERENCE_PATTERN,
  FORM_C_REMOVE_REASON_MAX,
  FORM_C_STATUS_LABELS,
  type FormCKind,
  type FormCPersonFields,
  type FormCRegisterFilter,
  type FormCRegisterRow,
  type GuestDocumentFields,
} from '@hospai/contracts';
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
  Dialog,
  EmptyState,
  Field,
  FieldGroup,
  Input,
  NativeSelect,
  RowActions,
  Skeleton,
  StatField,
  type AlertIntent,
} from '@hospai/ui-kit';
import { hasPropertyPermission } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { documentKey, documentsKey, useGuestDocumentList } from './guest-identity.js';

/** Form C is an India duty. The property read carries the flag; every surface hangs off it. */
export function useFormCApplicable(): boolean {
  const propertyId = tenant.propertyId;
  const q = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api.getProperty(propertyId),
    staleTime: 60_000,
    retry: false,
  });
  return q.data?.formCApplicable === true;
}

export function formCRegisterKey(propertyId: string, filter: FormCRegisterFilter) {
  return ['form-c-register', propertyId, filter] as const;
}

export function reservationFormCKey(propertyId: string, reservationId: string) {
  return ['reservation-form-c', propertyId, reservationId] as const;
}

export function formCPersonKey(propertyId: string, recordId: string) {
  return ['form-c-person', propertyId, recordId] as const;
}

/** Every Form C write refreshes the stay's rows and every register filter. */
export function invalidateFormC(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  propertyId: string,
  reservationId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: ['reservation-form-c', propertyId, reservationId] });
  void queryClient.invalidateQueries({ queryKey: ['form-c-register', propertyId] });
}

function bodyErrorCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === 'string') return err;
  }
  return null;
}

function formCMessage(err: unknown, fallback: string): string {
  const classified = asClassified(err);
  if (bodyErrorCode(classified.body) === 'limit_exceeded') {
    return `A stay holds up to ${FORM_C_MAX_PER_RESERVATION} Form C records.`;
  }
  if (bodyErrorCode(classified.body) === 'validation_error') {
    return 'Check the details. A required field is empty or a value is not valid.';
  }
  return classifiedUserMessage(classified, { fallback });
}

// ---------------------------------------------------------------------------
// The details form
// ---------------------------------------------------------------------------

const TEXT_KEYS = [
  'surname',
  'givenNames',
  'dateOfBirth',
  'nationality',
  'passportNumber',
  'passportPlaceOfIssue',
  'passportIssueDate',
  'passportExpiryDate',
  'visaNumber',
  'visaType',
  'visaPlaceOfIssue',
  'visaIssueDate',
  'visaExpiryDate',
  'arrivedInIndiaOn',
  'portOfArrival',
  'arrivedFrom',
  'arrivedFromCountry',
  'nextDestination',
  'nextDestinationCountry',
  'addressAbroad',
  'contactInIndia',
  'purposeOfVisit',
  'remarks',
] as const;
type TextKey = (typeof TEXT_KEYS)[number];

export type FormCForm = Record<TextKey, string> & {
  gender: '' | 'F' | 'M' | 'X';
  employedInIndia: '' | 'yes' | 'no';
};

export function emptyFormCForm(): FormCForm {
  const form = { gender: '', employedInIndia: '' } as FormCForm;
  for (const key of TEXT_KEYS) form[key] = '';
  return form;
}

export function formCFormFromFields(fields: FormCPersonFields): FormCForm {
  const form = emptyFormCForm();
  for (const key of TEXT_KEYS) {
    const value = fields[key];
    if (typeof value === 'string') form[key] = value;
  }
  form.gender = fields.gender;
  form.employedInIndia = fields.employedInIndia === undefined ? '' : fields.employedInIndia ? 'yes' : 'no';
  return form;
}

/** Trimmed, blanks dropped. The server parses again and is the authority. */
export function formCFieldsFromForm(form: FormCForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of TEXT_KEYS) {
    const value = form[key].trim();
    if (value) out[key] = value;
  }
  if (form.gender) out.gender = form.gender;
  if (form.employedInIndia) out.employedInIndia = form.employedInIndia === 'yes';
  return out;
}

const ALPHA2 = /^[A-Za-z]{2}$/;

export function formCReady(form: FormCForm): boolean {
  return Boolean(
    form.surname.trim() &&
      form.gender &&
      form.dateOfBirth &&
      ALPHA2.test(form.nationality.trim()) &&
      form.passportNumber.trim(),
  );
}

/**
 * The booked guest's details, from the newest live PASSPORT and VISA documents.
 * Only the Form C fields that a document carries are mapped. The clerk reviews and saves.
 */
export function prefillFromDocuments(
  passport: GuestDocumentFields | null,
  visa: GuestDocumentFields | null,
): Partial<FormCForm> {
  const out: Partial<FormCForm> = {};
  if (passport) {
    if (passport.number) out.passportNumber = passport.number;
    if (passport.nationality) out.nationality = passport.nationality;
    if (passport.dateOfBirth) out.dateOfBirth = passport.dateOfBirth;
    if (passport.issueDate) out.passportIssueDate = passport.issueDate;
    if (passport.expiryDate) out.passportExpiryDate = passport.expiryDate;
    if (passport.placeOfIssue) out.passportPlaceOfIssue = passport.placeOfIssue;
  }
  if (visa) {
    if (visa.number) out.visaNumber = visa.number;
    if (visa.visaType) out.visaType = visa.visaType;
    if (visa.issueDate) out.visaIssueDate = visa.issueDate;
    if (visa.expiryDate) out.visaExpiryDate = visa.expiryDate;
    if (visa.placeOfIssue) out.visaPlaceOfIssue = visa.placeOfIssue;
  }
  return out;
}

type DocSummary = { id: string; kind: string };

function docFields(data: unknown): GuestDocumentFields | null {
  if (!data || typeof data !== 'object') return null;
  const fields = (data as { fields?: unknown }).fields;
  return fields && typeof fields === 'object' ? (fields as GuestDocumentFields) : null;
}

const FIELD_LABELS: Record<TextKey, string> = {
  surname: 'Surname',
  givenNames: 'Given names',
  dateOfBirth: 'Date of birth',
  nationality: 'Nationality (2-letter code)',
  passportNumber: 'Passport number',
  passportPlaceOfIssue: 'Passport place of issue',
  passportIssueDate: 'Passport issue date',
  passportExpiryDate: 'Passport expiry date',
  visaNumber: 'Visa number',
  visaType: 'Visa type',
  visaPlaceOfIssue: 'Visa place of issue',
  visaIssueDate: 'Visa issue date',
  visaExpiryDate: 'Visa expiry date',
  arrivedInIndiaOn: 'Arrived in India on',
  portOfArrival: 'Port of arrival',
  arrivedFrom: 'Arrived from',
  arrivedFromCountry: 'Arrived from country (2-letter code)',
  nextDestination: 'Next destination',
  nextDestinationCountry: 'Next destination country (2-letter code)',
  addressAbroad: 'Address abroad',
  contactInIndia: 'Contact number in India',
  purposeOfVisit: 'Purpose of visit',
  remarks: 'Remarks',
};

const DATE_KEYS = new Set<TextKey>([
  'dateOfBirth',
  'passportIssueDate',
  'passportExpiryDate',
  'visaIssueDate',
  'visaExpiryDate',
  'arrivedInIndiaOn',
]);

const GENDER_LABELS: Record<(typeof FORM_C_GENDERS)[number], string> = {
  F: 'Female',
  M: 'Male',
  X: 'Other',
};

const DETAIL_MAX: Partial<Record<TextKey, number>> = {
  surname: 80,
  givenNames: 80,
  nationality: 2,
  passportNumber: 40,
  visaNumber: 40,
  visaType: 40,
  arrivedFromCountry: 2,
  nextDestinationCountry: 2,
  addressAbroad: 200,
  contactInIndia: 20,
  remarks: 200,
};

function TextField({
  form,
  name,
  setField,
  required,
}: {
  form: FormCForm;
  name: TextKey;
  setField: (key: TextKey, value: string) => void;
  required?: boolean;
}) {
  return (
    <Field
      label={FIELD_LABELS[name]}
      control={
        <Input
          type={DATE_KEYS.has(name) ? 'date' : 'text'}
          data-testid={`form-c-${name}`}
          value={form[name]}
          required={required}
          maxLength={DETAIL_MAX[name] ?? 80}
          onChange={(e) => setField(name, e.target.value)}
        />
      }
    />
  );
}

/**
 * Create or edit one person. `record` is the existing tracker row (edit, or the check-in row that
 * has no details yet); `null` adds a new person of `kind`.
 */
export function FormCDetailsDialog({
  reservationId,
  guestRef,
  record,
  kind,
  onClose,
  onSaved,
}: {
  reservationId: string;
  guestRef: string;
  record: FormCRegisterRow | null;
  kind: FormCKind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormCForm>(emptyFormCForm);
  const [loaded, setLoaded] = useState(!record?.detailsSaved);
  const [prefilled, setPrefilled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef<string | null>(null);
  const recordIdRef = useRef<string>(
    record?.recordId ??
      `${kind === 'BOOKED_GUEST' ? 'fcb' : 'fca'}_${crypto.randomUUID().replace(/-/g, '')}`,
  );

  const hasDetails = Boolean(record?.detailsSaved);
  const personQ = useQuery({
    queryKey: formCPersonKey(propertyId, record?.recordId ?? ''),
    queryFn: () => api.getFormCPerson(propertyId, record!.recordId),
    enabled: hasDetails,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });

  useEffect(() => {
    if (!hasDetails || loaded || !personQ.data) return;
    if (personQ.data.fields) setForm(formCFormFromFields(personQ.data.fields));
    setLoaded(true);
  }, [hasDetails, loaded, personQ.data]);

  // The booked guest's row with nothing saved yet starts from the ID documents on file.
  const wantsPrefill = kind === 'BOOKED_GUEST' && !hasDetails && Boolean(guestRef);
  useEffect(() => {
    if (!wantsPrefill || prefilled) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await queryClient.fetchQuery({
          queryKey: documentsKey(propertyId, guestRef),
          queryFn: () => api.listGuestDocuments(propertyId, guestRef),
          staleTime: 0,
        });
        const docs = (list.documents ?? []) as DocSummary[];
        const read = async (docKind: string): Promise<GuestDocumentFields | null> => {
          const doc = docs.find((d) => d.kind === docKind);
          if (!doc) return null;
          const detail = await queryClient.fetchQuery({
            queryKey: documentKey(propertyId, guestRef, doc.id),
            queryFn: () => api.readGuestDocument(propertyId, guestRef, doc.id),
            staleTime: 0,
            gcTime: 0,
          });
          return docFields(detail);
        };
        const mapped = prefillFromDocuments(await read('PASSPORT'), await read('VISA'));
        if (!cancelled) setForm((current) => ({ ...current, ...mapped }));
      } catch {
        // No documents, or none readable: the clerk types the details.
      } finally {
        if (!cancelled) setPrefilled(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wantsPrefill, prefilled, queryClient, propertyId, guestRef]);

  function setField(key: TextKey, value: string) {
    attemptRef.current = null;
    setForm((current) => ({ ...current, [key]: value }));
  }

  const save = useMutation({
    mutationFn: () => {
      attemptRef.current ??= crypto.randomUUID();
      return api.saveFormCPerson(
        propertyId,
        reservationId,
        {
          recordId: recordIdRef.current,
          kind,
          fields: formCFieldsFromForm(form) as unknown as FormCPersonFields,
        },
        `form-c-save:${recordIdRef.current}:${attemptRef.current}`,
      );
    },
    onSuccess: () => {
      invalidateFormC(queryClient, propertyId, reservationId);
      onSaved();
    },
    onError: (err) => setError(formCMessage(err, 'Could not save the Form C details.')),
  });

  const loadingExisting = hasDetails && !loaded && !personQ.isError;
  const title = record ? (hasDetails ? 'Edit Form C details' : 'Enter Form C details') : 'Add foreign national';

  return (
    <Dialog
      open
      wide
      title={title}
      onClose={onClose}
      data-testid="form-c-details-dialog"
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            intent="primary"
            data-testid="form-c-save"
            disabled={save.isPending || loadingExisting || !loaded || !formCReady(form)}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            Save details
          </Button>
        </>
      }
    >
      {personQ.isError ? (
        <Alert data-testid="form-c-details-error">
          {formCMessage(personQ.error, 'Could not load the saved details.')}
        </Alert>
      ) : null}
      {loadingExisting ? <Skeleton label="Loading details" lines={4} /> : null}
      {wantsPrefill && !prefilled ? <p className="muted">Reading the ID documents on file.</p> : null}
      {!loadingExisting && !personQ.isError ? (
        <>
          <FieldGroup legend="Guest">
            <TextField form={form} name="surname" setField={setField} required />
            <TextField form={form} name="givenNames" setField={setField} />
            <Field
              label="Gender"
              control={
                <NativeSelect
                  data-testid="form-c-gender"
                  value={form.gender}
                  onChange={(e) => {
                    attemptRef.current = null;
                    setForm({ ...form, gender: e.target.value as FormCForm['gender'] });
                  }}
                >
                  <option value="">Select</option>
                  {FORM_C_GENDERS.map((g) => (
                    <option key={g} value={g}>
                      {GENDER_LABELS[g]}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
            <TextField form={form} name="dateOfBirth" setField={setField} required />
            <TextField form={form} name="nationality" setField={setField} required />
          </FieldGroup>
          <FieldGroup legend="Passport">
            <TextField form={form} name="passportNumber" setField={setField} required />
            <TextField form={form} name="passportPlaceOfIssue" setField={setField} />
            <TextField form={form} name="passportIssueDate" setField={setField} />
            <TextField form={form} name="passportExpiryDate" setField={setField} />
          </FieldGroup>
          <FieldGroup legend="Visa">
            <TextField form={form} name="visaNumber" setField={setField} />
            <TextField form={form} name="visaType" setField={setField} />
            <TextField form={form} name="visaPlaceOfIssue" setField={setField} />
            <TextField form={form} name="visaIssueDate" setField={setField} />
            <TextField form={form} name="visaExpiryDate" setField={setField} />
          </FieldGroup>
          <FieldGroup legend="Journey">
            <TextField form={form} name="arrivedInIndiaOn" setField={setField} />
            <TextField form={form} name="portOfArrival" setField={setField} />
            <TextField form={form} name="arrivedFrom" setField={setField} />
            <TextField form={form} name="arrivedFromCountry" setField={setField} />
            <TextField form={form} name="nextDestination" setField={setField} />
            <TextField form={form} name="nextDestinationCountry" setField={setField} />
          </FieldGroup>
          <FieldGroup legend="Other">
            <TextField form={form} name="addressAbroad" setField={setField} />
            <TextField form={form} name="contactInIndia" setField={setField} />
            <TextField form={form} name="purposeOfVisit" setField={setField} />
            <Field
              label="Employed in India"
              control={
                <NativeSelect
                  data-testid="form-c-employedInIndia"
                  value={form.employedInIndia}
                  onChange={(e) => {
                    attemptRef.current = null;
                    setForm({ ...form, employedInIndia: e.target.value as FormCForm['employedInIndia'] });
                  }}
                >
                  <option value="">Not stated</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </NativeSelect>
              }
            />
            <TextField form={form} name="remarks" setField={setField} />
          </FieldGroup>
        </>
      ) : null}
      {error ? <Alert data-testid="form-c-save-error">{error}</Alert> : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// View for filing (audited read) and print
// ---------------------------------------------------------------------------

export function FormCViewDialog({
  recordId,
  onClose,
}: {
  recordId: string;
  onClose: () => void;
}) {
  const propertyId = tenant.propertyId;
  const { date, dateTime } = useFormat();
  const propertyQ = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api.getProperty(propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const personQ = useQuery({
    queryKey: formCPersonKey(propertyId, recordId),
    queryFn: () => api.getFormCPerson(propertyId, recordId),
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
  const person = personQ.data;
  const fields = person?.fields ?? null;
  const dateOrDash = (iso?: string) => (iso ? date(iso) : '—');
  const text = (value?: string) => value || '—';
  const place = (name?: string, country?: string) =>
    [name, country].filter(Boolean).join(', ') || '—';

  return (
    <Dialog
      open
      wide
      title="Form C"
      onClose={onClose}
      data-testid="form-c-view-dialog"
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Close
          </Button>
          <Button
            type="button"
            intent="primary"
            data-testid="form-c-print"
            disabled={!fields}
            onClick={() => window.print()}
          >
            Print
          </Button>
        </>
      }
    >
      {personQ.isLoading ? <Skeleton label="Loading Form C" lines={6} /> : null}
      {personQ.isError ? (
        <Alert data-testid="form-c-view-error">
          {formCMessage(personQ.error, 'Could not load the Form C details.')}
        </Alert>
      ) : null}
      {person && !fields ? (
        <EmptyState kind="empty" title="No details saved yet." description="Enter the details first." />
      ) : null}
      {person && fields ? (
        <div className="form-c-card print-doc" data-testid="form-c-card">
          <div className="form-c-card__head">
            <p className="form-c-card__title">Form C</p>
            {propertyQ.data?.property?.name ? (
              <p className="form-c-card__property">{propertyQ.data.property.name}</p>
            ) : null}
          </div>
          <div className="ui-stat-grid">
            <StatField label="Surname" value={fields.surname} />
            <StatField label="Given names" value={text(fields.givenNames)} />
            <StatField label="Gender" value={GENDER_LABELS[fields.gender]} />
            <StatField label="Date of birth" value={dateOrDash(fields.dateOfBirth)} />
            <StatField label="Nationality" value={fields.nationality} />
            <StatField label="Passport number" value={fields.passportNumber} />
            <StatField label="Passport place of issue" value={text(fields.passportPlaceOfIssue)} />
            <StatField label="Passport issued" value={dateOrDash(fields.passportIssueDate)} />
            <StatField label="Passport expires" value={dateOrDash(fields.passportExpiryDate)} />
            <StatField label="Visa number" value={text(fields.visaNumber)} />
            <StatField label="Visa type" value={text(fields.visaType)} />
            <StatField label="Visa place of issue" value={text(fields.visaPlaceOfIssue)} />
            <StatField label="Visa issued" value={dateOrDash(fields.visaIssueDate)} />
            <StatField label="Visa expires" value={dateOrDash(fields.visaExpiryDate)} />
            <StatField label="Arrived in India on" value={dateOrDash(fields.arrivedInIndiaOn)} />
            <StatField label="Port of arrival" value={text(fields.portOfArrival)} />
            <StatField label="Arrived from" value={place(fields.arrivedFrom, fields.arrivedFromCountry)} />
            <StatField
              label="Next destination"
              value={place(fields.nextDestination, fields.nextDestinationCountry)}
            />
            <StatField label="Address abroad" value={text(fields.addressAbroad)} />
            <StatField label="Contact number in India" value={text(fields.contactInIndia)} />
            <StatField label="Purpose of visit" value={text(fields.purposeOfVisit)} />
            <StatField
              label="Employed in India"
              value={fields.employedInIndia === undefined ? '—' : fields.employedInIndia ? 'Yes' : 'No'}
            />
            <StatField label="Remarks" value={text(fields.remarks)} />
            <StatField
              label="Arrived at this hotel"
              value={person.checkedInAt == null ? '—' : dateTime(person.checkedInAt)}
            />
            <StatField label="File by" value={dateTime(person.deadlineAt)} />
            <StatField
              label="Portal reference"
              value={person.filedReference ?? 'Not filed yet'}
            />
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Mark filed and remove
// ---------------------------------------------------------------------------

function MarkFiledDialog({
  recordId,
  reservationId,
  onClose,
  onDone,
}: {
  recordId: string;
  reservationId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const trimmed = reference.trim();
  const valid =
    trimmed.length >= 1 && trimmed.length <= FORM_C_REFERENCE_MAX && FORM_C_REFERENCE_PATTERN.test(trimmed);
  const filed = useMutation({
    mutationFn: () =>
      api.markFormCFiled(propertyId, recordId, trimmed, `form-c-filed:${recordId}:${trimmed}`),
    onSuccess: () => {
      invalidateFormC(queryClient, propertyId, reservationId);
      onDone();
    },
    onError: (err) => setError(formCMessage(err, 'Could not mark this Form C as filed.')),
  });
  return (
    <Dialog
      open
      title="Mark Form C filed"
      onClose={onClose}
      data-testid="form-c-filed-dialog"
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            intent="primary"
            data-testid="form-c-filed-confirm"
            disabled={!valid || filed.isPending}
            onClick={() => {
              setError(null);
              filed.mutate();
            }}
          >
            Mark filed
          </Button>
        </>
      }
    >
      <Field
        label="Portal reference"
        hint="The reference the government portal gave when you submitted this Form C."
        control={
          <Input
            data-testid="form-c-reference"
            value={reference}
            maxLength={FORM_C_REFERENCE_MAX}
            onChange={(e) => setReference(e.target.value)}
          />
        }
      />
      {error ? <Alert data-testid="form-c-filed-error">{error}</Alert> : null}
    </Dialog>
  );
}

function RemoveDialog({
  recordId,
  reservationId,
  onClose,
  onDone,
}: {
  recordId: string;
  reservationId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const trimmed = reason.trim();
  const removed = useMutation({
    mutationFn: () =>
      api.removeFormCPerson(propertyId, recordId, trimmed, `form-c-remove:${recordId}:${trimmed}`),
    onSuccess: () => {
      invalidateFormC(queryClient, propertyId, reservationId);
      onDone();
    },
    onError: (err) => setError(formCMessage(err, 'Could not remove this Form C record.')),
  });
  return (
    <Dialog
      open
      title="Remove this Form C record?"
      onClose={onClose}
      data-testid="form-c-remove-dialog"
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Keep
          </Button>
          <Button
            type="button"
            intent="destructive"
            data-testid="form-c-remove-confirm"
            disabled={!trimmed || removed.isPending}
            onClick={() => {
              setError(null);
              removed.mutate();
            }}
          >
            Remove record
          </Button>
        </>
      }
    >
      <p className="muted">
        The saved details are deleted. A filed record cannot be removed.
      </p>
      <Field
        label="Reason"
        control={
          <Input
            data-testid="form-c-remove-reason"
            value={reason}
            maxLength={FORM_C_REMOVE_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
          />
        }
      />
      {error ? <Alert data-testid="form-c-remove-error">{error}</Alert> : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Shared table row bits
// ---------------------------------------------------------------------------

export function formCStatusBadge(row: FormCRegisterRow) {
  if (row.status === 'FILED') return <Badge rung="settled">{FORM_C_STATUS_LABELS.FILED}</Badge>;
  return <Badge rung={row.overdue ? 'exception' : 'attention'}>{FORM_C_STATUS_LABELS.TO_FILE}</Badge>;
}

export function FormCNameCell({ row }: { row: FormCRegisterRow }) {
  if (row.detailsSaved) return <>{row.displayName ?? 'Name unavailable'}</>;
  return <span className="muted">Details needed</span>;
}

export function FormCDeadlineCell({ row }: { row: FormCRegisterRow }) {
  const { dateTime } = useFormat();
  return (
    <span className="ui-row">
      {dateTime(row.deadlineAt)}
      {row.overdue ? <Badge rung="exception">Overdue</Badge> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stay card panel
// ---------------------------------------------------------------------------

type PanelMessage = { intent: AlertIntent; text: string };
type PanelDialog =
  | { kind: 'details'; record: FormCRegisterRow | null; personKind: FormCKind }
  | { kind: 'view'; recordId: string }
  | { kind: 'filed'; recordId: string }
  | { kind: 'remove'; recordId: string };

export function FormCPanel({
  reservationId,
  guestRef,
  stayStatus,
}: {
  reservationId: string;
  guestRef: string;
  stayStatus: string;
}) {
  const propertyId = tenant.propertyId;
  const applicable = useFormCApplicable();
  const [dialog, setDialog] = useState<PanelDialog | null>(null);
  const [message, setMessage] = useState<PanelMessage | null>(null);

  const meQ = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const canWrite = Boolean(meQ.data && hasPropertyPermission(meQ.data, 'guests:write'));
  const canRead = Boolean(meQ.data && hasPropertyPermission(meQ.data, 'guests:read'));

  const listQ = useQuery({
    queryKey: reservationFormCKey(propertyId, reservationId),
    queryFn: () => api.getReservationFormC(propertyId, reservationId),
    enabled: applicable && canRead,
    retry: false,
  });

  if (!applicable || !canRead) return null;

  const rows = listQ.data?.rows ?? [];
  const inHouse = stayStatus === 'checked_in';
  const hasBooked = rows.some((r) => r.kind === 'BOOKED_GUEST');
  const full = rows.length >= FORM_C_MAX_PER_RESERVATION;
  const addBlocked = !inHouse
    ? 'A person can be added while the guest is checked in.'
    : full
      ? `A stay holds up to ${FORM_C_MAX_PER_RESERVATION} Form C records.`
      : null;

  function done(text: string) {
    setDialog(null);
    setMessage({ intent: 'settled', text });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Form C</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="muted">
          Each foreign national staying here is reported to the Bureau of Immigration within 24 hours
          of check-in. File on the government portal, then record the reference here.
        </p>
        {message ? <Alert intent={message.intent}>{message.text}</Alert> : null}
        {listQ.isError ? (
          <Alert data-testid="form-c-panel-error">
            {classifiedUserMessage(asClassified(listQ.error), {
              fallback: 'Could not load the Form C records.',
            })}
          </Alert>
        ) : listQ.isLoading ? (
          <Skeleton label="Loading Form C records" lines={2} />
        ) : rows.length === 0 ? (
          <EmptyState
            kind="empty"
            data-testid="form-c-panel-empty"
            title="No Form C records for this stay."
            description={
              inHouse
                ? 'A foreign guest on a passport gets one at check-in. Add any other foreign national staying in the room.'
                : undefined
            }
          />
        ) : (
          <DataTable data-testid="form-c-panel-table">
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Name</DataTableHeaderCell>
                <DataTableHeaderCell>Nationality</DataTableHeaderCell>
                <DataTableHeaderCell>Kind</DataTableHeaderCell>
                <DataTableHeaderCell>File by</DataTableHeaderCell>
                <DataTableHeaderCell>Status</DataTableHeaderCell>
                <DataTableHeaderCell>Actions</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => (
                <DataTableRow key={row.recordId} data-testid={`form-c-row-${row.recordId}`}>
                  <DataTableCell>
                    <FormCNameCell row={row} />
                  </DataTableCell>
                  <DataTableCell>{row.nationality ?? '—'}</DataTableCell>
                  <DataTableCell>{FORM_C_KIND_LABELS[row.kind]}</DataTableCell>
                  <DataTableCell>
                    <FormCDeadlineCell row={row} />
                  </DataTableCell>
                  <DataTableCell>
                    {formCStatusBadge(row)}
                    {row.filedReference ? <span className="muted"> {row.filedReference}</span> : null}
                  </DataTableCell>
                  <DataTableCell>
                    <RowActions>
                      {row.status === 'TO_FILE' && canWrite ? (
                        <Button
                          type="button"
                          size="sm"
                          data-testid={`form-c-edit-${row.recordId}`}
                          onClick={() =>
                            setDialog({ kind: 'details', record: row, personKind: row.kind })
                          }
                        >
                          {row.detailsSaved ? 'Edit' : 'Enter details'}
                        </Button>
                      ) : null}
                      {row.detailsSaved ? (
                        <Button
                          type="button"
                          size="sm"
                          data-testid={`form-c-view-${row.recordId}`}
                          onClick={() => setDialog({ kind: 'view', recordId: row.recordId })}
                        >
                          View for filing
                        </Button>
                      ) : null}
                      {row.status === 'TO_FILE' && row.detailsSaved && canWrite ? (
                        <Button
                          type="button"
                          size="sm"
                          data-testid={`form-c-filed-${row.recordId}`}
                          onClick={() => setDialog({ kind: 'filed', recordId: row.recordId })}
                        >
                          Mark filed
                        </Button>
                      ) : null}
                      {row.status === 'TO_FILE' && canWrite ? (
                        <Button
                          type="button"
                          size="sm"
                          intent="destructive"
                          data-testid={`form-c-remove-${row.recordId}`}
                          onClick={() => setDialog({ kind: 'remove', recordId: row.recordId })}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </RowActions>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        )}
        {canWrite ? (
          <div>
            <Button
              type="button"
              data-testid="form-c-add"
              disabled={addBlocked != null}
              onClick={() =>
                setDialog({ kind: 'details', record: null, personKind: 'ADDITIONAL' })
              }
            >
              Add foreign national
            </Button>
            {!hasBooked && inHouse && !full ? (
              <Button
                type="button"
                data-testid="form-c-add-booked"
                onClick={() => setDialog({ kind: 'details', record: null, personKind: 'BOOKED_GUEST' })}
              >
                Add the booked guest
              </Button>
            ) : null}
            {addBlocked ? <p className="muted">{addBlocked}</p> : null}
          </div>
        ) : null}
      </CardContent>
      {dialog?.kind === 'details' ? (
        <FormCDetailsDialog
          reservationId={reservationId}
          guestRef={guestRef}
          record={dialog.record}
          kind={dialog.personKind}
          onClose={() => setDialog(null)}
          onSaved={() => done('Form C details saved.')}
        />
      ) : null}
      {dialog?.kind === 'view' ? (
        <FormCViewDialog recordId={dialog.recordId} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'filed' ? (
        <MarkFiledDialog
          recordId={dialog.recordId}
          reservationId={reservationId}
          onClose={() => setDialog(null)}
          onDone={() => done('Form C marked as filed.')}
        />
      ) : null}
      {dialog?.kind === 'remove' ? (
        <RemoveDialog
          recordId={dialog.recordId}
          reservationId={reservationId}
          onClose={() => setDialog(null)}
          onDone={() => done('Form C record removed.')}
        />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Check-in notice

/**
 * One line on the check-in screen when the booked guest's passport shows a foreign nationality at
 * an India property. It reads the same audited document the identity card already shows.
 */
export function FormCCheckInNotice({ guestRef }: { guestRef: string }) {
  const propertyId = tenant.propertyId;
  const applicable = useFormCApplicable();
  const list = useGuestDocumentList(propertyId, guestRef, applicable);
  const documents = (list.data && 'documents' in list.data ? list.data.documents : []) as DocSummary[];
  const passport = documents.find((d) => d.kind === 'PASSPORT');
  const detail = useQuery({
    queryKey: passport
      ? documentKey(propertyId, guestRef, passport.id)
      : ['guest-document', propertyId, guestRef, 'none'],
    queryFn: () => api.readGuestDocument(propertyId, guestRef, passport!.id),
    enabled: applicable && Boolean(passport),
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
  const nationality = docFields(detail.data)?.nationality?.toUpperCase();
  if (!applicable || !nationality || nationality === 'IN') return null;
  return (
    <Alert intent="informational" data-testid="form-c-check-in-notice">
      A Form C is due within 24 hours of check-in. It will appear on the stay card.
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// Exceptions screen alert
// ---------------------------------------------------------------------------

export function FormCOverdueAlert() {
  const propertyId = tenant.propertyId;
  const applicable = useFormCApplicable();
  const q = useQuery({
    queryKey: formCRegisterKey(propertyId, 'overdue'),
    queryFn: () => api.getFormCRegister(propertyId, 'overdue'),
    enabled: applicable,
    retry: false,
  });
  if (!applicable || !q.isSuccess) return null;
  const count = q.data.rows.length;
  if (count === 0) return null;
  return (
    <Alert intent="attention" data-testid="form-c-overdue-alert">
      {count === 1
        ? '1 Form C record is past its 24-hour deadline. '
        : `${count} Form C records are past their 24-hour deadline. `}
      <Link to="/form-c?filter=overdue">Open the Form C register</Link>
    </Alert>
  );
}
