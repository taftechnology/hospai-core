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

    throw new Error(`Unhandled SQL in MemorySql: ${q}`);
  }
}

export { MemorySql };
