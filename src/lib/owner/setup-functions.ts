/**
 * Owner setup actions — the server side of the «تهيئة» buttons.
 *
 * Every handler is admin-gated with the same check the vault itself uses, and
 * every response is free of secrets by construction: the probes return
 * booleans and short Arabic reasons, never a credential, a DSN or a provider
 * error string.
 *
 * On writing values: a deployed runtime cannot mutate its own environment, so
 * these functions VALIDATE and TEST, then hand back the exact variable name
 * (and, for a generated secret, a value shown once) for the owner to set in
 * the deployment provider. Nothing is persisted here — no hidden secret store,
 * no database copy of a credential.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { authMiddleware } from "@/lib/auth/middleware";

export type SetupProbeResult = {
  ok: boolean;
  detail: string;
};

export type OwnerSetupOverview = {
  sessionEmail: string | null;
  checks: import("./setup.server").SetupCheck[];
};

async function requireAdmin(context: { userId: string; userEmail: string | null }) {
  const { getAuthorizationContext } = await import("@/lib/auth/authorization.server");
  const authorization = await getAuthorizationContext({
    id: context.userId,
    email: context.userEmail,
  });
  if (!authorization.isAdmin) throw new Error("Forbidden");
  return authorization;
}

/** Current state of the five auth/owner settings. */
export const getOwnerSetupFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<OwnerSetupOverview> => {
    await requireAdmin(context);
    const { readSetupChecks } = await import("./setup.server");
    return {
      sessionEmail: context.userEmail,
      checks: readSetupChecks(context.userEmail),
    };
  });

/**
 * Validate an owner email and confirm it belongs to a real, verified Better
 * Auth account — the check that turns "the variable is set" into "the owner
 * can actually sign in as the owner".
 */
export const verifyOwnerEmailFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { email: string } => {
    const raw = (input as { email?: unknown } | null)?.email;
    const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!email || email.length > 254) throw new Error("أدخل بريدًا صالحًا");
    return { email };
  })
  .handler(async ({ context, data }): Promise<SetupProbeResult & { variable: string }> => {
    await requireAdmin(context);
    const { isValidEmailFormat } = await import("./setup.server");
    if (!isValidEmailFormat(data.email)) {
      return { ok: false, detail: "صيغة البريد غير صالحة.", variable: "NASAQ_OWNER_EMAIL" };
    }

    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ id: string; verified: boolean }>`
      select id, "emailVerified" as verified from "user" where lower(email) = ${data.email} limit 1
    `;
    const account = rows[0];
    if (!account) {
      return {
        ok: false,
        detail: "لا يوجد حساب Better Auth بهذا البريد بعد. سجّل الدخول به مرة واحدة ثم أعد المحاولة.",
        variable: "NASAQ_OWNER_EMAIL",
      };
    }
    if (!account.verified) {
      return {
        ok: false,
        detail: "الحساب موجود لكن بريده غير موثّق لدى مزوّد الدخول.",
        variable: "NASAQ_OWNER_EMAIL",
      };
    }
    const configured = process.env.NASAQ_OWNER_EMAIL?.trim().toLowerCase();
    if (configured === data.email) {
      return {
        ok: true,
        detail: "جاهز — البريد مضبوط في البيئة ويطابق حسابًا موثّقًا.",
        variable: "NASAQ_OWNER_EMAIL",
      };
    }
    return {
      ok: true,
      detail:
        "البريد صالح ويطابق حسابًا موثّقًا. اضبط NASAQ_OWNER_EMAIL بهذه القيمة في مزوّد النشر ثم أعد النشر.",
      variable: "NASAQ_OWNER_EMAIL",
    };
  });

/** Validate a Google client ID's format without sending it anywhere. */
export const verifyGoogleClientIdFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { clientId: string } => {
    const raw = (input as { clientId?: unknown } | null)?.clientId;
    const clientId = typeof raw === "string" ? raw.trim() : "";
    if (!clientId || clientId.length > 300) throw new Error("أدخل client ID صالحًا");
    return { clientId };
  })
  .handler(async ({ context, data }): Promise<SetupProbeResult & { variable: string }> => {
    await requireAdmin(context);
    const { isValidGoogleClientId } = await import("./setup.server");
    if (!isValidGoogleClientId(data.clientId)) {
      return {
        ok: false,
        detail: "الصيغة غير مطابقة لعميل ويب Google (…apps.googleusercontent.com).",
        variable: "GOOGLE_CLIENT_ID",
      };
    }
    const configured = process.env.GOOGLE_CLIENT_ID?.trim();
    return {
      ok: true,
      detail:
        configured === data.clientId
          ? "جاهز — القيمة مضبوطة في البيئة ومطابقة لما أدخلته."
          : "الصيغة صالحة. اضبط GOOGLE_CLIENT_ID بهذه القيمة في مزوّد النشر ثم أعد النشر.",
      variable: "GOOGLE_CLIENT_ID",
    };
  });

/**
 * Mint a strong session secret for the owner to paste into the deployment
 * provider. Shown once, stored nowhere, logged nowhere.
 */
export const generateAuthSecretFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ variable: string; secret: string; detail: string }> => {
    await requireAdmin(context);
    const { generateAuthSecret } = await import("./setup.server");
    return {
      variable: "BETTER_AUTH_SECRET",
      secret: generateAuthSecret(),
      detail:
        "انسخه الآن إلى مزوّد النشر ثم أعد النشر — لن يُعرض مرة أخرى ولم يُحفظ في أي مكان. ستنتهي الجلسات الحالية بعد تغييره.",
    };
  });

/** Live Better Auth probe (instance + Google provider wiring + secret hygiene). */
export const testBetterAuthFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<SetupProbeResult> => {
    await requireAdmin(context);
    const { checkBetterAuthSecret, probeBetterAuth } = await import("./setup.server");
    const secret = checkBetterAuthSecret();
    if (secret.state !== "ready") return { ok: false, detail: secret.summary };
    const request = getRequest();
    const probe = await probeBetterAuth(request?.headers ?? new Headers());
    return probe;
  });

/** Real database round-trip. Failure reasons are sanitised. */
export const testDatabaseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<SetupProbeResult & { summary: string | null }> => {
    await requireAdmin(context);
    const { databaseSummary, testDatabaseConnection } = await import("./setup.server");
    const result = await testDatabaseConnection();
    return { ...result, summary: databaseSummary() };
  });

/** Real Google credential test against the token endpoint. */
export const testGoogleOAuthFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<SetupProbeResult> => {
    await requireAdmin(context);
    const { testGoogleOAuth } = await import("./setup.server");
    return testGoogleOAuth();
  });

/**
 * «تحقق وإصلاح Team» — runs the real Keygen verification (and, with
 * `repair: true`, the idempotent wiring repair) from the server, where the
 * token lives. The response carries states, codes and policy IDs only; the
 * token never leaves the server and is never logged.
 */
export const verifyTeamLicensingFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { repair: boolean } => ({
    repair: (input as { repair?: unknown } | null)?.repair === true,
  }))
  .handler(async ({ context, data }): Promise<import("@/lib/license/team-setup.server").TeamSetupReport> => {
    await requireAdmin(context);
    const { verifyAndRepairTeam } = await import("@/lib/license/team-setup.server");
    return verifyAndRepairTeam(data.repair);
  });
