import { Navigate } from "@tanstack/react-router";
import { BRAND } from "@/lib/brand";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { SIGN_UP_ROUTE } from "@/lib/site-routes";
import { EmailAuthForm } from "./EmailAuthForm";
import { SiteFooter, SiteHeader } from "./SiteChrome";

/**
 * Sign-in page — the target of `SIGN_IN_PATH` (`gates.tsx`), so it must exist or
 * every signed-out guard redirects into a 404.
 *
 * Waits out `isPending` before deciding anything: acting on `user === null` while
 * the session is still resolving would bounce an already-signed-in visitor back
 * here on every hard reload.
 */
export function SignInPage({ redirect }: { redirect?: string } = {}) {
  const { user, isPending } = useCurrentUserState();

  if (isPending) {
    return (
      <div className="min-h-screen bg-paper">
        <SiteHeader current={"/login"} />
        <main className="mx-auto grid w-full max-w-md place-items-center px-4 py-24">
          <p className="text-[13px] text-muted">جارٍ التحقق من الجلسة…</p>
        </main>
      </div>
    );
  }

  if (user) {
    /* Already signed in: the guarded destination is where the visitor wanted
       to be — honour it with a full navigation, or the account page otherwise. */
    if (redirect) {
      if (typeof window !== "undefined") window.location.replace(redirect);
      return null;
    }
    return <Navigate to="/account" />;
  }

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader current={"/login"} />
      <main className="mx-auto w-full max-w-md px-4 py-16">
        <div className="rounded-[14px] border border-line bg-surface p-6 shadow-sm">
          <h1 className="text-xl font-extrabold">تسجيل الدخول</h1>
          <p className="mt-2 text-[13px] leading-6 text-muted">
            سجّل الدخول للوصول إلى حسابك، ومشاريعك، والمحرر، وأدوات الذكاء الاصطناعي.
          </p>

          <EmailAuthForm mode="sign-in" redirect={redirect} />

          <p className="mt-5 border-t border-line pt-4 text-[11px] leading-5 text-muted">
            بياناتك ومشاريعك محفوظة في حسابك ومتصفحك. {BRAND.lockup} —{" "}
            {BRAND.platform}
            {" · "}
            <a href={SIGN_UP_ROUTE} className="font-bold text-brand underline-offset-4 hover:underline">
              إنشاء حساب جديد
            </a>
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
