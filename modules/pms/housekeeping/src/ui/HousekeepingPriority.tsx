import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HousekeepingPriorityLevelInput, HousekeepingPriorityQueueRow } from '@hospai/contracts';
import {
  Alert,
  Badge,
  Card,
  CardContent,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  Skeleton,
  VisuallyHidden,
} from '@hospai/ui-kit';
import { useMemo, useState } from 'react';
import type { HousekeepingApi, HousekeepingRosterPerson } from './housekeeping-types.js';
import { HousekeepingNav } from './housekeeping-nav.js';
import { PRIORITY_LEVEL_LABEL, STAY_LABEL, priorityReasonLabel } from './priority-labels.js';

const LEVEL_OPTIONS: Array<{ value: HousekeepingPriorityLevelInput; label: string }> = [
  { value: 'standard', label: 'Standard' },
  { value: 'vip', label: 'VIP' },
  { value: 'guest_waiting', label: 'Guest waiting' },
  { value: 'high', label: 'High' },
  { value: 'rush', label: 'Rush' },
  { value: 'early_arrival', label: 'Early arrival' },
];

function isAssignableHousekeeper(person: HousekeepingRosterPerson): boolean {
  return person.status === 'active' && person.exitedAt == null && person.kinds.includes('housekeeper');
}

