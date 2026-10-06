import { useEffect, useMemo, useState } from "react";
import { authEnabled, signIn, signInWithEmail, signUpWithEmail } from "@/lib/auth/client";
import { GOOGLE_PROVIDER_ID, SOCIAL_PROVIDERS } from "@/lib/auth/providers";
import { authStatusFn, type AuthStatus } from "@/lib/auth/status-functions";
import {
  authConfigurationDetail,
  authConfigurationNotice,
} from "@/lib/auth/error-messages";
import { normalizeEmail } from "@/lib/auth/credentials";
import { SIGN_UP_ROUTE } from "@/lib/site-routes";

/**
 * Email + password authentication form — the ONE surface for both directions.
 *
 * `mode` selects create-account vs sign-in; everything else (validation,
 * provider buttons, configuration notice, success navigation) is shared, so the
 * two pages can never drift into different rules or different wording.
 *
 * The password never leaves this component except in the request body, is never
 * logged, and is never written to storage. Success navigates with a real page
 * load so the Set-Cookie from the auth response is in force for the very next
 * server request — no stale client session store, no race with a guard.
 */
export function EmailAuthForm({
  mode,
  redirect,
}: {
  mode: "sign-in" | "sign-up";
  redirect?: string;
}) {
  const destination = redirect && redirect.startsWith("/") ? redirect : "/account";
  const isSignUp = mode === "sign-up";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<"email" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<AuthStatus | null>(null);

  /*
   * Ask the server what this deployment can actually do. Without this the page
   * would render a working-looking form on a half-configured deployment and the
   * visitor would be left with a failure that explains nothing.
   */
  useEffect(() => {
    let alive = true;
    void authStatusFn()
      .then((report) => {
        if (alive) setStatus(report);
      })
      .catch(() => {
        /* the form still works; the notice simply stays hidden */
      });
    return () => {
      alive = false;
    };
  }, []);

  const configNotice = useMemo(() => {
    if (!authEnabled || !status) return null;
    return authConfigurationNotice(status);
  }, [status]);
  const configDetail = status && !status.ok ? authConfigurationDetail(status) : [];
  const googleAvailable = status ? status.providers.google : true;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setFieldErrors({});
    setBusy("email");
    const input = { name, email, password, ...(isSignUp ? { confirm } : {}) };
    const result = isSignUp
      ? await signUpWithEmail({ ...input, callbackURL: destination })
      : await signInWithEmail({ ...input, callbackURL: destination });
    if (!result.ok) {
      setBusy(null);
      setError(result.message);
      setFieldErrors(result.fieldErrors ?? {});
      document.getElementById("auth-form-error")?.focus();
      return;
    }
    /* Success: hand over to a full navigation so the new session cookie is live
       for the next request (and every guard re-resolves from the server). */
    window.location.assign(isSignUp && !redirect ? "/workspace" : destination);
  };

  const startGoogle = async () => {
    if (busy) return;
    setError(null);
    setBusy("google");
    try {
      await signIn(GOOGLE_PROVIDER_ID, {
        callbackURL: destination,
        errorCallbackURL: "/login?oauth=error",
      });
      // A deployed sign-in leaves the page; the preview flow returns here.
      setBusy(null);
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : "تعذّر تسجيل الدخول عبر Google.");
    }
  };

  const field = (id: string) =>
    `h-11 w-full rounded-[10px] border bg-page px-3 text-[13px] font-bold outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 ${
      fieldErrors[id] ? "border-danger/60" : "border-line"
    }`;

  return (
    <form onSubmit={submit} className="mt-5 grid gap-3" noValidate>
      {!authEnabled && (
        <p className="rounded-[10px] border border-gold/40 bg-gold/10 p-3 text-[12px] leading-6">
          تسجيل الدخول غير مُفعّل في هذه النسخة. يتم استخدام حساب تجريبي محلي.
        </p>
      )}

      {configNotice && (
        <div className="rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-[12px] leading-6 text-error">
          <p className="font-bold">{configNotice}</p>
          {configDetail.length > 0 && (
            <ul className="mt-2 list-disc pe-5 text-[11px] leading-5 text-muted">
              {configDetail.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {authEnabled && (
        <>
          {isSignUp && (
            <label className="grid gap-1.5">
              <span className="text-[12px] font-bold">الاسم الكامل</span>
              <input
                type="text"
                name="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={field("name")}
                placeholder="مثال: فيصل العنزي"
              />
              {fieldErrors.name && (
                <span className="text-[11px] text-error">{fieldErrors.name}</span>
              )}
            </label>
          )}

          <label className="grid gap-1.5">
            <span className="text-[12px] font-bold">البريد الإلكتروني</span>
            <input
              type="email"
              name="email"
              dir="ltr"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(normalizeEmail(e.target.value))}
              className={field("email")}
              placeholder="name@example.com"
            />
            {fieldErrors.email && (
              <span className="text-[11px] text-error">{fieldErrors.email}</span>
            )}
          </label>

          <label className="grid gap-1.5">
            <span className="text-[12px] font-bold">كلمة المرور</span>
            <input
              type="password"
              name="password"
              dir="ltr"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={field("password")}
              placeholder={isSignUp ? "8 أحرف على الأقل" : "••••••••"}
            />
            {fieldErrors.password && (
              <span className="text-[11px] text-error">{fieldErrors.password}</span>
            )}
          </label>

          {isSignUp && (
            <label className="grid gap-1.5">
              <span className="text-[12px] font-bold">تأكيد كلمة المرور</span>
              <input
                type="password"
                name="confirm"
                dir="ltr"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={field("confirm")}
                placeholder="أعد كتابة كلمة المرور"
              />
              {fieldErrors.confirm && (
                <span className="text-[11px] text-error">{fieldErrors.confirm}</span>
              )}
            </label>
          )}

          <button
            type="submit"
            disabled={busy !== null}
            className="mt-1 h-11 w-full cursor-pointer rounded-[10px] bg-navy text-[13px] font-extrabold text-on-brand transition hover:bg-navy-2 disabled:cursor-wait disabled:opacity-60"
          >
            {busy === "email"
              ? isSignUp
                ? "جارٍ إنشاء الحساب…"
                : "جارٍ تسجيل الدخول…"
              : isSignUp
                ? "إنشاء حساب"
                : "تسجيل الدخول"}
          </button>

          <p
            id="auth-form-error"
            tabIndex={-1}
            role="alert"
            aria-live="polite"
            className={
              error
                ? "rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-[12px] leading-6 text-error outline-none"
                : "sr-only"
            }
          >
            {error ?? ""}
          </p>

          <p className="text-center text-[12px] leading-6 text-muted">
            {isSignUp ? "لديك حساب بالفعل؟ " : "ليس لديك حساب؟ "}
            <a
              href={`${isSignUp ? "/login" : SIGN_UP_ROUTE}${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""}`}
              className="font-bold text-brand underline-offset-4 hover:underline"
            >
              {isSignUp ? "تسجيل الدخول" : "إنشاء حساب جديد"}
            </a>
          </p>

          {googleAvailable && SOCIAL_PROVIDERS.length > 0 && (
            <div className="mt-1 grid gap-2 border-t border-line pt-4">
              {SOCIAL_PROVIDERS.map((provider) => (
                <button
                  key={provider.providerId}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void startGoogle()}
                  className="h-11 w-full cursor-pointer rounded-[10px] border border-line bg-surface text-[13px] font-extrabold text-ink transition hover:bg-surface-2 disabled:cursor-wait disabled:opacity-60"
                >
                  {busy === "google"
                    ? "جارٍ التحويل…"
                    : `المتابعة عبر ${provider.label}`}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </form>
  );
}
