import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HK_TASK_CANCEL_REASON_MAX,
  HK_TASK_NOTES_MAX,
  HK_TASK_SUPERVISOR_NOTES_MAX,
  HOUSEKEEPING_TASK_PRIORITIES,
  HOUSEKEEPING_TASK_STATUSES,
  type HousekeepingTaskListRow,
  type HousekeepingTaskPriority,
  type HousekeepingTaskStatus,
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
  Metric,
  Metrics,
  NativeSelect,
  PageHeader,
  RowActions,
  Skeleton,
  Textarea,
  Toolbar,
} from '@hospai/ui-kit';
import { useMemo, useState } from 'react';
import { useBusinessDate } from './use-business-date.js';
import { HousekeepingNav } from './housekeeping-nav.js';
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, taskTypeLabel } from './housekeeping-labels.js';
import type { HousekeepingApi, HousekeepingRosterPerson } from './housekeeping-types.js';

export function housekeepingTasksKey(
  propertyId: string,
  businessDate: string,
  filters: { status: string; assigneeRef: string; roomId: string; search: string },
) {
  return [
    'housekeeping-tasks',
    propertyId,
    businessDate,
    filters.status,
    filters.assigneeRef,
    filters.roomId,
    filters.search,
  ] as const;
}

function statusRung(status: HousekeepingTaskStatus): 'neutral' | 'informational' | 'settled' | 'attention' {
  if (status === 'in_progress') return 'informational';
  if (status === 'completed' || status === 'reviewed') return 'settled';
  if (status === 'cancelled') return 'neutral';
  return 'attention';
}

function isAssignableHousekeeper(person: HousekeepingRosterPerson): boolean {
  return person.status === 'active' && person.exitedAt == null && person.kinds.includes('housekeeper');
}

type TaskFormValues = {
  roomId: string;
  taskType: string;
  assigneeRef: string;
  priority: HousekeepingTaskPriority;
  businessDate: string;
  notes: string;
};

