/**
 * Owner identity reconciliation — moving the owner's OWN records back onto the
 * account they actually sign in with.
 *
 * ## The failure this module exists for
 *
 * #153 started a new identity store; #156 re-bound administrator AUTHORITY to
 * the account the owner signs in with (the durable binding). But authority is
 * not entitlement. Licences, subscriptions, licence claims, payment requests,
 * trials, templates, cloud projects and storage assets are all keyed by the
 * same account id — and they stayed on the orphaned pre-migration id. The
 * owner therefore held the console with one id while every commercial record
 * still named an id nobody can sign in as: the account view derived FREE, the
 * licence tools listed the owner's licence under a phantom account, and every
 * surface that reads ownership directly answered "no licence".
 *
 * ## The repair, and its guards
 *
 * The durable owner binding is the authority here, exactly as it is for the
 * administrator decision: the ONLY caller this runs for is the account the
 * binding names, and the ONLY records it touches are those owned by an id that
 * the binding proved is that same person's ORPHAN:
 *
 *   1. the id recorded as `previousUserId` when authority was transferred from
 *      an orphaned `admin_users` row, and
 *   2. ids found in the legacy `"user"` projection (the table pre-migration ids
 *      lived in) whose address is the binding's own address.
 *
 * An id is only ever treated as an orphan when the identity store does NOT
 * resolve it — a live account's records are untouchable, always. If the store
 * is not answering, nothing runs: "unknown" must never read as "orphaned".
 *
 * What this module never does: create a licence or subscription, invent a
 * purchase, match a caller by an address alone, or widen anyone's access. It
 * moves rows that already existed, and records what moved.
 */
import type { Sql } from "../db.ts";
import {
  isBoundOwner,
  readOwnerBinding,
  type IdentityDirectory,
  type OwnerBinding,
} from "./owner-binding.server.ts";
import { nextReboundFrom } from "../license/scope.ts";

/** `site_settings` key recording the last reconciliation — server-only state. */
export const OWNER_RECONCILIATION_KEY = "nasaq.owner_reconciliation.v1";

/** Every table that keys customer-owned data by `user_id`. */
export type ReconcileTable =
  | "licenses"
  | "license_claims"
  | "subscriptions"
  | "payment_requests"
  | "account_trials"
  | "library_catalog"
  | "user_templates"
  | "cloud_projects"
  | "storage_assets"
  | "storage_projects"
  | "client_requests";

export type ReconciliationResult = {
  /** The account the records were reconciled onto. */
  userId: string;
  /** Orphaned ids that were proven to belong to the owner. */
  orphans: string[];
  /** Rows moved per table (absent = nothing to move for that table). */
  moved: Partial<Record<ReconcileTable, number>>;
  movedTotal: number;
  at: string;
};

/**
 * Every table whose rows are owned by a `user_id` column, and how a row moves.
 *
 * `keyed` marks a table whose user column is also its primary key (a trial, a
 * library catalogue): such a row can only move when the destination does not
 * already hold one, because two accounts must never collapse into a single row
 * — the owner's own data would otherwise be silently overwritten.
 *
 * Names are module constants, never input: the SQL text that names a table is
 * chosen here, and the owner ids are always parameters.
 */
export const OWNED_TABLES: ReadonlyArray<{ table: ReconcileTable; keyed: boolean }> = [
  { table: "licenses", keyed: false },
  { table: "license_claims", keyed: false },
  { table: "subscriptions", keyed: false },
  { table: "payment_requests", keyed: false },
  { table: "account_trials", keyed: true },
  { table: "library_catalog", keyed: true },
  { table: "user_templates", keyed: false },
  { table: "cloud_projects", keyed: false },
  { table: "storage_assets", keyed: false },
  { table: "storage_projects", keyed: false },
  { table: "client_requests", keyed: false },
];

/** Ids are joined into ONE parameter so no dynamic placeholder count is needed. */
const ID_SEPARATOR = "\n";

