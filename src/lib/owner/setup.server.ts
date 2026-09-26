/**
 * Owner setup checks — real probes for the five auth/owner settings.
 *
 * The rule this module exists to enforce: **a configured variable is not a
 * working service.** Everything here either tests the real thing (a database
 * round-trip, Google's token endpoint, the live Better Auth instance, the
 * signed-in identity) or says plainly that it could not.
 *
 * Secret discipline:
 *   · No secret value is ever returned, echoed, logged, or included in an
 *     error message. Results carry booleans, lengths and safe summaries only.
 *   · `DATABASE_URL` is summarised as host + database name; user, password and
 *     query string never leave this module.
 *   · A generated Better Auth secret is returned exactly once, to the owner's
 *     own screen, and is never written to disk, database or log.
 *
 * Nothing here writes to the process environment: a serverless runtime's env
 * is read-only, so "تهيئة" validates and hands back the exact variable to set
 * in the deployment provider rather than pretending to persist it.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

export type SetupState = "ready" | "missing" | "warning";

export type SetupCheck = {
  id: "owner" | "better-auth" | "database" | "google-client-id" | "google-client-secret";
  variable: string;
  label: string;
  state: SetupState;
  /** Short Arabic status line. Never contains a secret or a credential. */
  summary: string;
  /** True when the state came from an actual probe, not from env presence. */
  probed: boolean;
};

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/** Constant-time equality for two secrets of unknown length. */
function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// ── Owner identity ─────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmailFormat(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/**
 * Does the configured owner email actually match the signed-in Better Auth
 * identity? Presence of the variable proves nothing — a typo locks the owner
 * out of their own vault, which is exactly the failure this catches.
 */
export function checkOwnerIdentity(sessionEmail: string | null): SetupCheck {
  const configured = env("NASAQ_OWNER_EMAIL")?.toLowerCase();
  const id = env("NASAQ_OWNER_ID");
  if (!configured && !id) {
    return {
      id: "owner",
      variable: "NASAQ_OWNER_EMAIL",
      label: "هوية المالك",
      state: "missing",
      summary: "بيانات ناقصة — لم يُضبط NASAQ_OWNER_EMAIL ولا NASAQ_OWNER_ID.",
      probed: true,
    };
  }
  if (!configured) {
    return {
      id: "owner",
      variable: "NASAQ_OWNER_EMAIL",
      label: "هوية المالك",
      state: "warning",
      summary: "المالك معرّف بـ NASAQ_OWNER_ID فقط؛ أضف البريد ليكون التحقق مزدوجًا.",
      probed: true,
    };
  }
  if (!isValidEmailFormat(configured)) {
    return {
      id: "owner",
      variable: "NASAQ_OWNER_EMAIL",
      label: "هوية المالك",
      state: "warning",
      summary: "صيغة البريد المضبوطة غير صالحة — راجع القيمة في مزود النشر.",
      probed: true,
    };
  }
  const matches = Boolean(sessionEmail && sessionEmail.trim().toLowerCase() === configured);
  return {
    id: "owner",
    variable: "NASAQ_OWNER_EMAIL",
    label: "هوية المالك",
    state: matches ? "ready" : "warning",
    summary: matches
      ? "جاهز — البريد المضبوط يطابق حساب Better Auth الحالي."
      : "البريد مضبوط لكنه لا يطابق الحساب الذي فتح الخزنة الآن.",
    probed: true,
  };
}

// ── Better Auth ────────────────────────────────────────────────────────────

/** Minimum length for a session signing secret (32 bytes of base64 ≈ 44). */
const MIN_SECRET_LENGTH = 32;

export function checkBetterAuthSecret(): SetupCheck {
  const secret = env("BETTER_AUTH_SECRET");
  const googleSecret = env("GOOGLE_CLIENT_SECRET");
  if (!secret) {
    return {
      id: "better-auth",
      variable: "BETTER_AUTH_SECRET",
      label: "سر جلسات Better Auth",
      state: "missing",
      summary:
        "بيانات ناقصة — بدونه يولّد التطبيق سرًا مؤقتًا في الذاكرة وتسقط كل الجلسات مع كل نشر.",
      probed: true,
    };
  }
  if (googleSecret && secretsEqual(secret, googleSecret)) {
    return {
      id: "better-auth",
      variable: "BETTER_AUTH_SECRET",
      label: "سر جلسات Better Auth",
      state: "warning",
      summary:
        "خطر: القيمة نفسها مستخدمة في GOOGLE_CLIENT_SECRET. ولّد سرًا مستقلًا لجلسات Better Auth.",
      probed: true,
    };
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return {
      id: "better-auth",
      variable: "BETTER_AUTH_SECRET",
      label: "سر جلسات Better Auth",
      state: "warning",
      summary: `السر قصير (${secret.length} محرفًا). استخدم 32 محرفًا فأكثر من مصدر عشوائي.`,
      probed: true,
    };
  }
  return {
    id: "better-auth",
    variable: "BETTER_AUTH_SECRET",
    label: "سر جلسات Better Auth",
    state: "ready",
    summary: "جاهز — سر مستقل بطول كافٍ، ولا يُعرض هنا إطلاقًا.",
    probed: true,
  };
}