export function HousekeepingTasks({
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
  format: { dateHeading: (iso: string) => string; dateTime: (ms: number) => string };
}) {
  const queryClient = useQueryClient();
  const [businessDate, setBusinessDate] = useBusinessDate(defaultBusinessDate);
  const [statusFilter, setStatusFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: 'new' }
    | { kind: 'edit'; task: HousekeepingTaskListRow }
    | { kind: 'review'; task: HousekeepingTaskListRow }
    | { kind: 'cancel'; task: HousekeepingTaskListRow }
    | null
  >(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const filters = {
    status: statusFilter,
    assigneeRef: assigneeFilter,
    roomId: roomFilter,
    search: search.trim(),
  };

  const tasksQuery = useQuery({
    queryKey: housekeepingTasksKey(propertyId, businessDate, filters),
    queryFn: () =>
      api.getHousekeepingTasks(propertyId, {
        date: businessDate,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.assigneeRef ? { assigneeRef: filters.assigneeRef } : {}),
        ...(filters.roomId ? { roomId: filters.roomId } : {}),
        ...(filters.search ? { search: filters.search } : {}),
      }),
    enabled: Boolean(businessDate),
  });
  const roomsQuery = useQuery({
    queryKey: ['rooms', propertyId],
    queryFn: () => api.listRooms(propertyId),
  });
  const assignmentsQuery = useQuery({
    queryKey: ['housekeeping-assignments', propertyId, businessDate],
    queryFn: () => api.listHousekeepingAssignments(propertyId, businessDate),
    enabled: Boolean(businessDate),
  });
  const rosterQuery = useQuery({
    queryKey: ['roster', propertyId, 'housekeeper'],
    queryFn: () => api.listRoster(propertyId, { kind: 'housekeeper' }),
    enabled: canReadRoster,
  });

  const taskTypes = tasksQuery.data?.taskTypes ?? [];
  const rooms = roomsQuery.data?.rooms ?? [];
  const nameByStaff = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of rosterQuery.data?.staff ?? []) {
      if (p.displayName) map.set(p.staffId, p.displayName);
    }
    return map;
  }, [rosterQuery.data]);
  const assignable = useMemo(
    () =>
      (rosterQuery.data?.staff ?? [])
        .filter(isAssignableHousekeeper)
        .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '')),
    [rosterQuery.data],
  );
  const dayAssignee = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignmentsQuery.data?.assignments ?? []) map.set(a.roomId, a.assigneeRef);
    return map;
  }, [assignmentsQuery.data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['housekeeping-tasks', propertyId] });
  const failure = (err: unknown, fallback: string) => formatError?.(err) ?? fallback;

  const createMutation = useMutation({
    mutationFn: (v: TaskFormValues) =>
      api.createHousekeepingTask(
        propertyId,
        {
          businessDate: v.businessDate,
          taskType: v.taskType,
          roomId: v.roomId,
          ...(v.assigneeRef ? { assigneeRef: v.assigneeRef } : {}),
          priority: v.priority,
          ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
        },
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      setDialog(null);
      setDialogError(null);
      setNotice(null);
      setDone('Task created.');
      await invalidate();
    },
    onError: (err) => setDialogError(failure(err, 'Could not create the task.')),
  });

  const updateMutation = useMutation({
    mutationFn: (input: { task: HousekeepingTaskListRow; values: TaskFormValues }) =>
      api.updateHousekeepingTask(
        propertyId,
        input.task.taskId,
        {
          taskType: input.values.taskType,
          assigneeRef: input.values.assigneeRef || null,
          priority: input.values.priority,
          notes: input.values.notes.trim() || null,
          businessDate: input.values.businessDate,
        },
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      setDialog(null);
      setDialogError(null);
      setNotice(null);
      setDone('Task updated.');
      await invalidate();
    },
    onError: (err) => setDialogError(failure(err, 'Could not update the task.')),
  });

  const transitionMutation = useMutation({
    mutationFn: (input: {
      task: HousekeepingTaskListRow;
      action: 'start' | 'complete' | 'review' | 'cancel';
      notes?: string | null;
      reason?: string;
    }) =>
      api.transitionHousekeepingTask(
        propertyId,
        input.task.taskId,
        {
          action: input.action,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        },
        crypto.randomUUID(),
      ),
    onSuccess: async (_result, input) => {
      setDialog(null);
      setDialogError(null);
      setNotice(null);
      const words = {
        start: 'started',
        complete: 'completed',
        review: 'reviewed',
        cancel: 'cancelled',
      } as const;
      setDone(`Task for room ${input.task.roomCode} ${words[input.action]}.`);
      await invalidate();
    },
    onError: (err, input) => {
      const text = failure(err, 'Could not update the task.');
      if (input.action === 'review' || input.action === 'cancel') setDialogError(text);
      else setNotice(text);
    },
  });

  const tasks = tasksQuery.data?.tasks ?? [];
  const counters = tasksQuery.data?.counters;
  const anyFilter = Boolean(statusFilter || assigneeFilter || roomFilter || filters.search);
  const busy =
    createMutation.isPending || updateMutation.isPending || transitionMutation.isPending;
  const noWriteReason = 'You can view tasks but not change them.';

  function openDialog(next: NonNullable<typeof dialog>) {
    setDialogError(null);
    setDialog(next);
  }

  function attendantLabel(task: HousekeepingTaskListRow): string {
    if (!task.assigneeRef) return '—';
    return nameByStaff.get(task.assigneeRef) ?? 'Assigned';
  }

  return (
    <div className="ui-page-stack">
      <PageHeader
        title="Housekeeping tasks"
        subtitle={
          subtitle ?? (
            <>
              {businessDate ? format.dateHeading(businessDate) : ''} <span className="sep">·</span>{' '}
              tasks
            </>
          )
        }
      />
      <HousekeepingNav view="tasks" />
      {done ? (
        <Alert intent="settled" data-testid="hk-task-done">
          {done}
        </Alert>
      ) : null}
      {notice ? (
        <Alert intent="exception" data-testid="hk-task-notice">
          {notice}
        </Alert>
      ) : null}
      {!canWrite ? <Alert intent="informational">{noWriteReason}</Alert> : null}
      <Card>
        <Toolbar>
          <Field
            size="xs"
            label="Business date"
            control={
              <Input
                type="date"
                value={businessDate}
                onChange={(e) => setBusinessDate(e.target.value)}
                data-testid="hk-task-date"
              />
            }
          />
          <Field
            size="sm"
            label="Status"
            control={
              <NativeSelect
                aria-label="Task status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All</option>
                {HOUSEKEEPING_TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TASK_STATUS_LABEL[s]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          {canReadRoster ? (
            <Field
              size="sm"
              label="Attendant"
              control={
                <NativeSelect
                  aria-label="Task attendant"
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value)}
                >
                  <option value="">All</option>
                  {assignable.map((p) => (
                    <option key={p.staffId} value={p.staffId}>
                      {p.displayName ?? 'Unnamed attendant'}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
          ) : null}
          <Field
            size="sm"
            label="Room"
            control={
              <NativeSelect
                aria-label="Task room"
                value={roomFilter}
                onChange={(e) => setRoomFilter(e.target.value)}
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
          <Field
            size="sm"
            label="Search"
            control={
              <Input
                aria-label="Search tasks"
                placeholder="Room or notes"
                value={search}
                maxLength={80}
                onChange={(e) => setSearch(e.target.value)}
              />
            }
          />
          <Button
            type="button"
            intent="primary"
            disabled={!canWrite}
            onClick={() => openDialog({ kind: 'new' })}
          >
            New task
          </Button>
        </Toolbar>

        <CardContent>
          <div data-testid="hk-task-counters">
            <Metrics>
              <Metric label="Open" value={counters?.open ?? '—'} />
              <Metric label="Pending" value={counters?.pending ?? '—'} />
              <Metric label="In progress" value={counters?.inProgress ?? '—'} />
              <Metric label="Completed" value={counters?.completed ?? '—'} />
              <Metric label="Overdue" value={counters?.overdue ?? '—'} />
            </Metrics>
          </div>
        </CardContent>

        <CardContent flush>
          {tasksQuery.isLoading ? <Skeleton label="Loading tasks" /> : null}
          {tasksQuery.isError ? (
            <Alert intent="exception">
              {failure(tasksQuery.error, 'Could not load housekeeping tasks.')}
            </Alert>
          ) : null}
          {tasksQuery.isSuccess && tasks.length === 0 && !anyFilter ? (
            <EmptyState
              kind="empty"
              title="No tasks for this day."
              description={canWrite ? 'Use New task to add one.' : undefined}
            />
          ) : null}
          {tasksQuery.isSuccess && tasks.length === 0 && anyFilter ? (
            <EmptyState kind="nomatch" title="No tasks match these filters." />
          ) : null}
          {tasksQuery.data?.truncated ? (
            <Alert intent="attention">Only the first 500 tasks are shown. Narrow the filters.</Alert>
          ) : null}
          {tasks.length > 0 ? (
            <DataTable data-testid="hk-tasks">
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Room</DataTableHeaderCell>
                  <DataTableHeaderCell>Type</DataTableHeaderCell>
                  <DataTableHeaderCell>Attendant</DataTableHeaderCell>
                  <DataTableHeaderCell>Priority</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Notes</DataTableHeaderCell>
                  <DataTableHeaderCell>Actions</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {tasks.map((task) => {
                  const open = task.status === 'pending' || task.status === 'in_progress';
                  const notes = [task.notes, task.supervisorNotes ? `Supervisor: ${task.supervisorNotes}` : null]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <DataTableRow key={task.taskId}>
                      <DataTableCell>{task.roomCode}</DataTableCell>
                      <DataTableCell>{taskTypeLabel(task.taskType, taskTypes)}</DataTableCell>
                      <DataTableCell>{attendantLabel(task)}</DataTableCell>
                      <DataTableCell>{TASK_PRIORITY_LABEL[task.priority]}</DataTableCell>
                      <DataTableCell>
                        <Badge rung={statusRung(task.status)}>{TASK_STATUS_LABEL[task.status]}</Badge>
                        {task.cancelReason ? ` ${task.cancelReason}` : ''}
                      </DataTableCell>
                      <DataTableCell>{notes || '—'}</DataTableCell>
                      <DataTableCell>
                        <RowActions>
                          {task.status === 'pending' ? (
                            <Button
                              type="button"
                              aria-label={`Start task for ${task.roomCode}`}
                              disabled={!canWrite || busy}
                              onClick={() => transitionMutation.mutate({ task, action: 'start' })}
                            >
                              Start
                            </Button>
                          ) : null}
                          {task.status === 'in_progress' ? (
                            <Button
                              type="button"
                              aria-label={`Complete task for ${task.roomCode}`}
                              disabled={!canWrite || busy}
                              onClick={() => transitionMutation.mutate({ task, action: 'complete' })}
                            >
                              Complete
                            </Button>
                          ) : null}
                          {task.status === 'completed' ? (
                            <Button
                              type="button"
                              aria-label={`Review task for ${task.roomCode}`}
                              disabled={!canWrite || busy}
                              onClick={() => openDialog({ kind: 'review', task })}
                            >
                              Review
                            </Button>
                          ) : null}
                          {open ? (
                            <>
                              <Button
                                type="button"
                                intent="ghost"
                                aria-label={`Edit task for ${task.roomCode}`}
                                disabled={!canWrite || busy}
                                onClick={() => openDialog({ kind: 'edit', task })}
                              >
                                Edit
                              </Button>
                              <Button
                                type="button"
                                intent="destructive"
                                aria-label={`Cancel task for ${task.roomCode}`}
                                disabled={!canWrite || busy}
                                onClick={() => openDialog({ kind: 'cancel', task })}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : null}
                        </RowActions>
                      </DataTableCell>
                    </DataTableRow>
                  );
                })}
              </DataTableBody>
            </DataTable>
          ) : null}
        </CardContent>
      </Card>

      {dialog?.kind === 'new' || dialog?.kind === 'edit' ? (
        <TaskFormDialog
          key={dialog.kind === 'edit' ? dialog.task.taskId : 'new'}
          mode={dialog.kind}
          task={dialog.kind === 'edit' ? dialog.task : undefined}
          rooms={rooms}
          taskTypes={taskTypes}
          assignable={assignable}
          canPickAttendant={canReadRoster}
          dayAssignee={dayAssignee}
          nameByStaff={nameByStaff}
          defaultDate={businessDate}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(values) =>
            dialog.kind === 'edit'
              ? updateMutation.mutate({ task: dialog.task, values })
              : createMutation.mutate(values)
          }
        />
      ) : null}
      {dialog?.kind === 'review' ? (
        <ReviewDialog
          task={dialog.task}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(notes) =>
            transitionMutation.mutate({ task: dialog.task, action: 'review', notes })
          }
        />
      ) : null}
      {dialog?.kind === 'cancel' ? (
        <CancelDialog
          task={dialog.task}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(reason) =>
            transitionMutation.mutate({ task: dialog.task, action: 'cancel', reason })
          }
        />
      ) : null}
    </div>
  );
}

function TaskFormDialog({
  mode,
  task,
  rooms,
  taskTypes,
  assignable,
  canPickAttendant,
  dayAssignee,
  nameByStaff,
  defaultDate,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  mode: 'new' | 'edit';
  task?: HousekeepingTaskListRow;
  rooms: ReadonlyArray<{ roomId: string; code: string }>;
  taskTypes: ReadonlyArray<{ code: string; label: string }>;
  assignable: readonly HousekeepingRosterPerson[];
  canPickAttendant: boolean;
  dayAssignee: ReadonlyMap<string, string>;
  nameByStaff: ReadonlyMap<string, string>;
  defaultDate: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: TaskFormValues) => void;
}) {
  const firstRoom = rooms[0]?.roomId ?? '';
  const [values, setValues] = useState<TaskFormValues>({
    roomId: task?.roomId ?? firstRoom,
    taskType: task?.taskType ?? taskTypes[0]?.code ?? '',
    assigneeRef: task?.assigneeRef ?? (firstRoom ? (dayAssignee.get(firstRoom) ?? '') : ''),
    priority: task?.priority ?? 'normal',
    businessDate: task?.businessDate ?? defaultDate,
    notes: task?.notes ?? '',
  });
  const set = (patch: Partial<TaskFormValues>) => setValues((prev) => ({ ...prev, ...patch }));
  const missing = !values.roomId || !values.taskType || !values.businessDate;
  // A stored attendant who has since left the roster stays selectable so the form keeps its value.
  const knownAssignee =
    values.assigneeRef && !assignable.some((p) => p.staffId === values.assigneeRef)
      ? (nameByStaff.get(values.assigneeRef) ?? 'Current attendant')
      : null;
  // A type removed from the settings list stays selectable on an old task.
  const typeMissing = values.taskType && !taskTypes.some((t) => t.code === values.taskType);

  function submit() {
    if (missing || busy) return;
    onSubmit(values);
  }

  return (
    <Dialog
      open
      wide
      title={mode === 'new' ? 'New task' : `Edit task · Room ${task?.roomCode ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={busy || missing} onClick={submit}>
            {mode === 'new' ? 'Create task' : 'Save task'}
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        data-testid="hk-task-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        <FieldGroup inline>
          {mode === 'new' ? (
            <Field
              label="Room"
              control={
                <NativeSelect
                  aria-label="Task room"
                  value={values.roomId}
                  onChange={(e) => {
                    const roomId = e.target.value;
                    set({ roomId, assigneeRef: dayAssignee.get(roomId) ?? '' });
                  }}
                >
                  {rooms.map((r) => (
                    <option key={r.roomId} value={r.roomId}>
                      {r.code}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
          ) : null}
          <Field
            label="Type"
            control={
              <NativeSelect
                aria-label="Task type"
                value={values.taskType}
                onChange={(e) => set({ taskType: e.target.value })}
              >
                {typeMissing ? (
                  <option value={values.taskType}>{taskTypeLabel(values.taskType, taskTypes)}</option>
                ) : null}
                {taskTypes.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          {canPickAttendant ? (
            <Field
              label="Attendant"
              hint={mode === 'new' ? "Starts as the room's attendant for the day, if one is set." : undefined}
              control={
                <NativeSelect
                  aria-label="Task attendant"
                  value={values.assigneeRef}
                  onChange={(e) => set({ assigneeRef: e.target.value })}
                >
                  <option value="">Unassigned</option>
                  {knownAssignee ? <option value={values.assigneeRef}>{knownAssignee}</option> : null}
                  {assignable.map((p) => (
                    <option key={p.staffId} value={p.staffId}>
                      {p.displayName ?? 'Unnamed attendant'}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
          ) : null}
          <Field
            label="Priority"
            control={
              <NativeSelect
                aria-label="Task priority"
                value={values.priority}
                onChange={(e) => set({ priority: e.target.value as HousekeepingTaskPriority })}
              >
                {HOUSEKEEPING_TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {TASK_PRIORITY_LABEL[p]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Date"
            control={
              <Input
                type="date"
                aria-label="Task date"
                value={values.businessDate}
                onChange={(e) => set({ businessDate: e.target.value })}
              />
            }
          />
          <Field
            size="full"
            label="Notes (optional)"
            control={
              <Textarea
                aria-label="Task notes"
                value={values.notes}
                maxLength={HK_TASK_NOTES_MAX}
                onChange={(e) => set({ notes: e.target.value })}
              />
            }
          />
        </FieldGroup>
      </form>
    </Dialog>
  );
}

function ReviewDialog({
  task,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  task: HousekeepingTaskListRow;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (notes: string | null) => void;
}) {
  const [notes, setNotes] = useState(task.supervisorNotes ?? '');

  function submit() {
    if (!busy) onSubmit(notes.trim() || null);
  }

  return (
    <Dialog
      open
      title={`Review task · Room ${task.roomCode}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={busy} onClick={submit}>
            Mark reviewed
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        <Field
          label="Supervisor notes (optional)"
          control={
            <Textarea
              aria-label="Supervisor notes"
              value={notes}
              maxLength={HK_TASK_SUPERVISOR_NOTES_MAX}
              onChange={(e) => setNotes(e.target.value)}
            />
          }
        />
      </form>
    </Dialog>
  );
}

function CancelDialog({
  task,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  task: HousekeepingTaskListRow;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const missing = !reason.trim();

  function submit() {
    if (!missing && !busy) onSubmit(reason.trim());
  }

  return (
    <Dialog
      open
      title={`Cancel this task for room ${task.roomCode}?`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Keep task
          </Button>
          <Button intent="destructive" disabled={busy || missing} onClick={submit}>
            Cancel task
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        data-testid="hk-cancel-task"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        <p>The task stays in the list as cancelled. It cannot be restarted.</p>
        <Field
          label="Reason"
          control={
            <Input
              aria-label="Cancel reason"
              value={reason}
              maxLength={HK_TASK_CANCEL_REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
            />
          }
        />
      </form>
    </Dialog>
  );
}
