/**
 * Minting short share codes — server only.
 *
 * `short-code.ts` holds the alphabet and validation (safe to import from the
 * browser); this file owns the two things a browser must never do: generate
 * random codes and write them to the database.
 *
 * A code is minted ONCE per template and then reused forever, so a link that
 * was already shared never changes under the recipient.
 */

import { SHORT_CODE_LENGTH, normalizeShortCode, shortCodeFromBytes } from "@/lib/templates/short-code";

type Queryable = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

/** The tables that own a `short_code` column. */
export type ShortCodeTable = "admin_templates" | "user_templates";

/** Fresh random code. `node:crypto` is loaded lazily: never bundled client-side. */
export async function newShortCode(): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  return shortCodeFromBytes(new Uint8Array(randomBytes(SHORT_CODE_LENGTH)), SHORT_CODE_LENGTH);
}

/**
 * Gives every existing row in a table a short code, once.
 *
 * Codes are minted on save, but a catalogue that predates them would otherwise
 * only ever produce long addresses. This is idempotent and cheap: after the
 * first pass the `WHERE short_code IS NULL` select returns nothing.
 */
export async function backfillShortCodes(
  sql: Queryable,
  table: ShortCodeTable,
  limit = 500,
): Promise<void> {
  try {
    const rows = await sql.query<{ id: string }>(
      `SELECT id FROM ${table} WHERE short_code IS NULL LIMIT $1`,
      [limit],
    );
    for (const row of rows) await ensureShortCode(sql, table, String(row.id));
  } catch (err) {
    /* A missing code never breaks the read that asked for the backfill. */
    console.error(`[templates] short-code backfill skipped for ${table}:`, err);
  }
}

/**
 * Returns the row's short code, minting and storing one if it has none.
 *
 * The write is `WHERE short_code IS NULL` so two concurrent saves can never
 * replace an already-published code, and a unique-index collision is retried
 * with a new candidate instead of failing the save. A failure here must never
 * break the operation that asked for the code — the long address still works —
 * so it degrades to `null` and logs.
 */
export async function ensureShortCode(
  sql: Queryable,
  table: ShortCodeTable,
  id: string,
): Promise<string | null> {
  if (!id) return null;
  try {
    const rows = await sql.query<{ short_code: string | null }>(
      `SELECT short_code FROM ${table} WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!rows.length) return null;
    const existing = normalizeShortCode(rows[0].short_code);
    if (existing) return existing;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const code = await newShortCode();
      try {
        const updated = await sql.query<{ id: string }>(
          `UPDATE ${table} SET short_code = $2 WHERE id = $1 AND short_code IS NULL RETURNING id`,
          [id, code],
        );
        if (updated.length) return code;
        /* Someone else minted it in the meantime — read theirs back. */
        const after = await sql.query<{ short_code: string | null }>(
          `SELECT short_code FROM ${table} WHERE id = $1 LIMIT 1`,
          [id],
        );
        return normalizeShortCode(after[0]?.short_code);
      } catch {
        /* Unique-index collision: try another code. */
      }
    }
    return null;
  } catch (err) {
    console.error(`[templates] short code unavailable for ${table}/${id}:`, err);
    return null;
  }
}
