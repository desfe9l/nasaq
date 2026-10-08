/**
 * Best-effort mirror of an account into the legacy `"user"` table.
 *
 * The authoritative identity store is the AuthStore (durable object storage by
 * default). Several parts of the app — the admin customer list, payment request
 * joins, Gumroad purchase→account binding, licence assignment — still read the
 * `"user"` table directly, and rewriting every join would be a large, risky
 * change to code paths that are not about sign-in at all.
 *
 * So an account is ALSO projected into `"user"` whenever a database is
 * configured. Three properties make this safe:
 *
 *   · it is best-effort — a failure (database suspended, over quota, schema not
 *     migrated) is logged ONCE and never blocks sign-up, sign-in or any session
 *     operation. Authentication does not depend on the database;
 *   · it only ever writes the columns the legacy table owns, keyed by the same
 *     account id, so it can neither create nor resolve a session;
 *   · it is skipped entirely when `NASAQ_PRIMARY_DATABASE_URL` is absent, which is the default
 *     deployment shape here.
 *
 * When the database is unavailable the projection lags; accounts still exist and
 * still sign in, and the mirror catches up on the next sign-in.
 */
import type { StoredUser } from "./store/types";

let warned = false;

function warnOnce(error: unknown): void {
  if (warned) return;
  warned = true;
  console.warn(
    "[auth] account mirror into the application database is unavailable " +
      "(admin/licence joins will not see new accounts until it recovers):",
    error,
  );
}

/** Project (insert or update) one account into `"user"`. Never throws. */
export async function mirrorUserToDatabase(user: StoredUser): Promise<void> {
  if (!process.env.NASAQ_PRIMARY_DATABASE_URL?.trim()) return;
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const now = new Date().toISOString();
    await sql`
      insert into "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt")
      values (
        ${user.id},
        ${user.name ?? ""},
        ${user.email},
        ${user.emailVerified === true},
        ${user.image ?? null},
        ${user.createdAt || now},
        ${now}
      )
      on conflict (id) do update set
        name = excluded.name,
        email = excluded.email,
        "emailVerified" = excluded."emailVerified",
        image = excluded.image,
        "updatedAt" = excluded."updatedAt"
    `;
  } catch (error) {
    warnOnce(error);
  }
}
