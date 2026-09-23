import { createFileRoute, Navigate } from "@tanstack/react-router";
import { SignInButtons } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { user, isPending } = useCurrentUserState();

  if (isPending) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted">جارٍ التحقق…</div>;
  }
  if (user) return <Navigate to="/" />;

  return (
    <main dir="rtl" className="grid min-h-screen place-items-center bg-paper p-6 text-ink">
      <section className="w-full max-w-md rounded-2xl border border-line bg-white p-7 shadow-xl">
        <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-700">NASAQ</p>
        <h1 className="mt-2 text-2xl font-black">تسجيل الدخول</h1>
        <p className="mt-2 text-sm leading-6 text-muted">سجّل الدخول للوصول إلى المحرر ومشاريعك وميزاتك المرخّصة.</p>
        <div className="mt-6">
          <SignInButtons />
        </div>
      </section>
    </main>
  );
}
