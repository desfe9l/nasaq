/**
 * Administrator authority migration — moving the `admin_users` row itself.
 *
 * ## The split-brain this closes
 *
 * #156 gave the owner their console back by ADDING a durable binding and a
 * second `admin_users` row for the id they now sign in with. The orphaned
 * pre-migration row was left exactly where it was, so production ended up
 * with two administrator identities for one human:
 *
 *   · `admin_users(<orphan id>, SUPER_ADMIN)`   — unreachable, still authority
 *   · `admin_users(<current id>, …)`            — the account that signs in
 *
 * Every downstream verdict ("is the legacy identity still an admin?", "does
 * the owner hold the authority?") then has two defensible answers, which is
 * precisely the state an ownership migration is supposed to END. This module
 * performs the missing half: the orphan's ROLE is carried onto the canonical
 * account and the orphan rows are retired, in ONE statement, with the retired
 * rows preserved as a durable record.
 *
 * ## Why one statement and not a transaction block
 *
 * `Sql` is a pooled, statement-at-a-time surface (`src/lib/db.ts`): two
 * sequential queries can land on two different connections, so `begin`/`commit`
 * around them would guarantee nothing. A single statement with CTEs is
 * genuinely atomic in Postgres — the promotion and the retirement either both
 * happen or neither does — and it behaves identically on PGlite, which is what
 * the regression suite runs against.
 *
 * ## What it refuses to do
 *
 *   · it never touches an id that the caller has not PROVEN is an orphan of
 *     the canonical owner (`provenOwnerOrphanIds`, which requires the identity
 *     store to answer and the id to resolve to nothing);
 *   · it never DEMOTES the canonical account (a SUPER_ADMIN stays one even if
 *     the orphan row was a plain ADMIN);
 *   · it never deletes `admin_audit_log` history — the retired ids stay
 *     referenced there, which is why they are recorded rather than erased;
 *   · it grants nothing that was not already granted: an orphan id cannot
 *     sign in, so moving its role transfers authority that no living session
 *     could exercise.
 */