export function HousekeepingPriority({
  propertyId,
  defaultBusinessDate,
  api,
  canAssign,
  canReadRoster,
  subtitle,
  formatError,
}: {
  propertyId: string;
  defaultBusinessDate: string;
  api: HousekeepingApi;
  canAssign: boolean;
  canReadRoster: boolean;
  subtitle?: string;
  formatError?: (err: unknown) => string;
}) {
  const queryClient = useQueryClient();
  const [businessDate, setBusinessDate] = useState(defaultBusinessDate);
  const readRoster = canReadRoster;

  const prioritiesQuery = useQuery({
    queryKey: ['housekeeping-priorities', propertyId, businessDate],
    queryFn: () => api.getHousekeepingPriorities(propertyId, businessDate),
  });

  const assignmentsQuery = useQuery({
    queryKey: ['housekeeping-assignments', propertyId, businessDate],
    queryFn: () => api.listHousekeepingAssignments(propertyId, businessDate),
  });

  const rosterQuery = useQuery({
    queryKey: ['roster', propertyId, 'housekeeper'],
    queryFn: () => api.listRoster(propertyId, { kind: 'housekeeper' }),
    enabled: canAssign && readRoster,
  });

  const displayNameByStaffId = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of rosterQuery.data?.staff ?? []) {
      if (person.displayName) map.set(person.staffId, person.displayName);
    }
    return map;
  }, [rosterQuery.data]);

  const assignable = useMemo(
    () => (rosterQuery.data?.staff ?? []).filter(isAssignableHousekeeper),
    [rosterQuery.data],
  );

  const showPicker = canAssign && readRoster && assignable.length > 0;

  async function invalidateDesk() {
    await queryClient.invalidateQueries({
      queryKey: ['housekeeping-priorities', propertyId, businessDate],
    });
    await queryClient.invalidateQueries({
      queryKey: ['housekeeping-assignments', propertyId, businessDate],
    });
  }

  const priorityMutation = useMutation({
    mutationFn: (input: { roomId: string; level: HousekeepingPriorityLevelInput }) =>
      api.setHousekeepingPriority(
        propertyId,
        { roomId: input.roomId, businessDate, level: input.level },
        crypto.randomUUID(),
      ),
    onSuccess: invalidateDesk,
  });

  const assignMutation = useMutation({
    mutationFn: (input: { roomId: string; assigneeRef: string }) =>
      api.assignHousekeeping(propertyId, {
        roomId: input.roomId,
        businessDate,
        assigneeRef: input.assigneeRef,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: invalidateDesk,
  });

  const queue = prioritiesQuery.data?.queue ?? [];
  const assigneeFromAssignments = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of assignmentsQuery.data?.assignments ?? []) {
      map.set(row.roomId, row.assigneeRef);
    }
    return map;
  }, [assignmentsQuery.data]);

  const errorText = prioritiesQuery.isError
    ? (formatError?.(prioritiesQuery.error) ?? 'Could not load the cleaning queue.')
    : null;
  const mutationText = priorityMutation.isError
    ? (formatError?.(priorityMutation.error) ?? 'Could not save the priority.')
    : assignMutation.isError
      ? (formatError?.(assignMutation.error) ?? 'Could not assign the room.')
      : null;

  return (
    <div className="ui-page-stack">
      <PageHeader title="Housekeeping priority" subtitle={subtitle ?? 'Cleaning queue'} />
      <HousekeepingNav view="priority" />
      <Card>
        <CardContent>
          <Field
            size="xs"
            label="Business date"
            control={
              <Input
                type="date"
                value={businessDate}
                onChange={(e) => setBusinessDate(e.target.value)}
                data-testid="hk-priority-date"
              />
            }
          />
        </CardContent>
        <CardContent flush>
          {prioritiesQuery.isPending ? (
            <Skeleton data-testid="hk-priority-loading" />
          ) : errorText ? (
            <Alert>{errorText}</Alert>
          ) : queue.length === 0 ? (
            <EmptyState title="No rooms waiting to be cleaned." data-testid="hk-priority-empty" />
          ) : (
            <DataTable data-testid="hk-priority">
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Rank</DataTableHeaderCell>
                  <DataTableHeaderCell>Room</DataTableHeaderCell>
                  <DataTableHeaderCell>Floor</DataTableHeaderCell>
                  <DataTableHeaderCell>Stay</DataTableHeaderCell>
                  <DataTableHeaderCell>Reasons</DataTableHeaderCell>
                  <DataTableHeaderCell>Level</DataTableHeaderCell>
                  <DataTableHeaderCell>Assignee</DataTableHeaderCell>
                  <DataTableHeaderCell />
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {queue.map((row, index) => (
                  <PriorityRow
                    key={row.roomId}
                    rank={index + 1}
                    row={row}
                    assigneeLabel={assigneeLabel(
                      row.assigneeRef ?? assigneeFromAssignments.get(row.roomId) ?? null,
                      displayNameByStaffId,
                    )}
                    canAssign={canAssign}
                    showPicker={showPicker}
                    assignable={assignable}
                    onLevel={(level) => priorityMutation.mutate({ roomId: row.roomId, level })}
                    onAssign={(assigneeRef) => assignMutation.mutate({ roomId: row.roomId, assigneeRef })}
                  />
                ))}
              </DataTableBody>
            </DataTable>
          )}
          {mutationText ? <Alert>{mutationText}</Alert> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function assigneeLabel(assigneeRef: string | null, names: Map<string, string>): string {
  if (!assigneeRef) return '—';
  return names.get(assigneeRef) ?? assigneeRef;
}

function PriorityRow({
  rank,
  row,
  assigneeLabel: name,
  canAssign,
  showPicker,
  assignable,
  onLevel,
  onAssign,
}: {
  rank: number;
  row: HousekeepingPriorityQueueRow;
  assigneeLabel: string;
  canAssign: boolean;
  showPicker: boolean;
  assignable: HousekeepingRosterPerson[];
  onLevel: (level: HousekeepingPriorityLevelInput) => void;
  onAssign: (assigneeRef: string) => void;
}) {
  const levelValue = row.level ?? 'standard';
  return (
    <DataTableRow>
      <DataTableCell>{rank}</DataTableCell>
      <DataTableCell>{row.code}</DataTableCell>
      <DataTableCell>{row.floor ?? '—'}</DataTableCell>
      <DataTableCell>{STAY_LABEL[row.stay]}</DataTableCell>
      <DataTableCell>
        <span className="ui-row">
          {row.reasons.map((reason) => (
            <Badge
              key={reason}
              rung={reason === 'dnd' || reason === row.level ? 'attention' : 'informational'}
            >
              {priorityReasonLabel(reason)}
            </Badge>
          ))}
        </span>
      </DataTableCell>
      <DataTableCell>
        <Field
          size="sm"
          label={<VisuallyHidden>{`Level for ${row.code}`}</VisuallyHidden>}
          hint={canAssign ? undefined : 'Housekeeping write is required to change the level.'}
          control={
            <NativeSelect
              aria-label={`Level for ${row.code}`}
              value={levelValue}
              disabled={!canAssign}
              onChange={(e) => {
                const level = e.target.value as HousekeepingPriorityLevelInput;
                if (level !== levelValue) onLevel(level);
              }}
            >
              {LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          }
        />
      </DataTableCell>
      <DataTableCell>{name}</DataTableCell>
      <DataTableCell>
        {showPicker ? (
          <NativeSelect
            aria-label={`Assign ${row.code}`}
            defaultValue=""
            onChange={(e) => {
              const assignee = e.target.value;
              if (assignee) onAssign(assignee);
            }}
          >
            <option value="" disabled>
              Assign
            </option>
            {assignable.map((person) => (
              <option key={person.staffId} value={person.staffId}>
                {person.displayName ?? person.staffId}
              </option>
            ))}
          </NativeSelect>
        ) : null}
      </DataTableCell>
    </DataTableRow>
  );
}
