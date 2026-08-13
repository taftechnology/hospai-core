export async function insertPendingOpen(
  db: D1Database,
  row: {
    propertyId: string;
    idempotencyKey: string;
    businessDate: string;
    commandId: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO pending_command_open
         (property_id, idempotency_key, business_date, command_id, enqueued_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      row.propertyId,
      row.idempotencyKey,
      row.businessDate,
      row.commandId,
      new Date().toISOString(),
    )
    .run();
}

export async function deletePendingOpen(
  db: D1Database,
  propertyId: string,
  idempotencyKey: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM pending_command_open WHERE property_id = ? AND idempotency_key = ?`)
    .bind(propertyId, idempotencyKey)
    .run();
}

export async function countPendingOpen(db: D1Database, propertyId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM pending_command_open WHERE property_id = ?`)
    .bind(propertyId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}
