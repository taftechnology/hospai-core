import { ClassifiedError } from '@hospai/client-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
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
  RoomStatus,
  Tabs,
  VisuallyHidden,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { ConfirmDialog } from '../shell/ConfirmDialog.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { useUnsavedChanges } from './use-unsaved-changes.js';

type RoomTypeRow = {
  roomTypeId: string;
  code: string;
  name: string;
  kind?: 'physical' | 'virtual';
  roomCount: number;
  maxOccupancy: number;
  maxAdults: number;
  status: 'active' | 'archived';
  constituentRoomTypeIds?: string[];
};

type RoomRow = {
  roomId: string;
  roomTypeId: string;
  code: string;
  status: string;
  floor: string | null;
  oooRanges: Array<{ oooId: string; startDate: string; endDate: string; reason: string | null }>;
};

function wireCode(err: unknown): string | null {
  if (!(err instanceof ClassifiedError)) return null;
  const b = err.classified.body;
  if (b && typeof b === 'object' && 'error' in b && typeof (b as { error: unknown }).error === 'string') {
    return (b as { error: string }).error;
  }
  return null;
}

function inventoryErrorCopy(err: unknown, context?: 'room' | 'type'): string {
  const code = wireCode(err);
  if (code === 'room_type_code_exists') return 'An active room type already uses this code.';
  if (code === 'room_units_exceed_count') {
    return 'Cannot lower room count below the number of live rooms. Archive extra units first.';
  }
  if (code === 'archive_blocked') {
    if (context === 'room') {
      return 'This room has a live reservation or a future out-of-order period — it cannot be archived.';
    }
    return 'This type still has future sold or blocked inventory — it cannot be archived.';
  }
  if (code === 'constituent_in_use') {
    return 'This type is a constituent of an active virtual type — archive the virtual type first.';
  }
  if (code === 'virtual_constituents_required') {
    return 'Virtual types need at least two physical constituents.';
  }
  if (code === 'virtual_constituents_min_two') {
    return 'Virtual types need at least two distinct physical constituents.';
  }
  if (code === 'virtual_constituents_duplicate') {
    return 'Constituent room types must be distinct.';
  }
  if (code === 'virtual_constituent_not_physical') {
    return 'Constituents must be active physical room types.';
  }
  if (code === 'virtual_room_count_must_be_zero') {
    return 'Virtual types cannot have a room count.';
  }
  if (code === 'virtual_nested_forbidden') {
    return 'Virtual types cannot include another virtual type as a constituent.';
  }
  if (code === 'virtual_occupancy_exceeds_constituents') {
    return 'Occupancy cannot exceed the minimum across selected constituents.';
  }
  if (code === 'virtual_constituents_on_physical') {
    return 'Physical room types cannot have constituents.';
  }
  if (code === 'virtual_type_no_rooms') {
    return 'Virtual types do not have room units.';
  }
  if (code?.startsWith('virtual_')) {
    return 'Virtual room type validation failed.';
  }
  if (code === 'room_count_exceeded') {
    return 'This type’s room count is full. Raise the type’s room count first.';
  }
  if (code === 'room_code_exists') return 'Room code already exists.';
  const c = asClassified(err);
  if (c.class === 'fail_closed') return 'Property unreachable — cannot load inventory.';
  return classifiedUserMessage(c, { fallback: 'Request failed.' });
}

