/**
 * Owner setup checks — real probes for the five auth/owner settings.
 *
 * The rule this module exists to enforce: **a configured variable is not a
 * working service.** Everything here either tests the real thing (a database
 * round-trip, Google's token endpoint, the ACTIVE identity store, the
 * signed-in identity) or says plainly that it could not.
 *
 * Secret discipline:
 *   · No secret value is ever returned, echoed, logged, or included in an
 *     error message. Results carry booleans, lengths and safe summaries only.
 *   · `DATABASE_URL` is summarised as host + database name; user, password and
 *     query string never leave this module.
 *   · Backend variable NAMES are reported when identity storage is missing;
 *     values are never read back into a check result.
 *
 * Nothing here writes to the process environment: a serverless runtime's env
 * is read-only, so "تهيئة" validates and hands back the exact variable to set
 * in the deployment provider rather than pretending to persist it.
 */
import { authStoreStatus } from "@/lib/auth/store/status";

export type SetupState = "ready" | "missing" | "warning";

export type SetupCheck = {
  id: "owner" | "auth-store" | "database" | "google-client-id" | "google-client-secret";
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

// ── Owner identity ─────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmailFormat(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/**
 * Does the configured owner email actually match the signed-in identity? Presence of the variable proves nothing — a typo locks the owner
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
      ? "جاهز — البريد المضبوط يطابق الحساب المسجّل الدخول الآن."
      : "البريد مضبوط لكنه لا يطابق الحساب الذي فتح الخزنة الآن.",
    probed: true,
  };
}

// ── Identity storage ───────────────────────────────────────────────────────

/**
 * Where accounts and sessions actually live.
 *
 * This row used to be "Better Auth secret": a signing key that, when missing,
 * signed everyone out on the next request. Sessions are now opaque tokens whose
 * hash is stored in a durable backend, so the thing that can silently break
 * sign-in is the BACKEND — an object store or a Postgres URL — and that is what
 * this check reports. A deployment with neither fails closed with a 503 naming
 * the variables to set, never by keeping accounts in process memory.
 */
export function checkAuthStorage(): SetupCheck {
  const status = authStoreStatus();
  const variable =
    status.kind === "postgres"
      ? "DATABASE_URL"
      : status.configured
        ? "R2_ACCESS_KEY_ID"
        : (status.missing[0] ?? "DATABASE_URL");
  if (status.configured && status.kind === "filesystem") {
    return {
      id: "auth-store",
      variable,
      label: "تخزين الهوية",
      state: "warning",
      summary:
        "مخزن تطوير محلي (.nasaq-auth). على بيئة نشر يجب ضبط R2 أو DATABASE_URL وإلا يُرفض تسجيل الدخول.",
      probed: true,
    };
  }
  if (!status.configured) {
    return {
      id: "auth-store",
      variable,
      label: "تخزين الهوية",
      state: "missing",
      summary: `بيانات ناقصة — ${status.missing.join("، ") || "DATABASE_URL"} غير مضبوط، وتسجيل الدخول سيفشل بـ503.`,
      probed: true,
    };
  }
  return {
    id: "auth-store",
    variable,
    label: "تخزين الهوية",
    state: "ready",
    summary:
      status.kind === "cloudflare-r2"
        ? "جاهز — الحسابات والجلسات في تخزين الكائنات (R2)، مستقل عن قاعدة البيانات."
        : "جاهز — الحسابات والجلسات في قاعدة البيانات (DATABASE_URL).",
    probed: true,
  };
}

/**
 * Live check of the auth service: the ACTIVE store must be configured, and a
 * session resolution for the caller's own headers must answer. Imports are
 * dynamic so a configuration error surfaces as a result rather than breaking
 * the whole admin vault.
 */
export async function probeAuthService(headers: Headers): Promise<{ ok: boolean; detail: string }> {
  const storage = checkAuthStorage();
  if (storage.state === "missing") return { ok: false, detail: storage.summary };
  try {
    const [{ resolveRequestSession }, { authConfiguration }] = await Promise.all([
      import("@/lib/auth/request-session.server"),
      import("@/lib/auth/server"),
    ]);
    await resolveRequestSession(headers, { emitCookies: false });
    return {
      ok: authConfiguration.ok,
      detail: authConfiguration.ok
        ? `المصادقة تعمل — تخزين الهوية: ${authConfiguration.storage.kind ?? "غير مهيأ"}.`
        : "إعدادات المصادقة غير مكتملة على هذه النسخة.",
    };
  } catch {
    return { ok: false, detail: "تعذّر تشغيل خدمة المصادقة بالإعدادات الحالية." };
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
  const errCode = (error as { code?: string })?.code;
  const raw = error instanceof Error ? error.message.toLowerCase() : "";

  if (errCode === "53000" || raw.includes("quota") || raw.includes("exceeded the quota")) {
    return "تم تجاوز حد الحصة في Neon (Postgres 53000 Quota Exceeded) — تواصل مع إدارة المشروع لترقية خطة Neon أو انتظار دورة الفوترة.";
  }
  if (errCode === "53300" || raw.includes("too many clients") || raw.includes("too many connections")) {
    return "تم استنزاف عدد الاتصالات المسموح بها في قاعدة البيانات (Postgres 53300) — تحقق من استخدام endpoint المجمّع (-pooler).";
  }
  if (errCode === "53100" || raw.includes("disk full") || errCode === "53200" || raw.includes("out of memory")) {
    return "استنفاد موارد التخزين أو الذاكرة في قاعدة البيانات (Postgres 53100/53200).";
  }
  if (errCode === "57P03" || raw.includes("the database system is starting up") || raw.includes("cannot connect now")) {
    return "قاعدة البيانات قيد الإقلاع أو الاستعادة من السكون (Postgres 57P03) — أعد المحاولة خلال ثوانٍ.";
  }
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
    checkAuthStorage(),
    checkDatabase(),
    checkGoogleClientId(),
    checkGoogleClientSecret(),
  ];
}
