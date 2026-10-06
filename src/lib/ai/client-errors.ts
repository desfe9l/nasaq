/**
 * What the author reads when an AI call fails BEFORE the provider ever runs.
 *
 * The server functions return typed failures for provider problems
 * (`not_configured`, `rate_limited`, `provider_error`, …) — but the ones that
 * happen first are THROWN: `authMiddleware` rejects an unauthenticated call with
 * `Unauthorized`, and a network failure rejects with a fetch error. Both used to
 * collapse into "تعذر الاتصال بخدمة الذكاء الاصطناعي", which blames the AI
 * provider for a session that simply is not there — and sends the author looking
 * for a problem that does not exist.
 *
 * This mapper keeps the distinction the server made, in Arabic, and never echoes
 * a raw message, stack trace or provider payload.
 */

/** Provider-side fallback used when nothing more specific is known. */
export const AI_GENERIC_ERROR = "تعذّر إكمال طلب الذكاء الاصطناعي. لم يتغير المستند.";

/** The message shown when the caller has no usable session. */
export const AI_SIGN_IN_REQUIRED =
  "تحتاج إلى تسجيل الدخول بحسابك لاستخدام أدوات الذكاء الاصطناعي.";

/** The message shown when the account is signed in but not permitted. */
export const AI_NOT_PERMITTED = "لا تملك صلاحية استخدام هذه الميزة على حسابك الحالي.";

/** Map a thrown AI-call error to a specific Arabic sentence. */
export function aiCallErrorMessage(
  error: unknown,
  fallback: string = AI_GENERIC_ERROR,
): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const text = raw.toLowerCase();

  // `UnauthorizedError` carries the stable message "Unauthorized" (see
  // `verify.server.ts`); TanStack serializes it with status 401.
  if (text.includes("unauthorized") || text.includes("401")) return AI_SIGN_IN_REQUIRED;
  if (text.includes("forbidden") || text.includes("403")) return AI_NOT_PERMITTED;
  if (text.includes("cross-site") || text.includes("forbidden: cross-site")) {
    return AI_NOT_PERMITTED;
  }
  if (text.includes("rate") && text.includes("limit")) {
    return "محاولات كثيرة في وقت قصير. انتظر دقيقة ثم أعد المحاولة. لم يتغير المستند.";
  }
  if (
    text.includes("failed to fetch") ||
    text.includes("networkerror") ||
    text.includes("load failed") ||
    text.includes("network request failed")
  ) {
    return "تعذّر الوصول إلى الخادم — تحقق من اتصالك ثم أعد المحاولة. لم يتغير المستند.";
  }
  if (text.includes("timeout") || text.includes("aborted")) {
    return "انتهت مهلة الطلب. لم يتغير المستند؛ حاول مرة أخرى.";
  }
  return fallback;
}