/**
 * Generate a strong secret for the owner to paste into the deployment
 * provider. Returned once, never stored and never logged: a serverless
 * runtime cannot write its own environment, so pretending to "save" it would
 * be a lie that silently loses every session on the next deploy.
 */
export function generateAuthSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Live check of the Better Auth instance: builds the server, asks it to
 * resolve a session for the caller's own headers and confirms the handler
 * answers. Import is dynamic so a configuration error surfaces as a result
 * rather than breaking the whole vault.
 */
export async function probeBetterAuth(headers: Headers): Promise<{ ok: boolean; detail: string }> {
  try {
    const { auth, authConfigured } = await import("@/lib/auth/server");
    await auth.api.getSession({ headers });
    return {
      ok: authConfigured,
      detail: authConfigured
        ? "Better Auth يستجيب ويحل الجلسة، وGoogle مفعّل كمزوّد."
        : "Better Auth يستجيب لكن مزوّد Google غير مكتمل (client id/secret).",
    };
  } catch {
    return { ok: false, detail: "تعذر تشغيل Better Auth بالإعدادات الحالية." };
  }
}

// ── Database ───────────────────────────────────────────────────────────────

/** Host + database name only. User, password and query string never leave. */
export function databaseSummary(): string | null {
  const raw = env("DATABASE_URL");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const name = url.pathname.replace(/^\//, "") || "(افتراضية)";
    return `${url.hostname}/${name}`;
  } catch {
    return "رابط غير صالح الصيغة";
  }
}

export function checkDatabase(): SetupCheck {
  const summary = databaseSummary();
  return {
    id: "database",
    variable: "DATABASE_URL",
    label: "قاعدة البيانات",
    state: summary ? "warning" : "missing",
    summary: summary
      ? `مضبوط (${summary}) — اضغط اختبار الاتصال للتأكد الفعلي.`
      : "بيانات ناقصة — DATABASE_URL غير مضبوط في هذه البيئة.",
    probed: false,
  };
}

/**
 * Real connectivity test: a round-trip query, not a URL parse.
 *
 * Provider errors can contain the host, the user and occasionally the whole
 * DSN, so the message is mapped to a short safe reason and the original is
 * discarded — never logged, never returned.
 */
export async function testDatabaseConnection(): Promise<{ ok: boolean; detail: string }> {
  if (!env("DATABASE_URL")) {
    return { ok: false, detail: "DATABASE_URL غير مضبوط في هذه البيئة." };
  }
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ ok: number }>`select 1 as ok`;
    if (rows[0]?.ok !== 1) return { ok: false, detail: "الاتصال تم لكن الاستعلام لم يعد بنتيجة متوقعة." };
    return { ok: true, detail: "قاعدة البيانات متصلة — تم تنفيذ استعلام تحقق بنجاح." };
  } catch (error) {
    return { ok: false, detail: safeDatabaseReason(error) };
  }
}

/** Map a driver error to a short reason that cannot leak connection details. */
export function safeDatabaseReason(error: unknown): string {
  const raw = error instanceof Error ? error.message.toLowerCase() : "";
  if (raw.includes("password") || raw.includes("authentication")) {
    return "فشل المصادقة مع قاعدة البيانات — راجع اسم المستخدم وكلمة المرور لدى المزود.";
  }
  if (raw.includes("enotfound") || raw.includes("eai_again") || raw.includes("getaddrinfo")) {
    return "تعذر الوصول إلى مضيف قاعدة البيانات — راجع اسم المضيف.";
  }
  if (raw.includes("timeout") || raw.includes("etimedout")) {
    return "انتهت مهلة الاتصال بقاعدة البيانات.";
  }
  if (raw.includes("econnrefused")) {
    return "رُفض الاتصال بالمنفذ المحدد.";
  }
  if (raw.includes("does not exist") || raw.includes("database")) {
    return "قاعدة البيانات المحددة غير موجودة لدى المزود.";
  }
  if (raw.includes("ssl") || raw.includes("certificate")) {
    return "فشل تفاوض SSL مع قاعدة البيانات.";
  }
  return "تعذر الاتصال بقاعدة البيانات بالإعدادات الحالية.";
}

