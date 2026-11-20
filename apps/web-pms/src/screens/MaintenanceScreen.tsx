import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_CATEGORY_LABEL,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_PRIORITY_LABEL,
  type MaintenancePriority,
  type MaintenanceStatus,
  type MaintenanceTicketRow,
} from '@hospai/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
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
  EmptyState,
  Field,
  FieldGroup,
  Input,
  NativeSelect,
  PageHeader,
  Skeleton,
  Textarea,
} from '@hospai/ui-kit';
import {
  BLOCK_TYPE_LABEL,
  OooBlockEditDialog,
  OooBlockForm,
  OooReleaseDialog,
  RoomOooHistoryDialog,
  blockTimes,
  invalidateOooViews,
  oooReleaseDates,
  type HousekeepingOooRange,
  type OooBlockInput,
} from '@hospai/pms-housekeeping/ui';
import { hasPropertyPermission, type PropertyMe } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { usePropertyActorLabel } from '../status/use-property-actor-label.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { FormDialog } from '../shell/FormDialog.js';
import { usePropertySubtitle } from '../shell/use-property-subtitle.js';
import { usePropertyTimeZone } from '../shell/PropertyFormat.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { oooReleaseEdit } from './maintenance-ooo-release.js';

type StatusFilter = 'active' | 'open' | 'in_progress' | 'closed' | 'all';

export function maintenanceTicketsQueryKey(
  propertyId: string,
  status: StatusFilter,
  roomId: string,
) {
  return ['maintenance-tickets', propertyId, status, roomId] as const;
}

function priorityRung(priority: MaintenancePriority): 'exception' | 'attention' | 'informational' {
  if (priority === 'emergency') return 'exception';
  if (priority === 'high') return 'attention';
  return 'informational';
}

const MAINTENANCE_STATUS_WORD: Record<MaintenanceStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
};