export function InventoryScreen({ tab }: { tab?: 'types' | 'rooms' }) {
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const activeTab = tab ?? 'types';
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<RoomTypeRow | null>(null);
  const [roomArchiveTarget, setRoomArchiveTarget] = useState<{ roomId: string; code: string } | null>(
    null,
  );

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'physical' | 'virtual'>('physical');
  const [constituentIds, setConstituentIds] = useState<string[]>([]);
  const [roomCount, setRoomCount] = useState('1');
  const [maxOccupancy, setMaxOccupancy] = useState('2');
  const [maxAdults, setMaxAdults] = useState('2');

  const [roomTypeId, setRoomTypeId] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [roomFloor, setRoomFloor] = useState('');
  const [roomEdits, setRoomEdits] = useState<Record<string, { code: string; floor: string }>>({});
  const [typeEdits, setTypeEdits] = useState<Record<string, { roomCount: string }>>({});

  const typeFormDirty = Boolean(code || name);
  const roomFormDirty = Boolean(roomCode);
  const unsavedGuard = useUnsavedChanges(typeFormDirty || roomFormDirty);

  const typesQ = useQuery({
    queryKey: ['room-types', propertyId],
    queryFn: () => api.listRoomTypes(propertyId, { status: 'active' }),
    retry: false,
  });
  const roomsQ = useQuery({
    queryKey: ['rooms', propertyId],
    queryFn: () => api.listRooms(propertyId),
    retry: false,
  });

  const types = (typesQ.data?.roomTypes ?? []) as RoomTypeRow[];
  const rooms = (roomsQ.data?.rooms ?? []) as RoomRow[];
  const physicalTypes = useMemo(
    () => types.filter((t) => t.kind !== 'virtual'),
    [types],
  );
  const typeCodeById = useMemo(
    () => new Map(types.map((t) => [t.roomTypeId, t.code])),
    [types],
  );
  const selectedRoomType = types.find((t) => t.roomTypeId === roomTypeId);
  const virtualRoomTypeSelected = selectedRoomType?.kind === 'virtual';
  const roomsByType = useMemo(() => {
    const map = new Map<string, RoomRow[]>();
    for (const room of rooms) {
      const list = map.get(room.roomTypeId) ?? [];
      list.push(room);
      map.set(room.roomTypeId, list);
    }
    return map;
  }, [rooms]);

  const createType = useMutation({
    mutationFn: () =>
      api.createRoomType(propertyId, {
        roomTypeId: crypto.randomUUID(),
        code,
        name,
        maxOccupancy: Number(maxOccupancy),
        maxAdults: Number(maxAdults),
        ...(kind === 'virtual'
          ? { kind: 'virtual' as const, roomCount: 0, constituentRoomTypeIds: constituentIds }
          : { roomCount: Number(roomCount) }),
      }),
    onSuccess: async () => {
      setCode('');
      setName('');
      setKind('physical');
      setConstituentIds([]);
      setMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['room-types', propertyId] });
    },
  });

  const archiveType = useMutation({
    mutationFn: (id: string) => api.archiveRoomType(propertyId, id),
    onSuccess: async () => {
      setArchiveTarget(null);
      setMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['room-types', propertyId] });
    },
  });

  const archiveRoomUnit = useMutation({
    mutationFn: ({ roomId }: { roomId: string }) => api.archiveRoom(propertyId, roomId),
    onSuccess: async () => {
      setRoomArchiveTarget(null);
      setMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['rooms', propertyId] });
    },
  });

  const saveType = useMutation({
    mutationFn: (t: RoomTypeRow) =>
      api.updateRoomType(propertyId, t.roomTypeId, {
        roomCount: Number(typeEdits[t.roomTypeId]?.roomCount ?? t.roomCount),
      }),
    onSuccess: async () => {
      setMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['room-types', propertyId] });
    },
  });

  const addRoom = useMutation({
    mutationFn: () =>
      api.createRoom(propertyId, {
        roomId: crypto.randomUUID(),
        roomTypeId,
        code: roomCode,
        ...(roomFloor ? { floor: roomFloor } : {}),
      }),
    onSuccess: async () => {
      setRoomCode('');
      setRoomFloor('');
      setMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['rooms', propertyId] });
    },
  });

  const listFailed = typesQ.isError || roomsQ.isError;
  const listFailClosed =
    (typesQ.isError && asClassified(typesQ.error).class === 'fail_closed') ||
    (roomsQ.isError && asClassified(roomsQ.error).class === 'fail_closed');

  if (listFailed && listFailClosed) {
    return (
      <div className="main" data-testid="inventory-screen">
        {unsavedGuard}
        <Alert>Property unreachable — cannot load inventory.</Alert>
      </div>
    );
  }

  return (
    <div className="ui-page-stack inventory-screen">
      <PageHeader
        title="Inventory"
        subtitle={`${rooms.length} rooms · ${types.length} types`}
      />
      <div className="ui-page-stack" data-testid="inventory-screen">
        {unsavedGuard}
        <Tabs label="Inventory">
          <Link
            className="ui-tab"
            to="/inventory"
            aria-current={activeTab === 'types' ? 'page' : undefined}
          >
            Room Types
          </Link>
          <Link
            className="ui-tab"
            to="/inventory/rooms"
            aria-current={activeTab === 'rooms' ? 'page' : undefined}
          >
            Rooms
          </Link>
        </Tabs>
        {message ? (
          <p className="muted" aria-live="polite">
            {message}
          </p>
        ) : null}
        {createType.isError ||
        archiveType.isError ||
        archiveRoomUnit.isError ||
        addRoom.isError ||
        saveType.isError ? (
          <Alert>
            {inventoryErrorCopy(
              createType.error ??
                archiveRoomUnit.error ??
                archiveType.error ??
                addRoom.error ??
                saveType.error,
              archiveRoomUnit.isError ? 'room' : archiveType.isError ? 'type' : undefined,
            )}
          </Alert>
        ) : null}

        {activeTab === 'types' ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Create Room Type</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSaving(true);
                    createType.mutate(undefined, { onSettled: () => setSaving(false) });
                  }}
                >
                  <FieldGroup inline>
                  <Field
                    label="Kind"
                    control={
                      <NativeSelect
                        value={kind}
                        onChange={(e) => {
                          const next = e.target.value as 'physical' | 'virtual';
                          setKind(next);
                          if (next === 'physical') setConstituentIds([]);
                        }}
                      >
                        <option value="physical">Physical</option>
                        <option value="virtual">Virtual (run-of-house)</option>
                      </NativeSelect>
                    }
                  />
                  <Field
                    label="Code"
                    control={
                      <Input
                        placeholder="KNG"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        autoComplete="off"
                      />
                    }
                  />
                  <Field
                    label="Name"
                    control={
                      <Input
                        placeholder="King"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="off"
                      />
                    }
                  />
                  {kind === 'physical' ? (
                    <Field
                      label="Room Count"
                      control={
                        <Input
                          type="number"
                          min={1}
                          placeholder="10"
                          value={roomCount}
                          onChange={(e) => setRoomCount(e.target.value)}
                          autoComplete="off"
                        />
                      }
                    />
                  ) : (
                    <Field
                      label="Constituents"
                      control={
                        <div data-testid="virtual-constituents" className="ui-stack">
                          {physicalTypes.map((t) => (
                            <label key={t.roomTypeId} className="ui-row">
                              <Checkbox
                                value={t.roomTypeId}
                                checked={constituentIds.includes(t.roomTypeId)}
                                onChange={(e) => {
                                  const id = t.roomTypeId;
                                  setConstituentIds((prev) =>
                                    e.target.checked ? [...prev, id] : prev.filter((x) => x !== id),
                                  );
                                }}
                              />
                              <span translate="no">
                                {t.code} {t.name}
                              </span>
                            </label>
                          ))}
                        </div>
                      }
                    />
                  )}
                  <Field
                    label="Max Occupancy"
                    control={
                      <Input
                        type="number"
                        min={1}
                        placeholder="2"
                        value={maxOccupancy}
                        onChange={(e) => setMaxOccupancy(e.target.value)}
                        autoComplete="off"
                      />
                    }
                  />
                  <Field
                    label="Max Adults"
                    control={
                      <Input
                        type="number"
                        min={1}
                        placeholder="2"
                        value={maxAdults}
                        onChange={(e) => setMaxAdults(e.target.value)}
                        autoComplete="off"
                      />
                    }
                  />
                  <Button type="submit" intent="primary" disabled={saving}>
                    {saving ? 'Saving…' : 'Create Room Type'}
                  </Button>
                  </FieldGroup>
                </form>
              </CardContent>
            </Card>

            {types.length === 0 && typesQ.isSuccess ? (
              <EmptyState title="No room types yet — create one to start selling." />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Room types</CardTitle>
                </CardHeader>
                <CardContent flush>
                    <DataTable>
                      <DataTableHead>
                        <DataTableRow>
                          <DataTableHeaderCell>Code</DataTableHeaderCell>
                          <DataTableHeaderCell>Kind</DataTableHeaderCell>
                          <DataTableHeaderCell>Name</DataTableHeaderCell>
                          <DataTableHeaderCell>Room Count</DataTableHeaderCell>
                          <DataTableHeaderCell>Occupancy</DataTableHeaderCell>
                          <DataTableHeaderCell>Constituents</DataTableHeaderCell>
                          <DataTableHeaderCell>Physical rooms</DataTableHeaderCell>
                          <DataTableHeaderCell />
                        </DataTableRow>
                      </DataTableHead>
                      <DataTableBody>
                        {types.map((t) => {
                          const isVirtual = t.kind === 'virtual';
                          const constituentCodes = (t.constituentRoomTypeIds ?? [])
                            .map((id) => typeCodeById.get(id) ?? id)
                            .join(', ');
                          return (
                            <DataTableRow key={t.roomTypeId}>
                              <DataTableCell>
                                <span translate="no">{t.code}</span>
                              </DataTableCell>
                              <DataTableCell>
                                <Badge rung="informational">{isVirtual ? 'Virtual' : 'Physical'}</Badge>
                              </DataTableCell>
                              <DataTableCell>{t.name}</DataTableCell>
                              <DataTableCell>
                                {isVirtual ? (
                                  '—'
                                ) : (
                                  <Field
                                    label={`Room Count for ${t.code}`}
                                    control={
                                      <Input
                                        type="number"
                                        min={1}
                                        autoComplete="off"
                                        value={typeEdits[t.roomTypeId]?.roomCount ?? String(t.roomCount)}
                                        onChange={(e) =>
                                          setTypeEdits((prev) => ({
                                            ...prev,
                                            [t.roomTypeId]: { roomCount: e.target.value },
                                          }))
                                        }
                                      />
                                    }
                                  />
                                )}
                              </DataTableCell>
                              <DataTableCell>
                                {t.maxAdults} / {t.maxOccupancy}
                              </DataTableCell>
                              <DataTableCell>{isVirtual ? constituentCodes || '—' : '—'}</DataTableCell>
                              <DataTableCell>{roomsByType.get(t.roomTypeId)?.length ?? 0}</DataTableCell>
                              <DataTableCell>
                                <div className="ui-row">
                                  {!isVirtual ? (
                                    <Button type="button" onClick={() => saveType.mutate(t)}>
                                      Save Room Type
                                    </Button>
                                  ) : null}
                                  <Button type="button" onClick={() => setArchiveTarget(t)}>
                                    Archive Room Type
                                  </Button>
                                </div>
                              </DataTableCell>
                            </DataTableRow>
                          );
                        })}
                      </DataTableBody>
                    </DataTable>
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Create Room</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSaving(true);
                    addRoom.mutate(undefined, { onSettled: () => setSaving(false) });
                  }}
                >
                  <FieldGroup inline>
                  <Field
                    label="Room type"
                    control={
                      <NativeSelect value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)}>
                        <option value="">Select…</option>
                        {types.map((t) => (
                          <option key={t.roomTypeId} value={t.roomTypeId}>
                            {t.code} {t.name}
                            {t.kind === 'virtual' ? ' (virtual)' : ''}
                          </option>
                        ))}
                      </NativeSelect>
                    }
                  />
                  {virtualRoomTypeSelected ? (
                    <p className="muted">Virtual types do not have room units.</p>
                  ) : null}
                  <Field
                    label="Room code"
                    control={
                      <Input
                        placeholder="101"
                        value={roomCode}
                        onChange={(e) => setRoomCode(e.target.value)}
                        autoComplete="off"
                        disabled={virtualRoomTypeSelected}
                      />
                    }
                  />
                  <Field
                    label="Floor"
                    control={
                      <Input
                        placeholder="2"
                        value={roomFloor}
                        onChange={(e) => setRoomFloor(e.target.value)}
                        autoComplete="off"
                        disabled={virtualRoomTypeSelected}
                      />
                    }
                  />
                  <Button type="submit" disabled={saving || virtualRoomTypeSelected}>
                    {saving ? 'Saving…' : 'Create Room'}
                  </Button>
                  </FieldGroup>
                </form>
              </CardContent>
            </Card>

            {types.map((t) => {
              const inType = roomsByType.get(t.roomTypeId) ?? [];
              const isVirtual = t.kind === 'virtual';
              return (
                <Card key={t.roomTypeId}>
                  <CardHeader>
                    <CardTitle>
                      <span translate="no">{t.code}</span> {t.name}
                      {isVirtual ? (
                        <>
                          {' '}
                          <Badge rung="informational">Virtual</Badge>
                        </>
                      ) : null}
                    </CardTitle>
                  </CardHeader>
                  {isVirtual ? (
                    <CardContent>
                      <p className="muted">Virtual types do not have room units.</p>
                    </CardContent>
                  ) : inType.length === 0 ? (
                    <CardContent>
                      <EmptyState
                        title={`No rooms in this type — create one. Sellable count is still ${t.roomCount}.`}
                      />
                    </CardContent>
                  ) : (
                    <CardContent flush>
                        <DataTable>
                          <DataTableHead>
                            <DataTableRow>
                              <DataTableHeaderCell>Code</DataTableHeaderCell>
                              <DataTableHeaderCell>Floor</DataTableHeaderCell>
                              <DataTableHeaderCell>Housekeeping</DataTableHeaderCell>
                              <DataTableHeaderCell>OOO</DataTableHeaderCell>
                              <DataTableHeaderCell />
                            </DataTableRow>
                          </DataTableHead>
                          <DataTableBody>
                            {inType.map((room) => {
                              const edit = roomEdits[room.roomId] ?? {
                                code: room.code,
                                floor: room.floor ?? '',
                              };
                              return (
                                <DataTableRow key={room.roomId}>
                                  <DataTableCell>
                                    <Field
                                      label={<VisuallyHidden>{`Code for ${room.code}`}</VisuallyHidden>}
                                      control={
                                        <Input
                                          value={edit.code}
                                          autoComplete="off"
                                          onChange={(e) =>
                                            setRoomEdits((prev) => ({
                                              ...prev,
                                              [room.roomId]: { ...edit, code: e.target.value },
                                            }))
                                          }
                                        />
                                      }
                                    />
                                  </DataTableCell>
                                  <DataTableCell>
                                    <Field
                                      label={<VisuallyHidden>{`Floor for ${room.code}`}</VisuallyHidden>}
                                      control={
                                        <Input
                                          value={edit.floor}
                                          autoComplete="off"
                                          onChange={(e) =>
                                            setRoomEdits((prev) => ({
                                              ...prev,
                                              [room.roomId]: { ...edit, floor: e.target.value },
                                            }))
                                          }
                                        />
                                      }
                                    />
                                  </DataTableCell>
                                  <DataTableCell>
                                    <RoomStatus status={room.status} />
                                  </DataTableCell>
                                  <DataTableCell>
                                    {room.oooRanges.length
                                      ? room.oooRanges.map((r) => `${r.startDate}–${r.endDate}`).join(', ')
                                      : '—'}
                                  </DataTableCell>
                                  <DataTableCell>
                                    <div className="ui-row">
                                      <Button
                                        type="button"
                                        onClick={async () => {
                                          setSaving(true);
                                          try {
                                            await api.updateRoom(propertyId, room.roomId, {
                                              code: edit.code,
                                              floor: edit.floor || undefined,
                                            });
                                            setMessage('Saved.');
                                            await queryClient.invalidateQueries({ queryKey: ['rooms', propertyId] });
                                          } catch (err) {
                                            setMessage(inventoryErrorCopy(err));
                                          } finally {
                                            setSaving(false);
                                          }
                                        }}
                                      >
                                        Save Room {room.code}
                                      </Button>
                                      <Button
                                        type="button"
                                        onClick={() =>
                                          setRoomArchiveTarget({ roomId: room.roomId, code: room.code })
                                        }
                                      >
                                        Archive {room.code}
                                      </Button>
                                    </div>
                                  </DataTableCell>
                                </DataTableRow>
                              );
                            })}
                          </DataTableBody>
                        </DataTable>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </>
        )}

        {archiveTarget ? (
          <ConfirmDialog
            title={`Archive ${archiveTarget.code}?`}
            description={`Archive ${archiveTarget.code}? It will stop being sellable. Existing rooms and history stay.`}
            confirmLabel="Archive"
            intent="destructive"
            onCancel={() => setArchiveTarget(null)}
            onConfirm={() => archiveType.mutate(archiveTarget.roomTypeId)}
          />
        ) : null}
        {roomArchiveTarget ? (
          <ConfirmDialog
            title={`Archive ${roomArchiveTarget.code}?`}
            description={`Archive ${roomArchiveTarget.code}? It will free a unit slot. History stays.`}
            confirmLabel="Archive"
            intent="destructive"
            onCancel={() => setRoomArchiveTarget(null)}
            onConfirm={() => archiveRoomUnit.mutate({ roomId: roomArchiveTarget.roomId })}
          />
        ) : null}
      </div>
    </div>
  );
}