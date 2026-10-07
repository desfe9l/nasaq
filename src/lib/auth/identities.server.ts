/**
 * Identity lookup for the parts of the app that are NOT the sign-in flow —
 * admin listings, licence assignment, purchase→account binding.
 *
 * They used to join the `"user"` table, which was Better Auth's schema. Identity
 * now lives in the AuthStore (durable object storage by default, Postgres when
 * configured), so this module is the ONE door those callers go through. Keeping
 * them on a single lookup means an account created with a password, via Google,
 * or from the platform gate is visible to licensing and admin exactly once.
 *
 * Server-only (`.server.ts`): it reaches the identity store. Import it
 * DYNAMICALLY from server functions (`await import(...)`), exactly like
 * `@/lib/db`, so it never lands in the client bundle.
 *
 * None of these throw when identity storage is missing or unreachable: an admin
 * page must render, a licence form must answer. They return "no such account"
 * and log once, because the alternative — a 500 on the customers list — hides
 * the real problem behind a worse one.
 */
import { getAuthStore } from "./store/index.server";
import type { StoredUser } from "./store/types";

export type AuthIdentity = {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
};

function toIdentity(user: StoredUser): AuthIdentity {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified === true,
    image: user.image,
    createdAt: user.createdAt,
  };
}

let warned = false;
function warnOnce(error: unknown): void {
  if (warned) return;
  warned = true;
  console.error("[auth] identity lookup unavailable:", error);
}

async function store() {
  try {
    return await getAuthStore();
  } catch (error) {
    warnOnce(error);
    return null;
  }
}

/** Account by id, or null. */
export async function findAuthUserById(id: string): Promise<AuthIdentity | null> {
  const trimmed = String(id ?? "").trim();
  if (!trimmed) return null;
  const active = await store();
  if (!active) return null;
  try {
    const user = await active.findUserById(trimmed);
    return user ? toIdentity(user) : null;
  } catch (error) {
    warnOnce(error);
    return null;
  }
}

/** Account by email address (case-insensitive), or null. */
export async function findAuthUserByEmail(email: string): Promise<AuthIdentity | null> {
  const trimmed = String(email ?? "").trim();
  if (!trimmed) return null;
  const active = await store();
  if (!active) return null;
  try {
    const user = await active.findUserByEmail(trimmed);
    return user ? toIdentity(user) : null;
  } catch (error) {
    warnOnce(error);
    return null;
  }
}

/**
 * Resolve an email OR an account id to an account — the shape licence tooling
 * asks for ("assign this licence to…"). Ids win when both could match.
 */
export async function findAuthUserByEmailOrId(value: string): Promise<AuthIdentity | null> {
  const needle = String(value ?? "").trim();
  if (!needle) return null;
  const byId = await findAuthUserById(needle);
  if (byId) return byId;
  return findAuthUserByEmail(needle.toLowerCase());
}

/** Newest accounts first, for the admin customer list. */
export async function listAuthUsers(limit = 200): Promise<AuthIdentity[]> {
  const active = await store();
  if (!active) return [];
  try {
    const users = await active.listUsers(Math.max(1, Math.trunc(limit)));
    return users.map(toIdentity);
  } catch (error) {
    warnOnce(error);
    return [];
  }
}

/**
 * Addresses for a set of account ids, from the identity store.
 *
 * Admin listings (licences, payment requests) still LEFT JOIN `"user"` for the
 * customer's address, and that projection is best-effort since first-party
 * auth — so an account created after the migration showed up with no address
 * and could not be identified or searched. Callers fill only the gaps with
 * this. Bounded, never throws.
 */
export async function emailsForUserIds(ids: Iterable<string>, max = 200): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].map((id) => String(id ?? "").trim()).filter(Boolean))].slice(0, max);
  const found = new Map<string, string>();
  if (!unique.length) return found;
  const active = await store();
  if (!active) return found;
  await Promise.all(
    unique.map(async (id) => {
      try {
        const user = await active.findUserById(id);
        if (user?.email) found.set(id, user.email);
      } catch (error) {
        warnOnce(error);
      }
    }),
  );
  return found;
}

/** Fill `email`-like gaps on rows keyed by user id. Returns new row objects. */
export async function withStoreEmails<T extends Record<string, unknown>>(
  rows: T[],
  idKey: keyof T,
  emailKey: keyof T,
): Promise<T[]> {
  const missing = rows
    .filter((row) => !row[emailKey] && typeof row[idKey] === "string" && row[idKey])
    .map((row) => String(row[idKey]));
  if (!missing.length) return rows;
  const emails = await emailsForUserIds(missing);
  if (!emails.size) return rows;
  return rows.map((row) => {
    if (row[emailKey]) return row;
    const email = emails.get(String(row[idKey] ?? ""));
    return email ? { ...row, [emailKey]: email } : row;
  });
}
