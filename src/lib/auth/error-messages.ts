/**
 * Auth error presentation — ONE translation from a Better Auth failure (or a
 * configuration defect) to what the visitor reads.
 *
 * Rules this module enforces:
 *   · every failure produces a specific, actionable Arabic sentence;
 *   · no stack trace, provider payload, HTTP detail or secret ever reaches the
 *     screen — the raw error is summarized, never echoed;
 *   · the same failure reads the same everywhere (sign-in page, sign-up page,
 *     inline notices), because the mapping lives here and nowhere else.
 */

import type { AuthEnvironmentReport } from "./config";

/** The shape Better Auth's client returns for a failed call. */
export type AuthErrorLike = {
  code?: string | null;
  message?: string | null;
  status?: number | null;
  statusText?: string | null;
};

/** Which surface is asking, since the same code can read differently. */
export type AuthErrorContext = "sign-in" | "sign-up" | "generic";

/** The generic fallback: never blank, never a stack trace. */
export const GENERIC_AUTH_ERROR =
  "تعذّر إكمال العملية. تحقق من اتصالك ثم أعد المحاولة.";

/**
 * Map a Better Auth error code (or its message) to the sentence the visitor
 * sees. `code` is authoritative; the message is only a fallback for older
 * responses that carry no code.
 */
