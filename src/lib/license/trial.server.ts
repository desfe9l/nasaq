import type { Sql } from "@/lib/db";

const DAY_MS = 86_400_000;
export type TrialWindow = { startedAt: string; expiresAt: string };

/** Start-once, server-owned 3-day trial. Expiry is never read from the browser. */
export async function getTrial(sql: Sql, userId: string, now = new Date()): Promise<TrialWindow | null> {
  const rows = await sql<{ started_at: string | Date; expires_at: string | Date }>`
    insert into account_trials (user_id, started_at, expires_at)
    values (${userId}, ${now.toISOString()}, ${new Date(now.getTime() + 3 * DAY_MS).toISOString()})
    on conflict (user_id) do update set user_id = excluded.user_id
    returning started_at, expires_at
  `;
  const row = rows[0];
  return { startedAt: new Date(row.started_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString() };
}