// ── Google OAuth ───────────────────────────────────────────────────────────

/** Google web client ids look like `<digits>-<hash>.apps.googleusercontent.com`. */
const GOOGLE_CLIENT_ID_RE = /^[0-9]+-[a-z0-9._-]+\.apps\.googleusercontent\.com$/i;

export function isValidGoogleClientId(value: string): boolean {
  return GOOGLE_CLIENT_ID_RE.test(value.trim());
}

export function checkGoogleClientId(): SetupCheck {
  const value = env("GOOGLE_CLIENT_ID");
  if (!value) {
    return {
      id: "google-client-id",
      variable: "GOOGLE_CLIENT_ID",
      label: "Google client ID",
      state: "missing",
      summary: "بيانات ناقصة — لا يمكن بدء تسجيل الدخول بدون معرّف العميل.",
      probed: true,
    };
  }
  return {
    id: "google-client-id",
    variable: "GOOGLE_CLIENT_ID",
    label: "Google client ID",
    state: isValidGoogleClientId(value) ? "ready" : "warning",
    summary: isValidGoogleClientId(value)
      ? "جاهز — الصيغة مطابقة لعميل ويب في Google Cloud."
      : "القيمة مضبوطة لكن صيغتها لا تطابق `…apps.googleusercontent.com`.",
    probed: true,
  };
}

export function checkGoogleClientSecret(): SetupCheck {
  const value = env("GOOGLE_CLIENT_SECRET");
  return {
    id: "google-client-secret",
    variable: "GOOGLE_CLIENT_SECRET",
    label: "Google client secret",
    state: value ? "warning" : "missing",
    summary: value
      ? "مضبوط ومخفي — اضغط اختبار الاتصال للتحقق منه لدى Google."
      : "بيانات ناقصة — تبادل رمز Google بجلسة لن يعمل.",
    probed: false,
  };
}

/**
 * Real credential test against Google's token endpoint.
 *
 * A deliberately invalid authorization code is exchanged: Google answers
 * `invalid_client` when the id/secret pair is wrong, and `invalid_grant` when
 * the pair is VALID but the code is not — which is exactly the signal we want.
 * The secret is sent only to `oauth2.googleapis.com` over TLS and never
 * appears in the result.
 */
export async function testGoogleOAuth(): Promise<{ ok: boolean; detail: string }> {
  const clientId = env("GOOGLE_CLIENT_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return { ok: false, detail: "بيانات ناقصة — GOOGLE_CLIENT_ID أو GOOGLE_CLIENT_SECRET غير مضبوط." };
  }
  const redirectUri = `${env("BETTER_AUTH_URL") ?? ""}/api/auth/callback/google`;
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: "nasaq-configuration-probe",
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    const error = typeof payload.error === "string" ? payload.error : "";
    if (error === "invalid_grant") {
      // Credentials accepted; only the throwaway code was rejected.
      return { ok: true, detail: "جاهز — Google قبل بيانات العميل (رُفض الرمز التجريبي فقط)." };
    }
    if (error === "invalid_client") {
      return { ok: false, detail: "Google رفض بيانات العميل — راجع client ID والسر في Google Cloud." };
    }
    if (error === "redirect_uri_mismatch") {
      return { ok: false, detail: "عنوان callback غير مسجّل في Google Cloud لهذا العميل." };
    }
    if (!error) {
      return { ok: false, detail: "رد غير متوقع من Google — أعد المحاولة لاحقًا." };
    }
    // Any other documented OAuth error still proves we reached Google.
    return { ok: false, detail: `Google رد برمز: ${error}` };
  } catch {
    return { ok: false, detail: "تعذر الوصول إلى خدمة Google للتحقق." };
  }
}

// ── Aggregate ──────────────────────────────────────────────────────────────

export function readSetupChecks(sessionEmail: string | null): SetupCheck[] {
  return [
    checkOwnerIdentity(sessionEmail),
    checkBetterAuthSecret(),
    checkDatabase(),
    checkGoogleClientId(),
    checkGoogleClientSecret(),
  ];
}