function idParam(ids: readonly string[]): string {
  return ids.join(ID_SEPARATOR);
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

/**
 * The orphaned pre-migration ids that provably belong to this binding's owner.
 *
 * Never guesses: every candidate must be absent from the identity store (an id
 * that resolves is a live account and keeps its rows), must not be the
 * canonical id itself, and must come from a source that already proved
 * ownership — the binding's own `previousUserId`, or a legacy projection row
 * carrying the binding's address.
 */
export async function provenOwnerOrphanIds(
  sql: Sql,
  binding: OwnerBinding,
  directory: IdentityDirectory,
): Promise<string[]> {
  if (!binding.userId) return [];
  const candidates: string[] = [];
  if (binding.previousUserId) candidates.push(binding.previousUserId);
  if (binding.email) {
    try {
      const rows = await sql.query<{ id: string }>(
        `select id from "user" where lower(email) = $1 limit 5`,
        [binding.email.toLowerCase()],
      );
      for (const row of rows) candidates.push(String(row.id));
    } catch {
      /* no legacy projection — the recorded id is still enough */
    }
  }
  const orphans: string[] = [];
  for (const candidate of unique(candidates)) {
    if (!candidate || candidate === binding.userId || candidate === "dev-user") continue;
    // A live account can sign in, so it is NOT an orphan: leave its rows alone.
    if (await directory.lookup(candidate)) continue;
    orphans.push(candidate);
  }
  return orphans;
}

/** True when at least one row still names one of these ids. */
async function anyRowsFor(
  sql: Sql,
  table: ReconcileTable,
  orphanIds: readonly string[],
): Promise<boolean> {
  if (!orphanIds.length) return false;
  try {
    const rows = await sql.query<{ one: number }>(
      `select 1 as one from ${table}
        where user_id = any(string_to_array($1, E'\\n')) limit 1`,
      [idParam(orphanIds)],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Move every row owned by an orphaned id onto the canonical account.
 *
 * Plain tables move wholesale. Tables keyed BY `user_id` move only when the
 * destination does not already hold that row. Subscriptions additionally
 * respect the one-live-entitlement index: lapsed history always moves, and a
 * live row moves only when the canonical account holds no live entitlement —
 * nothing is ever expired or deleted to make room.
 *
 * Keygen licences keep their story: the ids the licence was verified for are
 * appended to `metadata.ownerReboundFrom`, so the scope follows the owner
 * without pretending the provider said something it did not.
 */
export async function rebindOwnerOwnership(
  sql: Sql,
  input: { userId: string; orphanIds: readonly string[]; at?: Date },
): Promise<ReconciliationResult> {
  const userId = input.userId.trim();
  const orphans = unique(input.orphanIds).filter((id) => id !== userId);
  const at = input.at ?? new Date();
  const result: ReconciliationResult = {
    userId,
    orphans,
    moved: {},
    movedTotal: 0,
    at: at.toISOString(),
  };
  if (!orphans.length) return result;

  const bump = (table: ReconcileTable, count: number) => {
    if (!count) return;
    result.moved[table] = (result.moved[table] ?? 0) + count;
    result.movedTotal += count;
  };

  for (const { table, keyed } of OWNED_TABLES) {
    if (!(await anyRowsFor(sql, table, orphans))) continue;
    try {
      if (table === "subscriptions") {
        bump(table, await moveSubscriptions(sql, userId, orphans));
        continue;
      }
      const rows = keyed
        ? await sql.query<{ n: number }>(
            `update ${table} as target
                set user_id = $2
              where target.user_id = any(string_to_array($1, E'\\n'))
                and not exists (
                  select 1 from ${table} as taken where taken.user_id = $2
                )
              returning 1`,
            [idParam(orphans), userId],
          )
        : await sql.query<{ n: number }>(
            `update ${table}
                set user_id = $2
              where user_id = any(string_to_array($1, E'\\n'))
              returning 1`,
            [idParam(orphans), userId],
          );
      bump(table, rows.length);
    } catch (error) {
      // One table failing must not strand the rest of the reconciliation.
      console.warn(
        `[owner] reconcile ${table} failed:`,
        error instanceof Error ? error.message.slice(0, 200) : "unknown error",
      );
    }
  }

  // Keygen scope markers: the licence is the owner's, so the ids it was
  // verified for follow it. Written ONLY here, behind the binding.
  if (result.moved.licenses) {
    try {
      const rows = await sql<{ id: string; metadata: unknown }>`
        select id, metadata from licenses
        where user_id = ${userId} and metadata->>'source' = 'keygen'
      `;
      for (const row of rows) {
        const next = nextReboundFrom(row.metadata, orphans, userId);
        if (!next) continue;
        await sql`
          update licenses
          set metadata = coalesce(metadata, '{}'::jsonb)
              || jsonb_build_object('ownerReboundFrom', ${next}::text),
              updated_at = now()
          where id = ${row.id}
        `;
      }
    } catch (error) {
      console.warn(
        "[owner] reconcile keygen scope markers failed:",
        error instanceof Error ? error.message.slice(0, 200) : "unknown error",
      );
    }
  }

  return result;
}

/**
 * Move subscriptions without ever violating the one-live-row-per-customer
 * index and without creating or deleting history.
 */
async function moveSubscriptions(
  sql: Sql,
  userId: string,
  orphans: readonly string[],
): Promise<number> {
  let moved = 0;
  const lapsedRows = await sql.query<{ id: string }>(
    `update subscriptions
        set user_id = $2, updated_at = now()
      where user_id = any(string_to_array($1, E'\\n')) and status = 'EXPIRED'
      returning id`,
    [idParam(orphans), userId],
  );
  moved += lapsedRows.length;

  const liveRows = await sql.query<{ id: string }>(
    `select id from subscriptions
      where user_id = any(string_to_array($1, E'\\n')) and status in ('ACTIVE', 'SUSPENDED')`,
    [idParam(orphans)],
  );
  if (!liveRows.length) return moved;

  const held = await sql.query<{ id: string }>(
    `select id from subscriptions
      where user_id = $1 and status in ('ACTIVE', 'SUSPENDED') limit 1`,
    [userId],
  );
  if (held.length) {
    // The canonical account already holds a live entitlement: the orphan's row
    // is left exactly as it is. The owner keeps the access they have; nothing
    // is expired or deleted to make room.
    return moved;
  }
  const claimed = await sql.query<{ id: string }>(
    `update subscriptions
        set user_id = $2, updated_at = now()
      where id = any(string_to_array($1, E'\\n'))
      returning id`,
    [idParam(liveRows.map((row) => row.id)), userId],
  );
  return moved + claimed.length;
}

/** The stored reconciliation marker, or null. Never throws. */
export async function readReconciliationMarker(
  sql: Sql,
): Promise<ReconciliationResult | null> {
  try {
    const rows = await sql<{ value: unknown }>`
      select value from site_settings where key = ${OWNER_RECONCILIATION_KEY} limit 1
    `;
    const raw = rows[0]?.value;
    if (!raw || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    if (typeof record.userId !== "string" || !record.userId) return null;
    return {
      userId: record.userId,
      orphans: Array.isArray(record.orphans) ? record.orphans.map(String) : [],
      moved: (record.moved ?? {}) as ReconciliationResult["moved"],
      movedTotal: Number(record.movedTotal ?? 0),
      at: typeof record.at === "string" ? record.at : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Reconcile the owner's records for the account a binding names.
 *
 * Returns `null` when there is nothing to do — no binding, the binding names
 * another account, the identity store is not answering, or every record is
 * already on the canonical id. Best-effort by construction: a reconciliation
 * failure must never break the request that triggered it.
 */
export async function reconcileBoundOwner(
  sql: Sql,
  binding: OwnerBinding | null,
  directory: IdentityDirectory,
  options: {
    /** The account the caller proved they own; must match the binding. */
    userId: string;
    email?: string | null;
    /** Require OWNER (SUPER_ADMIN) authority in addition to the binding. */
    requireOwner?: boolean;
    audit?: (entry: {
      action: "owner.reconciled";
      detail: Record<string, string | number | boolean | null>;
    }) => Promise<void>;
  },
): Promise<ReconciliationResult | null> {
  // Kill switch: `NASAQ_OWNER_BINDING=off` turns the whole repair off — the
  // authority re-bind AND the ownership reconciliation that follows it.
  if (process.env.NASAQ_OWNER_BINDING?.trim().toLowerCase() === "off") return null;
  if (!binding) return null;
  const caller = options.userId?.trim();
  if (!caller || caller !== binding.userId) return null;
  if (
    options.requireOwner &&
    !isBoundOwner(binding, {
      id: caller,
      email: options.email ?? null,
      emailVerified: false,
    })
  ) {
    return null;
  }
  if (!directory.ready) return null;

  const orphans = await provenOwnerOrphanIds(sql, binding, directory);
  if (!orphans.length) return null;

  let relevant = false;
  for (const { table } of OWNED_TABLES) {
    if (await anyRowsFor(sql, table, orphans)) {
      relevant = true;
      break;
    }
  }
  if (!relevant) return null;

  const result = await rebindOwnerOwnership(sql, { userId: caller, orphanIds: orphans });
  if (!result.movedTotal) return null;

  try {
    await sql`
      insert into site_settings (key, value, updated_at)
      values (${OWNER_RECONCILIATION_KEY}, ${JSON.stringify(result)}::jsonb, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `;
  } catch {
    /* the marker is a record, not a guard — a failed write must not undo the move */
  }
  await options.audit?.({
    action: "owner.reconciled",
    detail: {
      orphans: result.orphans.join(","),
      moved: result.movedTotal,
      tables: Object.keys(result.moved).join(","),
    },
  });
  return result;
}

/**
 * Read the binding for this caller and reconcile — the entry point for paths
 * that already know the caller is the owner (the recovery flow, the licence
 * status call every editor open makes).
 */
export async function reconcileOwnerForSession(
  sql: Sql,
  identity: { id: string; email: string | null },
  directory: IdentityDirectory,
  options: {
    audit?: (entry: {
      action: "owner.reconciled";
      detail: Record<string, string | number | boolean | null>;
    }) => Promise<void>;
  } = {},
): Promise<ReconciliationResult | null> {
  try {
    const binding = await readOwnerBinding(sql);
    return await reconcileBoundOwner(sql, binding, directory, {
      userId: identity.id,
      email: identity.email,
      requireOwner: false,
      audit: options.audit,
    });
  } catch {
    return null;
  }
}
