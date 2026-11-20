import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HK_INSPECTION_DEFECT_MAX,
  HK_INSPECTION_REMARKS_MAX,
  INSPECTION_ITEM_RESULTS,
  INSPECTION_RESULTS,
  isInspectionItemResult,
  scoreInspection,
  type InspectionItemResult,
  type InspectionListRow,
  type InspectionTemplate,
} from '@hospai/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
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
  PageHeader,
  RowActions,
  Skeleton,
  Textarea,
  Toolbar,
} from '@hospai/ui-kit';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { activeStaff, staffName, useStaffRoster } from './depth-shared.js';
import { INSPECTION_ITEM_RESULT_LABEL, INSPECTION_RESULT_LABEL } from './housekeeping-labels.js';
import { HousekeepingNav } from './housekeeping-nav.js';
import type { HousekeepingApi } from './housekeeping-types.js';
import { useBusinessDate } from './use-business-date.js';

type InspectionFilters = { from: string; to: string; result: string; roomId: string; inspectorRef: string };

export const NO_INSPECTION_FILTERS: InspectionFilters = {
  from: '',
  to: '',
  result: '',
  roomId: '',
  inspectorRef: '',
};

export function housekeepingInspectionsKey(propertyId: string, f: InspectionFilters) {
  return ['housekeeping-inspections', propertyId, f.from, f.to, f.result, f.roomId, f.inspectorRef] as const;
}

export function inspectionTemplatesKey(propertyId: string) {
  return ['housekeeping-inspection-templates', propertyId] as const;
}

type DateFormat = {
  dateHeading: (iso: string) => string;
  date?: (iso: string) => string;
  dateTime: (ms: number) => string;
};

function resultRung(result: 'pass' | 'fail'): 'settled' | 'exception' {
  return result === 'pass' ? 'settled' : 'exception';
}

export type InspectionPrefill = { roomId?: string; taskId?: string; attendantRef?: string | null };

/**
 * Record one scored inspection. The live score and result come from the same function the server
 * uses, so what the clerk sees is what is stored.
 */
