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
  // The connection is opened eagerly by the caller but may never be awaited
  // below (a configured identity needs no database). Mark it handled so an
  // unreachable database cannot surface as an unhandled rejection.
  sqlPromise.catch(() => undefined);
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
  const [
    { isSuperAdminIdentity, ensureOwnerSuperAdmin, isConfiguredSuperAdminIdentity },
    { isAdminIdentity, isConfiguredAdminIdentity },
  ] = await Promise.all([
    import("@/lib/auth/super-admin.server"),
    import("@/lib/auth/admin-identity.server"),
  ]);
  const { isOwnerIdentity } = await import("@/lib/auth/owner.server");
  /*
   * 2. Deployment configuration answers WITHOUT the database. The owner's
   * SUPER_ADMIN row is still self-healed, but best-effort: a database that is
   * unreachable (or a row write that fails) must not turn the configured owner
   * away from the console — each template call reports its own storage error.
   */
  if (isConfiguredSuperAdminIdentity(identity) || isConfiguredAdminIdentity(identity)) {
    if (isOwnerIdentity(identity)) {
      try {
        await ensureOwnerSuperAdmin(await sqlPromise, identity);
      } catch (error) {
        console.warn(
          "[admin] owner SUPER_ADMIN self-heal skipped:",
          error instanceof Error ? error.message.slice(0, 200) : "unknown error",
        );
      }
    }
    return { ok: true, identity };
  }
  // 3. Database-backed roles (SUPER_ADMIN / ADMIN rows).
  let sql: Sql;
  try {
    sql = await sqlPromise;
  } catch {
    return {
      ok: false,
      reason: "not_owner",
      error: "تعذّر التحقق من الصلاحية — قاعدة البيانات غير متاحة الآن. أعد المحاولة بعد قليل.",
    };
  }
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
