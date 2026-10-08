/**
 * Ownership-column discovery — "do not assume the 11-table list is exhaustive".
 *
 * The reconciliation used to move a HAND-WRITTEN list of eleven tables. That
 * list was correct on the day it was written and silently wrong the moment a
 * migration added another table keyed by an account id: the owner's records
 * would move, the new table's rows would stay on the orphan, and the
 * verification — which reads the SAME hand-written list — would report a clean
 * migration over a split graph. A list that validates itself proves nothing.
 *
 * This module asks the DATABASE instead. It reads `information_schema` for
 * every base table in the public schema that carries an ownership column, and
 * classifies each one:
 *
 *   · `move`     — customer-owned rows: they follow the owner.
 *   · `preserve` — history and identity: `admin_audit_log` (who did what, and
 *                  when, must keep naming the id that did it), the first-party
 *                  identity store, the legacy auth projection, and
 *                  `admin_users` (authority is migrated by its own atomic
 *                  path, `owner-admin-rebind.server.ts`, which also retires
 *                  the orphan row).
 *   · `ignore`   — a column whose name matches but which does not hold an
 *                  account id (`admin_users.created_by` holds a provenance
 *                  string such as `system:owner-bootstrap`).
 *
 * Anything discovered that is not explicitly preserved or ignored is MOVED and
 * named in the plan, so a future table is included by default instead of being
 * forgotten by default. Table and column names come from the catalogue, are
 * validated against a strict identifier pattern, and are never taken from a
 * request.
 */
import type { Sql } from "../db.ts";

/** Columns that can hold the id of the account a row belongs to. */
export const OWNERSHIP_COLUMNS = [
  "user_id",
  "owner_id",
  "account_id",
  "organization_id",
  "created_by",
] as const;

export type OwnershipColumn = (typeof OWNERSHIP_COLUMNS)[number];

export type SweepDisposition = "move" | "preserve" | "ignore";

export type DiscoveredOwnershipColumn = {
  table: string;
  column: OwnershipColumn;
  disposition: SweepDisposition;
  /** Why it is preserved/ignored. Empty for `move`. */
  reason: string;
};

/**
 * Tables whose ownership columns must NOT be rewritten, and why.
 *
 * Each entry is a deliberate decision, not an oversight: rewriting any of them
 * would destroy evidence (audit), forge identity (the auth store), or race the
 * dedicated atomic path that already handles it (authority).
 */
export const PRESERVED_TABLES: Readonly<Record<string, string>> = {
  admin_audit_log: "audit history must keep naming the id that acted",
  admin_users: "authority is migrated atomically by the admin rebind, which also retires the orphan row",
  auth_users: "the first-party identity store is the identity, not a record about one",
  auth_sessions: "sessions belong to the account that opened them and expire on their own",
  auth_throttle: "abuse counters are per credential, not per owner",
  user: "legacy auth projection — the pre-migration identity it describes must stay readable",
  account: "legacy auth projection (provider links)",
  session: "legacy auth projection (sessions)",
  verification: "legacy auth projection (verification tokens)",
};

/** Column matches by name but never holds an account id. */
const IGNORED_COLUMNS: ReadonlyArray<{ table: string; column: string; reason: string }> = [
  {
    table: "admin_users",
    column: "created_by",
    reason: "provenance string (e.g. system:owner-bootstrap), not an account id",
  },
];

/** Postgres identifiers we are willing to interpolate into SQL text. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export function isSafeIdentifier(value: string): boolean {
  return SAFE_IDENTIFIER.test(value);
}

/**
 * Classify one discovered column. Pure, so the policy is unit-testable without
 * a database.
 */
export function classifyOwnershipColumn(
  table: string,
  column: OwnershipColumn,
): { disposition: SweepDisposition; reason: string } {
  const ignored = IGNORED_COLUMNS.find((entry) => entry.table === table && entry.column === column);
  if (ignored) return { disposition: "ignore", reason: ignored.reason };
  const preserved = PRESERVED_TABLES[table];
  if (preserved) return { disposition: "preserve", reason: preserved };
  return { disposition: "move", reason: "" };
}

/**
 * Every ownership column in the live schema, classified.
 *
 * Read-only and never throws: a catalogue that cannot be read yields an empty
 * sweep, and the caller falls back to the statically known tables rather than
 * refusing to migrate.
 */
export async function discoverOwnershipColumns(sql: Sql): Promise<DiscoveredOwnershipColumn[]> {
  let rows: Array<{ table_name: string; column_name: string }> = [];
  try {
    rows = await sql.query<{ table_name: string; column_name: string }>(
      `select c.table_name, c.column_name
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public'
          and t.table_type = 'BASE TABLE'
          and c.column_name = any($1::text[])
        order by c.table_name, c.column_name`,
      [[...OWNERSHIP_COLUMNS]],
    );
  } catch {
    return [];
  }
  const discovered: DiscoveredOwnershipColumn[] = [];
  for (const row of rows) {
    const table = String(row.table_name ?? "");
    const column = String(row.column_name ?? "") as OwnershipColumn;
    if (!isSafeIdentifier(table) || !OWNERSHIP_COLUMNS.includes(column)) continue;
    const { disposition, reason } = classifyOwnershipColumn(table, column);
    discovered.push({ table, column, disposition, reason });
  }
  return discovered;
}

export type MovableOwnershipColumn = {
  table: string;
  column: OwnershipColumn;
  /**
   * True when the ownership column is (part of) the primary key, so a row can
   * only move into a destination that does not already hold one — two accounts
   * must never collapse into a single row.
   */
  keyed: boolean;
};

/**
 * The columns the reconciliation may rewrite, with their primary-key status
 * resolved from the catalogue (never from a hand-maintained list).
 */
export async function discoverMovableOwnership(sql: Sql): Promise<MovableOwnershipColumn[]> {
  const discovered = (await discoverOwnershipColumns(sql)).filter(
    (entry) => entry.disposition === "move",
  );
  if (!discovered.length) return [];

  let keyRows: Array<{ table_name: string; column_name: string }> = [];
  try {
    keyRows = await sql.query<{ table_name: string; column_name: string }>(
      `select tc.table_name, kcu.column_name
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_name = tc.constraint_name
          and kcu.table_schema = tc.table_schema
        where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY'`,
    );
  } catch {
    keyRows = [];
  }
  const primaryKeys = new Set(keyRows.map((row) => `${row.table_name}.${row.column_name}`));

  return discovered.map((entry) => ({
    table: entry.table,
    column: entry.column,
    keyed: primaryKeys.has(`${entry.table}.${entry.column}`),
  }));
}
