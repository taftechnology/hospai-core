import type { ModuleSql } from '@hospai/contracts';

/** In-memory SqlStorageLike for module-unit tests (not used in production). */
class MemorySql implements ModuleSql {
  rooms = new Map<
    string,
    { room_id: string; status: string; updated_at: number; archived_at?: number | null }
  >();
  priorities = new Map<
    string,
    {
      room_id: string;
      business_date: string;
      level: string;
      set_by: string;
      updated_at: number;
    }
  >();
  assignments = new Map<
    string,
    {
      assignment_id: string;
      room_id: string;
      business_date: string;
      assignee_ref: string;
      created_at: number;
      updated_at: number;
    }
  >();
  inventoryItems = new Map<
    string,
    {
      item_id: string;
      name: string;
      category: string;
      unit: string;
      par_level: number;
      on_hand: number;
      archived_at: number | null;
      created_at: number;
      updated_at: number;
    }
  >();
  inventoryMovements: Array<{
    movement_id: string;
    item_id: string;
    kind: string;
    quantity: number;
    on_hand_after: number;
    note: string | null;
    actor_ref: string;
    business_date: string;
    created_at: number;
  }> = [];

  exec(query: string, ...bindings: unknown[]): { toArray(): unknown[] } {
    const q = query.replace(/\s+/g, ' ').trim();

    if (q.startsWith('SELECT room_id, archived_at FROM room')) {
      const roomId = bindings[0] as string;
      const row = this.rooms.get(roomId);
      return {
        toArray: () =>
          row ? [{ room_id: row.room_id, archived_at: row.archived_at ?? null }] : [],
      };
    }

    if (q.startsWith('SELECT room_id FROM room')) {
      const roomId = bindings[0] as string;
      const row = this.rooms.get(roomId);
      return { toArray: () => (row ? [{ room_id: row.room_id }] : []) };
    }

    if (q.startsWith('SELECT status FROM room')) {
      const roomId = bindings[0] as string;
      const row = this.rooms.get(roomId);
      return { toArray: () => (row ? [{ status: row.status }] : []) };
    }

    if (q.startsWith('UPDATE room SET status')) {
      const [status, updatedAt, roomId] = bindings as [string, number, string];
      const row = this.rooms.get(roomId);
      if (row) {
        row.status = status;
        row.updated_at = updatedAt;
      }
      return { toArray: () => [] };
    }

    // List query before the assignment_id-only lookup (both contain SELECT assignment_id).
    if (
      q.includes('FROM housekeeping_assignment') &&
      q.includes('SELECT assignment_id, room_id, business_date')
    ) {
      const businessDate = bindings[0] as string;
      const rows = [...this.assignments.values()]
        .filter((a) => a.business_date === businessDate)
        .sort((a, b) => a.room_id.localeCompare(b.room_id));
      return { toArray: () => rows };
    }

    if (q.includes('FROM housekeeping_assignment') && q.includes('SELECT assignment_id')) {
      const key = `${bindings[0]}|${bindings[1]}`;
      const row = this.assignments.get(key);
      return { toArray: () => (row ? [{ assignment_id: row.assignment_id }] : []) };
    }

    if (q.startsWith('DELETE FROM housekeeping_priority')) {
      const key = `${bindings[0]}|${bindings[1]}`;
      this.priorities.delete(key);
      return { toArray: () => [] };
    }

    if (q.startsWith('INSERT INTO housekeeping_priority')) {
      const [roomId, businessDate, level, setBy, updatedAt] = bindings as [
        string,
        string,
        string,
        string,
        number,
      ];
      const key = `${roomId}|${businessDate}`;
      this.priorities.set(key, {
        room_id: roomId,
        business_date: businessDate,
        level,
        set_by: setBy,
        updated_at: updatedAt,
      });
      return { toArray: () => [] };
    }

    if (q.startsWith('INSERT INTO housekeeping_assignment')) {
      const [assignmentId, roomId, businessDate, assigneeRef, createdAt, updatedAt] = bindings as [
        string,
        string,
        string,
        string,
        number,
        number,
      ];
      const key = `${roomId}|${businessDate}`;
      const existing = this.assignments.get(key);
      this.assignments.set(key, {
        assignment_id: existing?.assignment_id ?? assignmentId,
        room_id: roomId,
        business_date: businessDate,
        assignee_ref: assigneeRef,
        created_at: existing?.created_at ?? createdAt,
        updated_at: updatedAt,
      });
      return { toArray: () => [] };
    }

    if (q.includes('COUNT(*) AS n FROM housekeeping_inventory_item WHERE archived_at IS NULL')) {
      const n = [...this.inventoryItems.values()].filter((i) => i.archived_at == null).length;
      return { toArray: () => [{ n }] };
    }

    if (q.startsWith('SELECT * FROM housekeeping_inventory_item WHERE item_id')) {
      const itemId = bindings[0] as string;
      const row = this.inventoryItems.get(itemId);
      return { toArray: () => (row ? [row] : []) };
    }

    if (
      q.includes('SELECT item_id FROM housekeeping_inventory_item') &&
      q.includes('lower(name) = lower(?)') &&
      q.includes('item_id != ?')
    ) {
      const [name, excludeId] = bindings as [string, string];
      const hit = [...this.inventoryItems.values()].find(
        (i) =>
          i.archived_at == null &&
          i.item_id !== excludeId &&
          i.name.toLowerCase() === name.toLowerCase(),
      );
      return { toArray: () => (hit ? [{ item_id: hit.item_id }] : []) };
    }

    if (
      q.includes('SELECT item_id FROM housekeeping_inventory_item') &&
      q.includes('lower(name) = lower(?)') &&
      !q.includes('item_id != ?')
    ) {
      const name = bindings[0] as string;
      const hit = [...this.inventoryItems.values()].find(
        (i) => i.archived_at == null && i.name.toLowerCase() === name.toLowerCase(),
      );
      return { toArray: () => (hit ? [{ item_id: hit.item_id }] : []) };
    }

    if (q.startsWith('SELECT item_id FROM housekeeping_inventory_item WHERE item_id')) {
      const itemId = bindings[0] as string;
      return { toArray: () => (this.inventoryItems.has(itemId) ? [{ item_id: itemId }] : []) };
    }

    if (q.startsWith('INSERT INTO housekeeping_inventory_item')) {
      const [itemId, name, category, unit, parLevel, onHand, createdAt, updatedAt] = bindings as [
        string,
        string,
        string,
        string,
        number,
        number,
        number,
        number,
      ];
      this.inventoryItems.set(itemId, {
        item_id: itemId,
        name,
        category,
        unit,
        par_level: parLevel,
        on_hand: onHand,
        archived_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { toArray: () => [] };
    }

    if (q.startsWith('UPDATE housekeeping_inventory_item SET name')) {
      const [name, category, unit, parLevel, archivedAt, updatedAt, itemId] = bindings as [
        string,
        string,
        string,
        number,
        number | null,
        number,
        string,
      ];
      const row = this.inventoryItems.get(itemId);
      if (row) {
        row.name = name;
        row.category = category;
        row.unit = unit;
        row.par_level = parLevel;
        row.archived_at = archivedAt;
        row.updated_at = updatedAt;
      }
      return { toArray: () => [] };
    }

    if (q.startsWith('UPDATE housekeeping_inventory_item SET on_hand')) {
      const [onHand, updatedAt, itemId] = bindings as [number, number, string];
      const row = this.inventoryItems.get(itemId);
      if (row) {
        row.on_hand = onHand;
        row.updated_at = updatedAt;
      }
      return { toArray: () => [] };
    }

    if (q.startsWith('INSERT INTO housekeeping_inventory_movement')) {
      if (q.includes("'count'")) {
        const [movementId, itemId, quantity, onHandAfter, actorRef, businessDate, createdAt] =
          bindings as [string, string, number, number, string, string, number];
        this.inventoryMovements.push({
          movement_id: movementId,
          item_id: itemId,
          kind: 'count',
          quantity,
          on_hand_after: onHandAfter,
          note: null,
          actor_ref: actorRef,
          business_date: businessDate,
          created_at: createdAt,
        });
      } else {
        const [
          movementId,
          itemId,
          kind,
          quantity,
          onHandAfter,
          note,
          actorRef,
          businessDate,
          createdAt,
        ] = bindings as [string, string, string, number, number, string | null, string, string, number];
        this.inventoryMovements.push({
          movement_id: movementId,
          item_id: itemId,
          kind,
          quantity,
          on_hand_after: onHandAfter,
          note,
          actor_ref: actorRef,
          business_date: businessDate,
          created_at: createdAt,
        });
      }
      return { toArray: () => [] };
    }

    if (
      q.includes('FROM housekeeping_inventory_item') &&
      q.includes('WHERE archived_at IS NULL') &&
      q.includes('ORDER BY lower(name)')
    ) {
      const rows = [...this.inventoryItems.values()]
        .filter((i) => i.archived_at == null)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      return {
        toArray: () =>
          rows.map((r) => ({
            item_id: r.item_id,
            name: r.name,
            category: r.category,
            unit: r.unit,
            par_level: r.par_level,
            on_hand: r.on_hand,
            archived_at: r.archived_at,
          })),
      };
    }

    if (
      q.includes('FROM housekeeping_inventory_item') &&
      q.includes('ORDER BY lower(name)') &&
      !q.includes('WHERE archived_at IS NULL')
    ) {
      const rows = [...this.inventoryItems.values()].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );
      return {
        toArray: () =>
          rows.map((r) => ({
            item_id: r.item_id,
            name: r.name,
            category: r.category,
            unit: r.unit,
            par_level: r.par_level,
            on_hand: r.on_hand,
            archived_at: r.archived_at,
          })),
      };
    }

    if (
      q.includes('FROM housekeeping_inventory_movement') &&
      q.includes('ORDER BY created_at DESC')
    ) {
      const itemId = bindings[0] as string;
      const limit = bindings[1] as number;
      const rows = this.inventoryMovements
        .map((m, index) => ({ m, index }))
        .filter(({ m }) => m.item_id === itemId)
        .sort((a, b) => b.m.created_at - a.m.created_at || b.index - a.index)
        .slice(0, limit)
        .map(({ m }) => m);
      return { toArray: () => rows };
    }

    throw new Error(`Unhandled SQL in MemorySql: ${q}`);
  }
}

export { MemorySql };