export function RecordInspectionDialog({
  propertyId,
  api,
  canReadRoster,
  businessDate,
  prefill,
  formatError,
  onClose,
  onRecorded,
}: {
  propertyId: string;
  api: HousekeepingApi;
  canReadRoster: boolean;
  businessDate: string;
  prefill?: InspectionPrefill;
  formatError?: (err: unknown) => string;
  onClose: () => void;
  onRecorded: (inspection: InspectionListRow | null) => void;
}) {
  const queryClient = useQueryClient();
  const templatesQuery = useQuery({
    queryKey: inspectionTemplatesKey(propertyId),
    queryFn: () => api.getInspectionTemplates(propertyId),
  });
  const roomsQuery = useQuery({ queryKey: ['rooms', propertyId], queryFn: () => api.listRooms(propertyId) });
  const roster = useStaffRoster(api, propertyId, canReadRoster);
  const templates = useMemo(
    () => (templatesQuery.data?.templates ?? []).filter((t) => t.active),
    [templatesQuery.data],
  );
  const rooms = roomsQuery.data?.rooms ?? [];
  const inspectors = activeStaff(roster.staff);
  const attendants = activeStaff(roster.staff, 'housekeeper');

  const [templateId, setTemplateId] = useState('');
  const [roomId, setRoomId] = useState(prefill?.roomId ?? '');
  const [inspectorRef, setInspectorRef] = useState('');
  const [attendantRef, setAttendantRef] = useState(prefill?.attendantRef ?? '');
  const [answers, setAnswers] = useState<Record<string, InspectionItemResult | ''>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Defaults wait for the data rather than guess: the first active template, the first room.
  const template: InspectionTemplate | undefined =
    templates.find((t) => t.templateId === templateId) ?? templates[0];
  const effectiveRoom = roomId || rooms[0]?.roomId || '';

  const answered = template ? template.items.filter((i) => isInspectionItemResult(answers[i.itemId])) : [];
  const complete = Boolean(template) && answered.length === (template?.items.length ?? 0);
  const live = template
    ? scoreInspection(
        answered.map((i) => ({
          weight: i.weight,
          mandatory: i.mandatory,
          result: answers[i.itemId] as InspectionItemResult,
        })),
        template.passThreshold,
      )
    : null;

  const record = useMutation({
    mutationFn: () =>
      api.recordInspection(
        propertyId,
        {
          businessDate,
          roomId: effectiveRoom,
          templateId: template!.templateId,
          inspectorRef,
          ...(prefill?.taskId ? { taskId: prefill.taskId } : {}),
          ...(attendantRef ? { attendantRef } : {}),
          answers: template!.items.map((item) => ({
            itemId: item.itemId,
            result: answers[item.itemId] as InspectionItemResult,
            ...(notes[item.itemId]?.trim() ? { defectNote: notes[item.itemId]!.trim() } : {}),
          })),
          ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
        },
        crypto.randomUUID(),
      ),
    onSuccess: async (result) => {
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['housekeeping-inspections', propertyId] }),
        queryClient.invalidateQueries({ queryKey: ['housekeeping-tasks', propertyId] }),
        queryClient.invalidateQueries({ queryKey: ['housekeeping-task-stages', propertyId] }),
      ]);
      onRecorded(
        (result as { body?: { inspection?: InspectionListRow } } | undefined)?.body?.inspection ?? null,
      );
    },
    onError: (err) => setError(formatError?.(err) ?? 'Could not record the inspection.'),
  });

  const blocked = !canReadRoster
    ? 'Choosing the inspector needs access to the staff roster.'
    : templatesQuery.isSuccess && templates.length === 0
      ? 'There is no active inspection template. Add one under Settings, Housekeeping.'
      : null;
  const ready = Boolean(template) && Boolean(effectiveRoom) && Boolean(inspectorRef) && complete;

  function submit() {
    if (ready && !record.isPending) record.mutate();
  }

  let section = '';
  return (
    <Dialog
      open
      wide
      title="Record inspection"
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={!ready || record.isPending} onClick={submit}>
            Record inspection
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        data-testid="hk-inspection-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        {blocked ? <Alert intent="attention">{blocked}</Alert> : null}
        {templatesQuery.isError ? (
          <Alert intent="exception">
            {formatError?.(templatesQuery.error) ?? 'Could not load inspection templates.'}
          </Alert>
        ) : null}
        <FieldGroup inline>
          <Field
            label="Template"
            control={
              <NativeSelect
                aria-label="Inspection template"
                value={template?.templateId ?? ''}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setAnswers({});
                  setNotes({});
                }}
              >
                {templates.map((t) => (
                  <option key={t.templateId} value={t.templateId}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Room"
            control={
              <NativeSelect
                aria-label="Inspection room"
                value={effectiveRoom}
                disabled={Boolean(prefill?.roomId)}
                onChange={(e) => setRoomId(e.target.value)}
              >
                {rooms.map((r) => (
                  <option key={r.roomId} value={r.roomId}>
                    {r.code}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Inspector"
            control={
              <NativeSelect
                aria-label="Inspector"
                value={inspectorRef}
                onChange={(e) => setInspectorRef(e.target.value)}
              >
                <option value="">Choose the inspector</option>
                {inspectors.map((p) => (
                  <option key={p.staffId} value={p.staffId}>
                    {p.displayName ?? 'Unnamed staff member'}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Attendant (optional)"
            control={
              <NativeSelect
                aria-label="Inspection attendant"
                value={attendantRef}
                onChange={(e) => setAttendantRef(e.target.value)}
              >
                <option value="">Not recorded</option>
                {prefill?.attendantRef && !attendants.some((p) => p.staffId === prefill.attendantRef) ? (
                  <option value={prefill.attendantRef}>{staffName(roster.names, prefill.attendantRef)}</option>
                ) : null}
                {attendants.map((p) => (
                  <option key={p.staffId} value={p.staffId}>
                    {p.displayName ?? 'Unnamed attendant'}
                  </option>
                ))}
              </NativeSelect>
            }
          />
        </FieldGroup>
        {canReadRoster && roster.loaded && inspectors.length === 0 ? (
          <p className="muted" data-testid="hk-no-inspectors">
            Nobody is on the roster yet. Add staff in <Link to="/roster">Roster</Link>.
          </p>
        ) : null}

        {template ? (
          <>
            <div data-testid="hk-inspection-score" aria-live="polite">
              {answered.length === 0 ? (
                <p className="muted">Answer each item to see the score.</p>
              ) : (
                <p>
                  Score <strong>{live!.scorePercent} percent</strong> (passes at {template.passThreshold} percent).{' '}
                  {complete ? (
                    <Badge rung={resultRung(live!.result)}>{INSPECTION_RESULT_LABEL[live!.result]}</Badge>
                  ) : (
                    <span className="muted">
                      {answered.length} of {template.items.length} items answered.
                    </span>
                  )}
                </p>
              )}
            </div>
            <ul className="ui-stack" aria-label="Inspection items">
              {template.items.map((item) => {
                const head = item.section !== section ? item.section : null;
                section = item.section;
                const result = answers[item.itemId] ?? '';
                return (
                  <li key={item.itemId} className="ui-stack">
                    {head ? <strong>{head}</strong> : null}
                    <FieldGroup inline>
                      <Field
                        label={`${item.label}${item.mandatory ? ' (required to pass)' : ''}`}
                        hint={`Weight ${item.weight}`}
                        control={
                          <NativeSelect
                            aria-label={`${item.label} result`}
                            value={result}
                            onChange={(e) =>
                              setAnswers((prev) => ({
                                ...prev,
                                [item.itemId]: e.target.value as InspectionItemResult | '',
                              }))
                            }
                          >
                            <option value="">Not answered</option>
                            {INSPECTION_ITEM_RESULTS.map((r) => (
                              <option key={r} value={r}>
                                {INSPECTION_ITEM_RESULT_LABEL[r]}
                              </option>
                            ))}
                          </NativeSelect>
                        }
                      />
                      {result === 'fail' ? (
                        <Field
                          label="Defect note (optional)"
                          control={
                            <Input
                              aria-label={`${item.label} defect note`}
                              value={notes[item.itemId] ?? ''}
                              maxLength={HK_INSPECTION_DEFECT_MAX}
                              onChange={(e) => setNotes((prev) => ({ ...prev, [item.itemId]: e.target.value }))}
                            />
                          }
                        />
                      ) : null}
                    </FieldGroup>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        <Field
          label="Remarks (optional)"
          control={
            <Textarea
              aria-label="Inspection remarks"
              value={remarks}
              maxLength={HK_INSPECTION_REMARKS_MAX}
              onChange={(e) => setRemarks(e.target.value)}
            />
          }
        />
      </form>
    </Dialog>
  );
}

function InspectionDetailDialog({
  row,
  names,
  format,
  onClose,
}: {
  row: InspectionListRow;
  names: ReadonlyMap<string, string>;
  format: DateFormat;
  onClose: () => void;
}) {
  let section = '';
  return (
    <Dialog open wide title={`Inspection · Room ${row.roomCode}`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="ui-stack" data-testid="hk-inspection-detail">
        <p>
          {format.dateTime(row.createdAt)} · {row.templateName} · Inspector {staffName(names, row.inspectorRef)}
          {row.attendantRef ? ` · Attendant ${staffName(names, row.attendantRef)}` : ''}
        </p>
        <p>
          Score <strong>{row.scorePercent} percent</strong> (passes at {row.passThreshold} percent){' '}
          <Badge rung={resultRung(row.result)}>{INSPECTION_RESULT_LABEL[row.result]}</Badge>
        </p>
        {row.remarks ? <p>Remarks: {row.remarks}</p> : null}
        <DataTable>
          <DataTableHead>
            <DataTableRow>
              <DataTableHeaderCell>Item</DataTableHeaderCell>
              <DataTableHeaderCell>Weight</DataTableHeaderCell>
              <DataTableHeaderCell>Result</DataTableHeaderCell>
              <DataTableHeaderCell>Defect</DataTableHeaderCell>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {row.answers.map((a, i) => {
              const head = a.section !== section ? a.section : null;
              section = a.section;
              return (
                <DataTableRow key={`${a.section}-${a.label}-${i}`}>
                  <DataTableCell>
                    {head ? <strong>{head}: </strong> : null}
                    {a.label}
                    {a.mandatory ? ' (required to pass)' : ''}
                  </DataTableCell>
                  <DataTableCell>{a.weight}</DataTableCell>
                  <DataTableCell>
                    <Badge rung={a.result === 'fail' ? 'exception' : a.result === 'pass' ? 'settled' : 'neutral'}>
                      {INSPECTION_ITEM_RESULT_LABEL[a.result]}
                    </Badge>
                  </DataTableCell>
                  <DataTableCell>{a.defectNote ?? '—'}</DataTableCell>
                </DataTableRow>
              );
            })}
          </DataTableBody>
        </DataTable>
      </div>
    </Dialog>
  );
}

export function HousekeepingInspections({
  propertyId,
  defaultBusinessDate,
  api,
  canWrite,
  canReadRoster,
  subtitle,
  formatError,
  format,
}: {
  propertyId: string;
  defaultBusinessDate: string;
  api: HousekeepingApi;
  canWrite: boolean;
  canReadRoster: boolean;
  subtitle?: string;
  formatError?: (err: unknown) => string;
  format: DateFormat;
}) {
  const [businessDate] = useBusinessDate(defaultBusinessDate);
  const [filters, setFilters] = useState<InspectionFilters>(NO_INSPECTION_FILTERS);
  const [done, setDone] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [detail, setDetail] = useState<InspectionListRow | null>(null);
  const set = (patch: Partial<InspectionFilters>) => setFilters((prev) => ({ ...prev, ...patch }));

  const query = useQuery({
    queryKey: housekeepingInspectionsKey(propertyId, filters),
    queryFn: () =>
      api.getInspections(propertyId, {
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        ...(filters.result ? { result: filters.result } : {}),
        ...(filters.roomId ? { roomId: filters.roomId } : {}),
        ...(filters.inspectorRef ? { inspectorRef: filters.inspectorRef } : {}),
      }),
  });
  const roomsQuery = useQuery({ queryKey: ['rooms', propertyId], queryFn: () => api.listRooms(propertyId) });
  const roster = useStaffRoster(api, propertyId, canReadRoster);
  const rows = query.data?.inspections ?? [];
  const rooms = roomsQuery.data?.rooms ?? [];
  const anyFilter = Boolean(filters.from || filters.to || filters.result || filters.roomId || filters.inspectorRef);
  const dateOf = format.date ?? format.dateHeading;

  return (
    <div className="ui-page-stack">
      <PageHeader
        title="Inspections"
        subtitle={subtitle ?? <>{businessDate ? format.dateHeading(businessDate) : ''} · scored room inspections</>}
      />
      <HousekeepingNav view="inspections" />
      {done ? (
        <Alert intent="settled" data-testid="hk-inspection-settled">
          {done}
        </Alert>
      ) : null}
      {!canWrite ? <Alert intent="informational">You can view inspections but not record them.</Alert> : null}
      <Card>
        <Toolbar>
          <Field
            size="xs"
            label="From"
            control={
              <Input
                type="date"
                aria-label="Inspections from"
                value={filters.from}
                onChange={(e) => set({ from: e.target.value })}
              />
            }
          />
          <Field
            size="xs"
            label="To"
            control={
              <Input
                type="date"
                aria-label="Inspections to"
                value={filters.to}
                onChange={(e) => set({ to: e.target.value })}
              />
            }
          />
          <Field
            size="sm"
            label="Result"
            control={
              <NativeSelect
                aria-label="Inspection result"
                value={filters.result}
                onChange={(e) => set({ result: e.target.value })}
              >
                <option value="">All</option>
                {INSPECTION_RESULTS.map((r) => (
                  <option key={r} value={r}>
                    {INSPECTION_RESULT_LABEL[r]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            size="sm"
            label="Room"
            control={
              <NativeSelect
                aria-label="Inspection room filter"
                value={filters.roomId}
                onChange={(e) => set({ roomId: e.target.value })}
              >
                <option value="">All</option>
                {rooms.map((r) => (
                  <option key={r.roomId} value={r.roomId}>
                    {r.code}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          {canReadRoster ? (
            <Field
              size="sm"
              label="Inspector"
              control={
                <NativeSelect
                  aria-label="Inspector filter"
                  value={filters.inspectorRef}
                  onChange={(e) => set({ inspectorRef: e.target.value })}
                >
                  <option value="">All</option>
                  {activeStaff(roster.staff).map((p) => (
                    <option key={p.staffId} value={p.staffId}>
                      {p.displayName ?? 'Unnamed staff member'}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
          ) : null}
          <Button type="button" intent="primary" disabled={!canWrite} onClick={() => setRecording(true)}>
            Record inspection
          </Button>
        </Toolbar>

        <CardContent flush>
          {query.isLoading ? <Skeleton label="Loading inspections" /> : null}
          {query.isError ? (
            <Alert intent="exception">{formatError?.(query.error) ?? 'Could not load inspections.'}</Alert>
          ) : null}
          {query.isSuccess && rows.length === 0 && !anyFilter ? (
            <EmptyState
              kind="empty"
              title="No inspections recorded."
              description={canWrite ? 'Use Record inspection to add one.' : undefined}
            />
          ) : null}
          {query.isSuccess && rows.length === 0 && anyFilter ? (
            <EmptyState kind="nomatch" title="No inspections match these filters." />
          ) : null}
          {query.data?.truncated ? (
            <Alert intent="attention">Only the first 500 inspections are shown. Narrow the filters.</Alert>
          ) : null}
          {rows.length > 0 ? (
            <DataTable data-testid="hk-inspections">
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Date</DataTableHeaderCell>
                  <DataTableHeaderCell>Room</DataTableHeaderCell>
                  <DataTableHeaderCell>Template</DataTableHeaderCell>
                  <DataTableHeaderCell>Inspector</DataTableHeaderCell>
                  <DataTableHeaderCell>Attendant</DataTableHeaderCell>
                  <DataTableHeaderCell>Score</DataTableHeaderCell>
                  <DataTableHeaderCell>Result</DataTableHeaderCell>
                  <DataTableHeaderCell>Actions</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {rows.map((row) => (
                  <DataTableRow key={row.inspectionId}>
                    <DataTableCell>
                      <span className="ui-nowrap">{dateOf(row.businessDate)}</span>
                    </DataTableCell>
                    <DataTableCell>{row.roomCode}</DataTableCell>
                    <DataTableCell>{row.templateName}</DataTableCell>
                    <DataTableCell>{staffName(roster.names, row.inspectorRef)}</DataTableCell>
                    <DataTableCell>{staffName(roster.names, row.attendantRef)}</DataTableCell>
                    <DataTableCell>{row.scorePercent} percent</DataTableCell>
                    <DataTableCell>
                      <Badge rung={resultRung(row.result)}>{INSPECTION_RESULT_LABEL[row.result]}</Badge>
                    </DataTableCell>
                    <DataTableCell>
                      <RowActions>
                        <Button
                          type="button"
                          intent="ghost"
                          aria-label={`View inspection for ${row.roomCode}`}
                          onClick={() => setDetail(row)}
                        >
                          View
                        </Button>
                      </RowActions>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          ) : null}
        </CardContent>
      </Card>

      {recording ? (
        <RecordInspectionDialog
          propertyId={propertyId}
          api={api}
          canReadRoster={canReadRoster}
          businessDate={businessDate}
          formatError={formatError}
          onClose={() => setRecording(false)}
          onRecorded={(inspection) => {
            setRecording(false);
            setDone(
              inspection
                ? `Inspection of room ${inspection.roomCode} recorded: ${inspection.scorePercent} percent, ${INSPECTION_RESULT_LABEL[inspection.result].toLowerCase()}.`
                : 'Inspection recorded.',
            );
          }}
        />
      ) : null}
      {detail ? (
        <InspectionDetailDialog row={detail} names={roster.names} format={format} onClose={() => setDetail(null)} />
      ) : null}
    </div>
  );
}
