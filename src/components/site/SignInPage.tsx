import { useState } from "react";
import { Navigate } from "@tanstack/react-router";
import { BRAND } from "@/lib/brand";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { SiteFooter, SiteHeader } from "./SiteChrome";

/**
 * Sign-in page — the target of `SIGN_IN_PATH` (`gates.tsx`), so it must exist or
 * every signed-out guard redirects into a 404.
 *
 * Waits out `isPending` before deciding anything: acting on `user === null` while
 * the session is still resolving would bounce an already-signed-in visitor back
 * here on every hard reload.
 */
export function SignInPage() {
  const { user, isPending } = useCurrentUserState();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (isPending) {
    return (
      <div className="min-h-screen bg-paper">
        <SiteHeader current="/login" />
        <main className="mx-auto grid w-full max-w-md place-items-center px-4 py-24">
          <p className="text-[13px] text-muted">جارٍ التحقق من الجلسة…</p>
        </main>
      </div>
    );
  }

  if (user) return <Navigate to="/account" />;

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader current="/login" />
      <main className="mx-auto w-full max-w-md px-4 py-16">
        <div className="rounded-[14px] border border-line bg-surface p-6 shadow-sm dark:border-white/10">
          <h1 className="text-xl font-extrabold">تسجيل الدخول</h1>
          <p className="mt-2 text-[13px] leading-6 text-muted">
            سجّل الدخول للوصول إلى حسابك، واختيار الباقة، ومتابعة طلبات الدفع.
          </p>

          {!authEnabled ? (
            <p className="mt-5 rounded-[10px] border border-gold/40 bg-gold/10 p-3 text-[12px] leading-6">
              تسجيل الدخول غير مُفعّل في هذه النسخة. يتم استخدام حساب تجريبي محلي.
            </p>
          ) : (
            <div className="mt-5 grid gap-2">
              {GROK_PROVIDERS.map((provider) => (
                <button
                  key={provider.providerId}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    setError(null);
                    setBusy(provider.providerId);
                    void signIn(provider.providerId, { callbackURL: "/account" }).catch(
                      (err: unknown) => {
                        setBusy(null);
                        setError(
                          err instanceof Error ? err.message : "تعذّر تسجيل الدخول.",
                        );
                      },
                    );
                  }}
                  className="h-11 w-full cursor-pointer rounded-[10px] bg-navy text-[13px] font-extrabold text-white transition hover:bg-navy-2 disabled:cursor-wait disabled:opacity-60"
                >
                  {busy === provider.providerId
                    ? "جارٍ التحويل…"
                    : `المتابعة عبر ${provider.label}`}
                </button>
              ))}
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-[12px] leading-6 text-danger"
            >
              {error}
            </p>
          )}

          <p className="mt-5 border-t border-line pt-4 text-[11px] leading-5 text-muted dark:border-white/10">
            بياناتك ومشاريعك محفوظة في حسابك ومتصفحك. {BRAND.lockup} —{" "}
            {BRAND.platform}
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}