function formatAge(createdAt: number): string {
  const ms = Date.now() - createdAt;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return `${Math.max(1, Math.floor(ms / (60 * 1000)))} min`;
  if (hours < 48) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d`;
}

function truncateDescription(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function MaintenanceScreen() {
  const propertyId = tenant.propertyId;
  const { subtitle } = usePropertySubtitle('Tickets and out-of-order rooms');
  const timeZone = usePropertyTimeZone();
  const businessDate = timeZone ? propertyLocalToday(timeZone) : null;
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const roomFilter = '';
  const ticketsKey = maintenanceTicketsQueryKey(propertyId, statusFilter, roomFilter);

  const [reportRoomId, setReportRoomId] = useState('');
  const [reportTaskTypeId, setReportTaskTypeId] = useState('');
  const [reportCategory, setReportCategory] = useState('other');
  const [reportPriority, setReportPriority] = useState<MaintenancePriority>('medium');
  const [reportDescription, setReportDescription] = useState('');
  const [reportError, setReportError] = useState<string | null>(null);

  const [activeTicket, setActiveTicket] = useState<MaintenanceTicketRow | null>(null);
  const [dialogAssignee, setDialogAssignee] = useState<string>('');
  const [dialogPriority, setDialogPriority] = useState<MaintenancePriority>('medium');
  const [dialogDescription, setDialogDescription] = useState('');
  const [dialogChecklist, setDialogChecklist] = useState<boolean[]>([]);
  const [dialogResolveNote, setDialogResolveNote] = useState('');
  const [dialogReleaseRoom, setDialogReleaseRoom] = useState(true);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelNote, setCancelNote] = useState('');
  const [dialogReleaseReason, setDialogReleaseReason] = useState('');
  const [blockDialog, setBlockDialog] = useState<
    | { kind: 'edit' | 'release' | 'history'; roomId: string; roomCode: string; range: HousekeepingOooRange }
    | null
  >(null);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [blockDone, setBlockDone] = useState<string | null>(null);
  const { dateHeading, dateTime } = useFormat();

  const ticketsQuery = useQuery({
    queryKey: ticketsKey,
    queryFn: () => api.getMaintenanceTickets(propertyId, { status: statusFilter, roomId: roomFilter || undefined }),
    enabled: Boolean(propertyId),
  });

  const meQuery = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    staleTime: 60_000,
    retry: false,
    enabled: Boolean(propertyId),
  });
  const me = meQuery.data as PropertyMe | undefined;
  const canSetOoo = me ? hasPropertyPermission(me, 'inventory:write') : false;
  const actorLabel = usePropertyActorLabel(me ? hasPropertyPermission(me, 'staff:read') : false);

  const roomsQuery = useQuery({
    queryKey: ['rooms', propertyId],
    queryFn: () => api.listRooms(propertyId),
    enabled: Boolean(propertyId),
  });

  const taskTypesQuery = useQuery({
    queryKey: ['maintenance-task-types', propertyId],
    queryFn: () => api.getMaintenanceTaskTypes(propertyId),
    enabled: Boolean(propertyId),
  });

  const rosterQuery = useQuery({
    queryKey: ['roster', propertyId, 'maintenance'],
    queryFn: () => api.listRoster(propertyId, { kind: 'maintenance' }),
    enabled: Boolean(propertyId),
  });

  const activeTaskTypes = useMemo(
    () => (taskTypesQuery.data?.taskTypes ?? []).filter((t) => t.active),
    [taskTypesQuery.data],
  );

  const staffById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of rosterQuery.data?.staff ?? []) {
      if (s.status === 'active' && !s.exitedAt) {
        map.set(s.staffId, s.displayName ?? s.staffId);
      }
    }
    return map;
  }, [rosterQuery.data]);

  const rooms = roomsQuery.data?.rooms ?? [];
  const formRoomId = reportRoomId || rooms[0]?.roomId || '';

  const invalidateTickets = async () => {
    await queryClient.invalidateQueries({ queryKey: ['maintenance-tickets', propertyId] });
  };

  const reportMutation = useMutation({
    mutationFn: () => {
      const ticketId = `tkt_${crypto.randomUUID()}`;
      return api.createMaintenanceTicket(
        propertyId,
        {
          ticketId,
          roomId: formRoomId,
          description: reportDescription.trim(),
          category: reportCategory as MaintenanceTicketRow['category'],
          priority: reportPriority,
          ...(reportTaskTypeId ? { taskTypeId: reportTaskTypeId } : {}),
        },
        crypto.randomUUID(),
      );
    },
    onSuccess: async () => {
      setReportTaskTypeId('');
      setReportCategory('other');
      setReportPriority('medium');
      setReportDescription('');
      setReportError(null);
      await invalidateTickets();
    },
    onError: (err) => setReportError(classifiedUserMessage(asClassified(err), { fallback: 'Could not report this issue.' })),
  });

  const patchMutation = useMutation({
    mutationFn: async (input: {
      ticketId: string;
      body: Parameters<typeof api.updateMaintenanceTicket>[2];
      afterResolveRelease?: {
        roomId: string;
        oooId: string;
        startDate: string;
        endDate: string;
        releaseReason: string;
      };
      closeAfter?: boolean;
      roomCode?: string;
    }) => {
      const res = await api.updateMaintenanceTicket(
        propertyId,
        input.ticketId,
        input.body,
        crypto.randomUUID(),
      );
      let released = false;
      if (input.afterResolveRelease) {
        try {
          await api.setOooRange(propertyId, input.afterResolveRelease.roomId, {
            oooId: input.afterResolveRelease.oooId,
            startDate: input.afterResolveRelease.startDate,
            endDate: input.afterResolveRelease.endDate,
            releaseReason: input.afterResolveRelease.releaseReason,
            idempotencyKey: crypto.randomUUID(),
          });
          released = true;
          setReleaseError(null);
        } catch (e) {
          setReleaseError(classifiedUserMessage(asClassified(e), { fallback: 'Could not release the room.' }));
        }
      }
      return { res, released };
    },
    onSuccess: async (result, input) => {
      await invalidateTickets();
      if (result.released) {
        setBlockDone(`Room ${input.roomCode ?? ''} is back in service.`);
        await invalidateOooViews(queryClient, propertyId);
      }
      if (input.closeAfter) {
        setCancelConfirm(false);
        setActiveTicket(null);
        return;
      }
      if (input.body.status === 'in_progress' || input.body.status === 'resolved' || input.body.status === 'cancelled') {
        const nextStatus = input.body.status;
        setActiveTicket((prev) => (prev && prev.ticketId === input.ticketId ? { ...prev, status: nextStatus } : prev));
      }
    },
    onError: (err) => setDialogError(classifiedUserMessage(asClassified(err), { fallback: 'Could not update this ticket.' })),
  });

  function openTicketDialog(ticket: MaintenanceTicketRow) {
    setActiveTicket(ticket);
    setDialogAssignee(ticket.assigneeRef ?? '');
    setDialogPriority(ticket.priority);
    setDialogDescription(ticket.description);
    setDialogChecklist(ticket.checklist.map((c) => c.done));
    setDialogResolveNote('');
    setDialogReleaseRoom(true);
    setDialogError(null);
    setReleaseError(null);
    setCancelNote('');
    setCancelConfirm(false);
    setDialogReleaseReason('');
  }

  const blockMutation = useMutation({
    mutationFn: (input: OooBlockInput) =>
      api.setOooRange(propertyId, input.roomId, {
        startDate: input.startDate,
        endDate: input.endDate,
        ...(input.oooId ? { oooId: input.oooId } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.blockType ? { blockType: input.blockType } : {}),
        ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
        ...(input.endTime !== undefined ? { endTime: input.endTime } : {}),
        ...(input.inspectionNotes !== undefined ? { inspectionNotes: input.inspectionNotes } : {}),
        ...(input.releaseReason ? { releaseReason: input.releaseReason } : {}),
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async (_res, input) => {
      const code = rooms.find((r) => r.roomId === input.roomId)?.code ?? '';
      setBlockDone(
        input.releaseReason
          ? `Room ${code} is back in service.`
          : input.oooId
            ? `Block for room ${code} saved.`
            : `Room ${code} is now out of order.`,
      );
      setBlockDialog(null);
      setBlockError(null);
      await invalidateOooViews(queryClient, propertyId);
    },
    onError: (err) =>
      setBlockError(
        classifiedUserMessage(asClassified(err), { fallback: 'Could not update the out-of-order block.' }),
      ),
  });

  const blocks = rooms.flatMap((room) =>
    (room.oooRanges ?? []).map((range) => ({ roomId: room.roomId, roomCode: room.code, range })),
  );

  const ticketClosed =
    activeTicket?.status === 'resolved' || activeTicket?.status === 'cancelled';

  const listEmpty =
    ticketsQuery.isSuccess && ticketsQuery.data.tickets.length === 0;

  return (
    <>
      <PageHeader title="Maintenance" subtitle={subtitle} />
      <Field
        label="Status"
        control={
          <NativeSelect
            aria-label="Ticket status"
            value={statusFilter}
            onChange={(ev) => setStatusFilter(ev.target.value as StatusFilter)}
          >
            <option value="active">Active</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </NativeSelect>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Tickets</CardTitle>
        </CardHeader>
        <CardContent flush>
          {ticketsQuery.isLoading ? <Skeleton /> : null}
          {ticketsQuery.isError ? (
            <Alert intent="exception">
              {classifiedUserMessage(asClassified(ticketsQuery.error), { fallback: 'Could not load tickets.' })}
            </Alert>
          ) : null}
          {listEmpty && statusFilter === 'active' ? (
            <EmptyState title="No active tickets." />
          ) : null}
          {listEmpty && statusFilter !== 'active' ? (
            <EmptyState title="No tickets match this filter." />
          ) : null}
          {ticketsQuery.isSuccess && ticketsQuery.data.tickets.length > 0 ? (
            <DataTable>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>#</DataTableHeaderCell>
                  <DataTableHeaderCell>Room</DataTableHeaderCell>
                  <DataTableHeaderCell>Category</DataTableHeaderCell>
                  <DataTableHeaderCell>Priority</DataTableHeaderCell>
                  <DataTableHeaderCell>Description</DataTableHeaderCell>
                  <DataTableHeaderCell>Assignee</DataTableHeaderCell>
                  <DataTableHeaderCell>Age</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Actions</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {ticketsQuery.data.tickets.map((ticket) => (
                  <DataTableRow key={ticket.ticketId}>
                    <DataTableCell>#{ticket.ticketNo}</DataTableCell>
                    <DataTableCell>{ticket.roomCode}</DataTableCell>
                    <DataTableCell>{MAINTENANCE_CATEGORY_LABEL[ticket.category]}</DataTableCell>
                    <DataTableCell>
                      <Badge rung={priorityRung(ticket.priority)}>
                        {MAINTENANCE_PRIORITY_LABEL[ticket.priority]}
                      </Badge>
                    </DataTableCell>
                    <DataTableCell>
                      <span className="truncate maintenance-desc" title={ticket.description}>
                        {truncateDescription(ticket.description)}
                      </span>
                    </DataTableCell>
                    <DataTableCell>
                      {ticket.assigneeRef
                        ? (staffById.get(ticket.assigneeRef) ?? ticket.assigneeRef)
                        : '—'}
                    </DataTableCell>
                    <DataTableCell>{formatAge(ticket.createdAt)}</DataTableCell>
                    <DataTableCell>
                      <span className="ui-row">
                        {MAINTENANCE_STATUS_WORD[ticket.status]}
                        {ticket.oooActive ? <Badge rung="attention">Out of order</Badge> : null}
                      </span>
                    </DataTableCell>
                    <DataTableCell>
                      <Button
                        type="button"
                        aria-label={`Open ticket #${ticket.ticketNo}`}
                        onClick={() => openTicketDialog(ticket)}
                      >
                        Open
                      </Button>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Out-of-order rooms</CardTitle>
        </CardHeader>
        <CardContent flush>
          {blockDone ? (
            <Alert intent="settled" data-testid="ooo-block-done">
              {blockDone}
            </Alert>
          ) : null}
          {roomsQuery.isLoading ? <Skeleton /> : null}
          {roomsQuery.isError ? (
            <Alert intent="exception">
              {classifiedUserMessage(asClassified(roomsQuery.error), {
                fallback: 'Could not load rooms.',
              })}
            </Alert>
          ) : null}
          {roomsQuery.isSuccess && blocks.length === 0 ? (
            <EmptyState title="No rooms are out of order." />
          ) : null}
          {blocks.length > 0 ? (
            <DataTable data-testid="ooo-blocks">
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Room</DataTableHeaderCell>
                  <DataTableHeaderCell>Type</DataTableHeaderCell>
                  <DataTableHeaderCell>Dates</DataTableHeaderCell>
                  <DataTableHeaderCell>Times</DataTableHeaderCell>
                  <DataTableHeaderCell>Reason and notes</DataTableHeaderCell>
                  <DataTableHeaderCell>Actions</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {blocks.map(({ roomId, roomCode, range }) => (
                  <DataTableRow key={range.oooId}>
                    <DataTableCell>{roomCode}</DataTableCell>
                    <DataTableCell>{BLOCK_TYPE_LABEL[range.blockType ?? 'maintenance']}</DataTableCell>
                    <DataTableCell>
                      {dateHeading(range.startDate)} to {dateHeading(range.endDate)}
                    </DataTableCell>
                    <DataTableCell>{blockTimes(range.startTime, range.endTime) || '—'}</DataTableCell>
                    <DataTableCell>
                      {[range.reason, range.inspectionNotes ? `Inspection: ${range.inspectionNotes}` : null]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </DataTableCell>
                    <DataTableCell>
                      <Button
                        type="button"
                        aria-label={`Block history for ${roomCode}`}
                        onClick={() => setBlockDialog({ kind: 'history', roomId, roomCode, range })}
                      >
                        History
                      </Button>
                      {canSetOoo ? (
                        <>
                          <Button
                            type="button"
                            aria-label={`Edit block for ${roomCode}`}
                            onClick={() => {
                              setBlockError(null);
                              setBlockDialog({ kind: 'edit', roomId, roomCode, range });
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            intent="destructive"
                            aria-label={`Release ${roomCode} from out of order`}
                            onClick={() => {
                              setBlockError(null);
                              setBlockDialog({ kind: 'release', roomId, roomCode, range });
                            }}
                          >
                            Release
                          </Button>
                        </>
                      ) : null}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          ) : null}
        </CardContent>
        {canSetOoo ? (
          <CardContent>
            <OooBlockForm
              rooms={rooms}
              busy={blockMutation.isPending}
              onSubmit={(input) => blockMutation.mutate(input)}
            />
            {blockError && !blockDialog ? <Alert intent="exception">{blockError}</Alert> : null}
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Report issue</CardTitle>
        </CardHeader>
        <CardContent>
          {reportError ? <Alert intent="exception">{reportError}</Alert> : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!formRoomId || !reportDescription.trim()) return;
              reportMutation.mutate();
            }}
          >
            <FieldGroup inline>
            <Field
              label="Room"
              control={
                <NativeSelect
                  aria-label="Room"
                  value={formRoomId}
                  onChange={(ev) => setReportRoomId(ev.target.value)}
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
              label="Task type"
              control={
                <NativeSelect
                  aria-label="Task type"
                  value={reportTaskTypeId}
                  onChange={(ev) => {
                    const id = ev.target.value;
                    setReportTaskTypeId(id);
                    const tt = activeTaskTypes.find((t) => t.taskTypeId === id);
                    if (tt) {
                      setReportCategory(tt.category);
                      setReportPriority(tt.defaultPriority);
                    }
                  }}
                >
                  <option value="">None</option>
                  {activeTaskTypes.map((t) => (
                    <option key={t.taskTypeId} value={t.taskTypeId}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
            <Field
              label="Category"
              control={
                <NativeSelect
                  aria-label="Category"
                  value={reportCategory}
                  onChange={(ev) => setReportCategory(ev.target.value)}
                >
                  {MAINTENANCE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {MAINTENANCE_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
            <Field
              label="Priority"
              control={
                <NativeSelect
                  aria-label="Priority"
                  value={reportPriority}
                  onChange={(ev) => setReportPriority(ev.target.value as MaintenancePriority)}
                >
                  {MAINTENANCE_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {MAINTENANCE_PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
            <Field
              size="full"
              label="Description"
              control={
                <Textarea
                  aria-label="Description"
                  value={reportDescription}
                  maxLength={2000}
                  onChange={(ev) => setReportDescription(ev.target.value)}
                />
              }
            />
            <Button type="submit" intent="primary" disabled={reportMutation.isPending}>
              Submit report
            </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {activeTicket ? (
        <FormDialog
          title={`Ticket #${activeTicket.ticketNo} · Room ${activeTicket.roomCode}`}
          onClose={() => setActiveTicket(null)}
          actions={
            ticketClosed ? (
              <Button type="button" onClick={() => setActiveTicket(null)}>
                Close
              </Button>
            ) : (
              <>
                <Button type="button" onClick={() => setActiveTicket(null)}>
                  Close
                </Button>
                <Button
                  type="button"
                  intent="destructive"
                  onClick={() => setCancelConfirm(true)}
                >
                  Cancel ticket
                </Button>
                {activeTicket.status === 'open' ? (
                  <Button
                    type="button"
                    disabled={patchMutation.isPending}
                    onClick={() => {
                      setDialogError(null);
                      patchMutation.mutate({
                        ticketId: activeTicket.ticketId,
                        body: {
                          status: 'in_progress' as MaintenanceStatus,
                          assigneeRef: dialogAssignee || null,
                          priority: dialogPriority,
                          description: dialogDescription,
                          checklistDone: dialogChecklist,
                        },
                      });
                    }}
                  >
                    Start
                  </Button>
                ) : null}
                {activeTicket.status === 'open' || activeTicket.status === 'in_progress' ? (
                  <Button
                    type="button"
                    disabled={
                      patchMutation.isPending ||
                      (dialogReleaseRoom && activeTicket.oooActive && !dialogReleaseReason.trim())
                    }
                    onClick={() => {
                      setDialogError(null);
                      const release =
                        dialogReleaseRoom &&
                        activeTicket.oooActive &&
                        activeTicket.oooId &&
                        activeTicket.oooStartDate &&
                        businessDate
                          ? {
                              roomId: activeTicket.roomId,
                              oooId: activeTicket.oooId,
                              ...oooReleaseEdit(activeTicket.oooStartDate, businessDate),
                              releaseReason: dialogReleaseReason.trim(),
                            }
                          : undefined;
                      patchMutation.mutate({
                        ticketId: activeTicket.ticketId,
                        body: {
                          status: 'resolved',
                          assigneeRef: dialogAssignee || null,
                          priority: dialogPriority,
                          description: dialogDescription,
                          checklistDone: dialogChecklist,
                          resolutionNote: dialogResolveNote.trim() || undefined,
                        },
                        afterResolveRelease: release,
                        roomCode: activeTicket.roomCode,
                      });
                    }}
                  >
                    Resolve
                  </Button>
                ) : null}
                <Button
                  type="button"
                  intent="primary"
                  disabled={patchMutation.isPending}
                  onClick={() => {
                    setDialogError(null);
                    patchMutation.mutate({
                      ticketId: activeTicket.ticketId,
                      body: {
                        assigneeRef: dialogAssignee || null,
                        priority: dialogPriority,
                        description: dialogDescription,
                        checklistDone: dialogChecklist,
                      },
                      closeAfter: true,
                    });
                  }}
                >
                  Save
                </Button>
              </>
            )
          }
        >
          {dialogError ? <Alert intent="exception">{dialogError}</Alert> : null}
          {releaseError ? <Alert intent="exception">{releaseError}</Alert> : null}
          <div className="ui-stack">
            <Field
              label="Assign"
              control={
                <NativeSelect
                  aria-label="Assign"
                  value={dialogAssignee}
                  disabled={ticketClosed}
                  onChange={(ev) => setDialogAssignee(ev.target.value)}
                >
                  <option value="">Unassigned</option>
                  {[...staffById.entries()].map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
            <Field
              label="Priority"
              control={
                <NativeSelect
                  aria-label="Priority"
                  value={dialogPriority}
                  disabled={ticketClosed}
                  onChange={(ev) => setDialogPriority(ev.target.value as MaintenancePriority)}
                >
                  {MAINTENANCE_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {MAINTENANCE_PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
            <Field
              label="Description"
              control={
                <Textarea
                  aria-label="Description"
                  value={dialogDescription}
                  maxLength={2000}
                  disabled={ticketClosed}
                  onChange={(ev) => setDialogDescription(ev.target.value)}
                />
              }
            />
            {activeTicket.checklist.length > 0 ? (
              <fieldset className="ui-stack">
                <legend>Checklist</legend>
                {activeTicket.checklist.map((item, i) => (
                  <label className="ui-choice">
                    <Checkbox
                      aria-label={item.label}
                      checked={dialogChecklist[i] ?? false}
                      disabled={ticketClosed}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setDialogChecklist((prev) => {
                          const next = [...prev];
                          next[i] = checked;
                          return next;
                        });
                      }}
                    />
                    {item.label}
                  </label>
                ))}
              </fieldset>
            ) : null}
            {!ticketClosed && (activeTicket.status === 'in_progress' || activeTicket.status === 'open') ? (
              <Field
                label="Resolution note (optional)"
                control={
                  <Textarea
                    aria-label="Resolution note"
                    value={dialogResolveNote}
                    onChange={(ev) => setDialogResolveNote(ev.target.value)}
                  />
                }
              />
            ) : null}
            {!ticketClosed && activeTicket.oooActive ? (
              <label className="ui-choice">
                <Checkbox
                  aria-label="Release room now"
                  checked={dialogReleaseRoom}
                  onChange={(e) => setDialogReleaseRoom(e.target.checked)}
                />
                Release room now
              </label>
            ) : null}
            {!ticketClosed && activeTicket.oooActive && dialogReleaseRoom ? (
              <Field
                label="Release reason (required to release the room)"
                control={
                  <Input
                    aria-label="Release reason"
                    value={dialogReleaseReason}
                    maxLength={200}
                    onChange={(ev) => setDialogReleaseReason(ev.target.value)}
                  />
                }
              />
            ) : null}
          </div>
        </FormDialog>
      ) : null}

      {blockDialog?.kind === 'edit' ? (
        <OooBlockEditDialog
          roomId={blockDialog.roomId}
          roomCode={blockDialog.roomCode}
          range={blockDialog.range}
          today={businessDate ?? ''}
          busy={blockMutation.isPending}
          error={blockError}
          onClose={() => setBlockDialog(null)}
          onSubmit={(input) => blockMutation.mutate(input)}
        />
      ) : null}
      {blockDialog?.kind === 'release' ? (
        <OooReleaseDialog
          roomCode={blockDialog.roomCode}
          busy={blockMutation.isPending}
          error={blockError}
          onClose={() => setBlockDialog(null)}
          onSubmit={(releaseReason) =>
            blockMutation.mutate({
              roomId: blockDialog.roomId,
              oooId: blockDialog.range.oooId,
              ...oooReleaseDates(blockDialog.range, businessDate ?? blockDialog.range.startDate),
              releaseReason,
            })
          }
        />
      ) : null}
      {blockDialog?.kind === 'history' ? (
        <RoomOooHistoryDialog
          propertyId={propertyId}
          roomId={blockDialog.roomId}
          roomCode={blockDialog.roomCode}
          api={api}
          format={{ dateHeading, dateTime }}
          formatError={(err) =>
            classifiedUserMessage(asClassified(err), { fallback: 'Could not load the block history.' })
          }
          actorLabel={actorLabel}
          onClose={() => setBlockDialog(null)}
        />
      ) : null}

      {cancelConfirm && activeTicket ? (
        <FormDialog
          title="Cancel ticket?"
          onClose={() => setCancelConfirm(false)}
          actions={
            <>
              <Button type="button" onClick={() => setCancelConfirm(false)}>
                Back
              </Button>
              <Button
                type="button"
                intent="destructive"
                disabled={!cancelNote.trim() || patchMutation.isPending}
                onClick={() => {
                  if (!cancelNote.trim()) return;
                  patchMutation.mutate({
                    ticketId: activeTicket.ticketId,
                    body: {
                      status: 'cancelled',
                      resolutionNote: cancelNote.trim(),
                      assigneeRef: dialogAssignee || null,
                      priority: dialogPriority,
                      description: dialogDescription,
                      checklistDone: dialogChecklist,
                    },
                    closeAfter: true,
                  });
                }}
              >
                Cancel ticket
              </Button>
            </>
          }
        >
          <Field
            label="Note (required)"
            control={
              <Textarea
                aria-label="Cancel note"
                value={cancelNote}
                onChange={(ev) => setCancelNote(ev.target.value)}
              />
            }
          />
        </FormDialog>
      ) : null}
    </>
  );
}
