import { ClassifiedError } from '@hospai/client-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Button,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Field,
  Input,
  NativeSelect,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { useUnsavedChanges } from './use-unsaved-changes.js';

type RoomTypeRow = {
  roomTypeId: string;
  code: string;
  name: string;
  roomCount: number;
  maxOccupancy: number;
  maxAdults: number;
  status: 'active' | 'archived';
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

function inventoryErrorCopy(err: unknown): string {
  const code = wireCode(err);
  if (code === 'room_type_code_exists') return 'An active room type already uses this code.';
  if (code === 'room_units_exceed_count') {
    return 'Cannot lower room count below the number of rooms. Rename rooms or wait for a delete path.';
  }
  if (code === 'archive_blocked') {
    return 'This type still has future sold or blocked inventory — it cannot be archived.';
  }
  if (code === 'room_count_exceeded') {
    return 'This type’s room count is full. Raise the type’s room count first.';
  }
  if (code === 'room_code_exists') return 'Room code already exists.';
  const c = asClassified(err);
  if (c.class === 'fail_closed') return 'Property unreachable — cannot load inventory.';
  return `Request failed (${c.class})`;
}

export function InventoryScreen({ tab }: { tab?: 'types' | 'rooms' }) {
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const activeTab = tab ?? 'types';
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<RoomTypeRow | null>(null);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
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
        roomCount: Number(roomCount),
        maxOccupancy: Number(maxOccupancy),
        maxAdults: Number(maxAdults),
      }),
    onSuccess: async () => {
      setCode('');
      setName('');
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
    <div className="panel" data-testid="inventory-screen">
      {unsavedGuard}
      <h1>Inventory</h1>
      <nav className="nav">
        <Link to="/inventory">Room Types</Link>
        <Link to="/inventory/rooms">Rooms</Link>
      </nav>
      {message ? (
        <p className="muted" aria-live="polite">
          {message}
        </p>
      ) : null}
      {createType.isError || archiveType.isError || addRoom.isError || saveType.isError ? (
        <Alert>{inventoryErrorCopy(createType.error ?? archiveType.error ?? addRoom.error ?? saveType.error)}</Alert>
      ) : null}

      {activeTab === 'types' ? (
        <>
          {types.length === 0 && typesQ.isSuccess ? (
            <p className="muted">No room types yet — create one to start selling.</p>
          ) : (
            <DataTable>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Code</DataTableHeaderCell>
                  <DataTableHeaderCell>Name</DataTableHeaderCell>
                  <DataTableHeaderCell>Room Count</DataTableHeaderCell>
                  <DataTableHeaderCell>Occupancy</DataTableHeaderCell>
                  <DataTableHeaderCell>Physical rooms</DataTableHeaderCell>
                  <DataTableHeaderCell />
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {types.map((t) => (
                  <DataTableRow key={t.roomTypeId}>
                    <DataTableCell>
                      <span translate="no">{t.code}</span>
                    </DataTableCell>
                    <DataTableCell>{t.name}</DataTableCell>
                    <DataTableCell>
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
                    </DataTableCell>
                    <DataTableCell>
                      {t.maxAdults} / {t.maxOccupancy}
                    </DataTableCell>
                    <DataTableCell>{roomsByType.get(t.roomTypeId)?.length ?? 0}</DataTableCell>
                    <DataTableCell>
                      <Button type="button" intent="primary" onClick={() => saveType.mutate(t)}>
                        Save Room Type
                      </Button>
                      <Button type="button" intent="destructive" onClick={() => setArchiveTarget(t)}>
                        Archive Room Type
                      </Button>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          )}

          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              setSaving(true);
              createType.mutate(undefined, { onSettled: () => setSaving(false) });
            }}
          >
            <h2>Create Room Type</h2>
            <Field
              label="Code"
              control={
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Name"
              control={<Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}
            />
            <Field
              label="Room Count"
              control={
                <Input
                  type="number"
                  min={1}
                  value={roomCount}
                  onChange={(e) => setRoomCount(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Max Occupancy"
              control={
                <Input
                  type="number"
                  min={1}
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
                  value={maxAdults}
                  onChange={(e) => setMaxAdults(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Button type="submit" intent="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Create Room Type'}
            </Button>
          </form>
        </>
      ) : (
        <>
          {types.map((t) => {
            const inType = roomsByType.get(t.roomTypeId) ?? [];
            return (
              <section key={t.roomTypeId}>
                <h2>
                  <span translate="no">{t.code}</span> {t.name}
                </h2>
                {inType.length === 0 ? (
                  <p className="muted">
                    No rooms in this type — create one. Sellable count is still {t.roomCount}.
                  </p>
                ) : (
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
                                label={`Code for ${room.code}`}
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
                                label={`Floor for ${room.code}`}
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
                            <DataTableCell>{room.status}</DataTableCell>
                            <DataTableCell>
                              {room.oooRanges.length
                                ? room.oooRanges.map((r) => `${r.startDate}–${r.endDate}`).join(', ')
                                : '—'}
                            </DataTableCell>
                            <DataTableCell>
                              <Button
                                type="button"
                                intent="primary"
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
                            </DataTableCell>
                          </DataTableRow>
                        );
                      })}
                    </DataTableBody>
                  </DataTable>
                )}
              </section>
            );
          })}

          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              setSaving(true);
              addRoom.mutate(undefined, { onSettled: () => setSaving(false) });
            }}
          >
            <h2>Create Room</h2>
            <Field
              label="Room type"
              control={
                <NativeSelect value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)}>
                  <option value="">Select…</option>
                  {types.map((t) => (
                    <option key={t.roomTypeId} value={t.roomTypeId}>
                      {t.code} {t.name}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
            <Field
              label="Room code"
              control={
                <Input
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Floor"
              control={
                <Input value={roomFloor} onChange={(e) => setRoomFloor(e.target.value)} autoComplete="off" />
              }
            />
            <Button type="submit" intent="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Create Room'}
            </Button>
          </form>
        </>
      )}

      {archiveTarget ? (
        <div role="dialog" aria-modal="true" className="panel overscroll-contain">
          <p>Archive {archiveTarget.code}? It will stop being sellable. Existing rooms and history stay.</p>
          <Button type="button" onClick={() => setArchiveTarget(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            intent="destructive"
            onClick={() => archiveType.mutate(archiveTarget.roomTypeId)}
            disabled={archiveType.isPending}
          >
            {archiveType.isPending ? 'Archiving…' : 'Archive'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