export function authErrorMessage(
  error: AuthErrorLike | null | undefined,
  context: AuthErrorContext = "generic",
): string {
  if (!error) return GENERIC_AUTH_ERROR;
  const code = String(error.code ?? "").toUpperCase();
  const message = String(error.message ?? "");

  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
    case "CREDENTIAL_ACCOUNT_NOT_FOUND":
    case "INVALID_USER":
    case "USER_NOT_FOUND":
      return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "هذا البريد الإلكتروني مسجّل بالفعل. سجّل الدخول بدلًا من إنشاء حساب جديد.";
    case "INVALID_EMAIL":
      return "صيغة البريد الإلكتروني غير صحيحة.";
    case "PASSWORD_TOO_SHORT":
      return "كلمة المرور قصيرة — 8 أحرف على الأقل.";
    case "PASSWORD_TOO_LONG":
      return "كلمة المرور طويلة — 128 حرفًا كحد أقصى.";
    case "PASSWORD_ALREADY_SET":
    case "USER_ALREADY_HAS_PASSWORD":
      return "هذا الحساب لديه كلمة مرور بالفعل. سجّل الدخول بها أو استعد كلمة المرور.";
    case "MISSING_FIELD":
    case "VALIDATION_ERROR":
      return context === "sign-up"
        ? "تحقق من الاسم والبريد الإلكتروني وكلمة المرور ثم أعد المحاولة."
        : "أدخل البريد الإلكتروني وكلمة المرور.";
    case "EMAIL_PASSWORD_SIGN_UP_DISABLED":
    case "EMAIL_PASSWORD_DISABLED":
      return "إنشاء الحساب بكلمة المرور غير مفعّل حاليًا. تواصل مع إدارة المنصة.";
    case "INVALID_ORIGIN":
    case "MISSING_OR_NULL_ORIGIN":
    case "CROSS_SITE_NAVIGATION_LOGIN_BLOCKED":
      return "رُفض الطلب لأسباب أمنية (نطاق غير موثوق). أعد تحميل الصفحة ثم حاول مرة أخرى.";
    case "INVALID_CALLBACK_URL":
    case "INVALID_REDIRECT_URL":
    case "INVALID_ERROR_CALLBACK_URL":
      return "وجهة العودة بعد تسجيل الدخول غير صالحة. افتح الصفحة الرئيسية ثم أعد المحاولة.";
    case "SESSION_EXPIRED":
    case "TOKEN_EXPIRED":
    case "INVALID_TOKEN":
      return "انتهت الجلسة. سجّل الدخول من جديد.";
    case "DATABASE_QUOTA_EXCEEDED":
      return "خدمة قاعدة البيانات وصلت للحد الأقصى للحصة (Neon Quota Exceeded). تواصل مع إدارة المنصة لترقية الخطة.";
    case "DATABASE_TOO_MANY_CONNECTIONS":
      return "قاعدة البيانات تشهد ضغط اتصالات مؤقت. انتظر قليلًا ثم أعد المحاولة.";
    case "FAILED_TO_CREATE_USER":
    case "FAILED_TO_CREATE_SESSION":
    case "FAILED_TO_GET_SESSION":
    case "FAILED_TO_UPDATE_USER":
      if (/quota|53000/i.test(message)) {
        return "خدمة قاعدة البيانات وصلت للحد الأقصى للحصة (Neon Quota Exceeded). تواصل مع إدارة المنصة لترقية الخطة.";
      }
      if (/too many|53300/i.test(message)) {
        return "قاعدة البيانات تشهد ضغط اتصالات مؤقت. انتظر قليلًا ثم أعد المحاولة.";
      }
      return "تعذّر إكمال العملية في الخادم. أعد المحاولة بعد قليل؛ وإذا تكرر الخطأ تواصل مع الدعم.";
    case "PROVIDER_NOT_FOUND":
      return "طريقة تسجيل الدخول المطلوبة غير مفعّلة على هذه النسخة.";
    case "EMAIL_NOT_VERIFIED":
      return "البريد الإلكتروني غير مؤكد بعد.";
    case "TOO_MANY_REQUESTS":
      return "محاولات كثيرة في وقت قصير. انتظر قليلًا ثم أعد المحاولة.";
    default:
      break;
  }

  // Fallbacks for responses without a code. Compared loosely and never echoed.
  if (/quota|53000/i.test(message)) {
    return "خدمة قاعدة البيانات وصلت للحد الأقصى للحصة (Neon Quota Exceeded). تواصل مع إدارة المنصة لترقية الخطة.";
  }
  if (/too many connections|too many clients|connection slots|53300/i.test(message)) {
    return "قاعدة البيانات تشهد ضغط اتصالات مؤقت. انتظر قليلًا ثم أعد المحاولة.";
  }
  if (/user already exists/i.test(message)) {
    return "هذا البريد الإلكتروني مسجّل بالفعل. سجّل الدخول بدلًا من إنشاء حساب جديد.";
  }
  if (/invalid email or password/i.test(message)) {
    return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
  }
  if (/password too short/i.test(message)) {
    return "كلمة المرور قصيرة — 8 أحرف على الأقل.";
  }
  if (/invalid origin/i.test(message)) {
    return "رُفض الطلب لأسباب أمنية (نطاق غير موثوق). أعد تحميل الصفحة ثم حاول مرة أخرى.";
  }
  if (/not enabled/i.test(message)) {
    return "هذه الطريقة في تسجيل الدخول غير مفعّلة على هذه النسخة.";
  }
  if (typeof error.status === "number" && error.status >= 500) {
    return "تعذّر إكمال العملية في الخادم. أعد المحاولة بعد قليل.";
  }
  return GENERIC_AUTH_ERROR;
}

/**
 * Whether the environment can host a working account flow. The sign-in and
 * sign-up pages surface `authConfigurationNotice()` instead of pretending the
 * button will work.
 */
export function authConfigurationNotice(
  report: Pick<AuthEnvironmentReport, "ok" | "errors" | "providers">,
): string | null {
  if (report.ok) return null;
  if (!report.providers.google && !report.providers.emailPassword) {
    return "تسجيل الدخول غير مهيأ على هذه النسخة: لا توجد طريقة دخول مفعّلة على الخادم.";
  }
  return "تسجيل الدخول غير مهيأ بالكامل على هذه النسخة: إعدادات الخادم ناقصة، وقد لا تستمر الجلسة. تواصل مع إدارة المنصة.";
}

/** Short, non-secret one-line detail for the operator-facing notice. */
export function authConfigurationDetail(
  report: Pick<AuthEnvironmentReport, "errors">,
): string[] {
  // Messages built by `config.ts` carry variable NAMES only — never a value —
  // so they are safe to show. Stack traces would not be.
  return report.errors.map((error) => error.replace(/\s+/g, " ").trim());
}
