import { Navigate } from "@tanstack/react-router";
import { BRAND } from "@/lib/brand";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { LOGIN_ROUTE } from "@/lib/site-routes";
import { EmailAuthForm } from "./EmailAuthForm";
import { SiteFooter, SiteHeader } from "./SiteChrome";

/**
 * Account creation — email + password, in this app's own Better Auth database.
 *
 * The same rules as sign-in: wait out `isPending` before deciding anything, and
 * send an already-signed-in visitor straight to the app (creating a second
 * account from inside a session is not a flow the product supports, and silently
 * replacing the active session would be worse).
 *
 * Success lands on `/workspace` — the licensed workspace when the account is
 * entitled, and the same page adapts otherwise; the licence itself is always
 * resolved server-side (see `useWorkspaceEntry`). A `?redirect=` destination, if
 * present, wins over the default.
 */
export function SignUpPage({ redirect }: { redirect?: string } = {}) {
  const { user, isPending } = useCurrentUserState();

  if (isPending) {
    return (
      <div className="min-h-screen bg-paper">
        <SiteHeader current={"/signup"} />
        <main className="mx-auto grid w-full max-w-md place-items-center px-4 py-24">
          <p className="text-[13px] text-muted">جارٍ التحقق من الجلسة…</p>
        </main>
      </div>
    );
  }

  if (user) {
    if (redirect) {
      if (typeof window !== "undefined") window.location.replace(redirect);
      return null;
    }
    return <Navigate to="/account" />;
  }

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader current={"/signup"} />
      <main className="mx-auto w-full max-w-md px-4 py-16">
        <div className="rounded-[14px] border border-line bg-surface p-6 shadow-sm">
          <h1 className="text-xl font-extrabold">إنشاء حساب جديد</h1>
          <p className="mt-2 text-[13px] leading-6 text-muted">
            أنشئ حسابك بالبريد الإلكتروني وكلمة المرور لتحفظ مشاريعك ومستنداتك،
            وتفتح المحرر و«نَسَق AI» من أي جهاز.
          </p>

          <EmailAuthForm mode="sign-up" redirect={redirect} />

          <ul className="mt-5 grid gap-1.5 border-t border-line pt-4 text-[11px] leading-5 text-muted">
            <li>· حساب واحد يجمع مشاريعك ومكتبتك وقوالبك.</li>
            <li>· تبدأ تجربة كاملة لمدة ثلاثة أيام من أول دخول.</li>
            <li>· يمكنك الدخول لاحقًا بحساب Google بالبريد نفسه.</li>
            <li>
              · بإنشاء حساب فإنك توافق على{" "}
              <a href="/terms" className="font-bold text-brand underline-offset-4 hover:underline">
                الشروط
              </a>{" "}
              و
              <a href="/privacy" className="font-bold text-brand underline-offset-4 hover:underline">
                سياسة الخصوصية
              </a>
              .
            </li>
          </ul>

          <p className="mt-4 text-[11px] leading-5 text-muted">
            {BRAND.lockup} — {BRAND.platform}
            {" · "}
            <a href={LOGIN_ROUTE} className="font-bold text-brand underline-offset-4 hover:underline">
              تسجيل الدخول
            </a>
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