import type { Sql } from "../db.ts";
import { ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./super-admin.server.ts";

/** `site_settings` key holding the rows this migration retired. */
export const RETIRED_ADMIN_ROWS_KEY = "nasaq.owner_retired_admins.v1";

export type RetiredAdminRow = {
  /** The orphaned account id the row belonged to. Never rendered to a user. */
  userId: string;
  role: string;
  retiredAt: string;
};

export type AdminRebindResult = {
  /** Role the canonical account holds after the call. */
  role: string;
  /** True when the canonical account gained or kept SUPER_ADMIN here. */
  promoted: boolean;
  /** Orphan rows removed by this call. */
  retired: RetiredAdminRow[];
  /** True when the canonical account already held the row before the call. */
  existed: boolean;
};

const ID_SEPARATOR = "\n";

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

/**
 * Carry administrator authority from proven orphan rows onto the canonical
 * account and retire the orphans — atomically.
 *
 * `orphanIds` MUST already be proven orphans of this owner. The caller
 * (`reconcileBoundOwner`) resolves them from the durable binding against a
 * ready identity store; nothing here re-opens that decision, and nothing here
 * accepts an id from a request.
 */
export async function migrateAdminAuthority(
  sql: Sql,
  input: { userId: string; orphanIds: readonly string[]; at?: Date },
): Promise<AdminRebindResult> {
  const userId = String(input.userId ?? "").trim();
  const orphans = unique(input.orphanIds).filter((id) => id !== userId);
  const at = (input.at ?? new Date()).toISOString();
  if (!userId) {
    return { role: ADMIN_ROLE, promoted: false, retired: [], existed: false };
  }

  const before = await sql<{ role: string }>`
    select role from admin_users where user_id = ${userId} limit 1
  `;
  const heldRole = before[0]?.role ?? null;

  if (!orphans.length) {
    return {
      role: heldRole ?? ADMIN_ROLE,
      promoted: false,
      retired: [],
      existed: before.length > 0,
    };
  }

  /*
   * One statement, three effects:
   *   `orphan_rows` — the rows being retired (snapshot before the delete);
   *   `promotion`   — the canonical row, created or promoted, never demoted;
   *   `retired`     — the delete, returning what it removed.
   *
   * `retired` reads from the same snapshot the promotion used, so the role can
   * never be lost between "read the orphan" and "delete the orphan".
   */
  const rows = await sql.query<{
    kind: "promotion" | "retired";
    user_id: string;
    role: string;
  }>(
    `with orphan_rows as (
       select user_id, role
         from admin_users
        where user_id = any(string_to_array($1, E'\\n'))
     ),
     carried as (
       select case
                when exists (select 1 from orphan_rows where upper(role) = 'SUPER_ADMIN')
                then 'SUPER_ADMIN'
                else 'ADMIN'
              end as role
     ),
     promotion as (
       insert into admin_users (user_id, created_by, note, role)
       select $2, 'system:owner-migration', 'نقل سلطة المالك إلى الحساب الحالي', carried.role
         from carried
         where exists (select 1 from orphan_rows)
       on conflict (user_id) do update
          set role = case
                       when upper(admin_users.role) = 'SUPER_ADMIN' then admin_users.role
                       else excluded.role
                     end,
              updated_at = now()
       returning user_id, role
     ),
     retired as (
       delete from admin_users
        where user_id in (select user_id from orphan_rows)
          and exists (select 1 from promotion)
       returning user_id, role
     )
     select 'promotion' as kind, user_id, role from promotion
     union all
     select 'retired' as kind, user_id, role from retired`,
    [orphans.join(ID_SEPARATOR), userId],
  );

  const promotion = rows.find((row) => row.kind === "promotion");
  const retired: RetiredAdminRow[] = rows
    .filter((row) => row.kind === "retired")
    .map((row) => ({ userId: row.user_id, role: row.role, retiredAt: at }));

  if (retired.length) await recordRetiredRows(sql, retired);

  const role = promotion?.role ?? heldRole ?? ADMIN_ROLE;
  return {
    role,
    promoted: role.toUpperCase() === SUPER_ADMIN_ROLE && heldRole?.toUpperCase() !== SUPER_ADMIN_ROLE,
    retired,
    existed: before.length > 0,
  };
}

/**
 * Append to the durable record of retired authority.
 *
 * The orphan ids stay referenced by `admin_audit_log`, so the history of what
 * they did must remain interpretable after their `admin_users` row is gone.
 * Best-effort: the authority move already happened and must not be undone by a
 * failed bookkeeping write.
 */
async function recordRetiredRows(sql: Sql, retired: readonly RetiredAdminRow[]): Promise<void> {
  try {
    const existing = await readRetiredAdminRows(sql);
    const merged = [...existing];
    for (const row of retired) {
      if (!merged.some((entry) => entry.userId === row.userId)) merged.push(row);
    }
    await sql`
      insert into site_settings (key, value, updated_at)
      values (${RETIRED_ADMIN_ROWS_KEY}, ${JSON.stringify(merged)}::jsonb, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `;
  } catch {
    /* the record is evidence, not a guard */
  }
}

/** The retired-authority record, or an empty list. Never throws. */
export async function readRetiredAdminRows(sql: Sql): Promise<RetiredAdminRow[]> {
  try {
    const rows = await sql<{ value: unknown }>`
      select value from site_settings where key = ${RETIRED_ADMIN_ROWS_KEY} limit 1
    `;
    const raw = rows[0]?.value;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        const record = entry as Record<string, unknown>;
        const userId = typeof record?.userId === "string" ? record.userId.trim() : "";
        if (!userId) return null;
        return {
          userId,
          role: typeof record.role === "string" ? record.role : ADMIN_ROLE,
          retiredAt: typeof record.retiredAt === "string" ? record.retiredAt : new Date(0).toISOString(),
        } satisfies RetiredAdminRow;
      })
      .filter((entry): entry is RetiredAdminRow => entry !== null);
  } catch {
    return [];
  }
}

/**
 * Does any `admin_users` row still name one of these ids?
 *
 * The post-migration assertion "the legacy identity is NOT an administrator"
 * is answered here, from the table the resolvers actually read.
 */
export async function adminRowsFor(sql: Sql, ids: readonly string[]): Promise<number> {
  const list = unique(ids);
  if (!list.length) return 0;
  try {
    const rows = await sql.query<{ n: number }>(
      `select count(*)::int as n from admin_users
        where user_id = any(string_to_array($1, E'\\n'))`,
      [list.join(ID_SEPARATOR)],
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}
