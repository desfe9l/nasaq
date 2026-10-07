/**
 * The owner gate behind paid/template administration.
 *
 * WHY A DEDICATED MODULE
 *
 * «إدارة القوالب» is not ordinary settings: it is where the platform's paid
 * (licensed) catalogue is created, priced-tier-tagged and published. Whoever
 * reaches it can hand out — or quietly give away — the thing customers pay
 * for. It therefore needs a stronger, more explicit answer than "is this
 * account an admin", enforced on the server, on every call, including a direct
 * hit on `/admin-dashboard`.
 *
 * WHAT IT DECIDES, IN ORDER
 *
 *   1. **A real session.** The shared dev user (`VITE_AUTH_ENABLED=false`,
 *      no database) is NOT a session — it is what an unauthenticated visitor
 *      resolves to. Accepting it is exactly the "paid-template management
 *      without login" hole, so it is rejected here. The check is a property of
 *      the resolved id, not of a flag the browser sends.
 *   2. **Owner / super-administrator.** Deployment configuration
 *      (`NASAQ_OWNER_ID` / `NASAQ_OWNER_EMAIL` / `NASAQ_SUPER_ADMIN_*`) or a
 *      `SUPER_ADMIN` row — the platform owner is the authority for commercial
 *      content, not "someone who was promoted".
 *   3. **Administrator** — an `ADMIN` row, for the staff the owner promoted.
 *
 *   Self-heal: a configured owner always gets their `SUPER_ADMIN` row created
 *   on first use (`ensureOwnerSuperAdmin`), so tightening this gate can never
 *   lock the deployment's own owner out on a fresh database.
 *
 * Nothing here reads a browser-supplied role. The browser asks; this decides.
 */

import type { Sql } from "@/lib/db";
import type { VerifiedIdentity } from "@/lib/auth/admin-identity.server";
import { DEV_USER_ID } from "@/lib/auth/verify.server";

/** The identity a server function's `authMiddleware` hands us. */
export interface CallerIdentity {
  userId: string;
  userEmail: string | null;
  userEmailVerified: boolean;
}

export type OwnerGateResult =
  | { ok: true; identity: VerifiedIdentity }
  | { ok: false; reason: "no_session" | "not_owner"; error: string };

/** True when the resolved id is the shared auth-disabled dev user. */
export function isAnonymousDevUser(userId: string | null | undefined): boolean {
  return !userId || userId === DEV_USER_ID;
}

/**
 * Authorize one caller for paid/template administration.
 *
 * Call this at the top of every server function that reads or writes the
 * template catalogue. It never throws, so each caller can answer with its own
 * error shape — but it must be called, and a `false` result must be honoured.
 */
export async function verifyTemplateManager(
  context: CallerIdentity,
  sqlPromise: Promise<Sql>,
): Promise<OwnerGateResult> {
  // 1. A real, authenticated session — the shared dev user is "not signed in".
  if (isAnonymousDevUser(context.userId)) {
    return {
      ok: false,
      reason: "no_session",
      error: "يجب تسجيل الدخول بحساب المالك للوصول إلى إدارة القوالب.",
    };
  }
  const identity: VerifiedIdentity = {
    id: context.userId,
    email: context.userEmail,
    emailVerified: context.userEmailVerified,
  };
  const sql = await sqlPromise;
  const [{ isSuperAdminIdentity, ensureOwnerSuperAdmin }, { isAdminIdentity }] =
    await Promise.all([
      import("@/lib/auth/super-admin.server"),
      import("@/lib/auth/admin-identity.server"),
    ]);
  // 2. Owner self-heal first: a configured owner must never be turned away by
  // an empty `admin_users` table on a fresh deployment.
  const { isOwnerIdentity } = await import("@/lib/auth/owner.server");
  if (isOwnerIdentity(identity)) await ensureOwnerSuperAdmin(sql, identity);
  const allowed =
    (await isSuperAdminIdentity(sql, identity)) ||
    (await isAdminIdentity(sql, identity));
  if (!allowed) {
    return {
      ok: false,
      reason: "not_owner",
      error: "غير مصرح — إدارة القوالب متاحة لحساب المالك فقط.",
    };
  }
  return { ok: true, identity };
}
