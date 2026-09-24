import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Lock, PenLine, ShieldCheck } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { SOCIAL_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

/**
 * «تسجيل الدخول مطلوب قبل التصدير» — the gate shown when a visitor who is not
 * signed in tries to export / download a design.
 *
 * It reuses the platform's existing auth surface only: the Better Auth client
 * (`signIn`) and the provider list shared with `/login`. It never mints a local
 * session and never bypasses the server. When auth is disabled
 * (`VITE_AUTH_ENABLED=false`, the dev fallback) the caller never opens it —
 * `useCurrentUserState()` already reports a user, so nothing here is reached.
 */
export function SignInRequiredModal({
  open,
  onClose,
  intent = "تصدير التصميم",
  callbackURL = "/editor",
  onBrowseOptions,
}: {
  open: boolean;
  onClose: () => void;
  /** Short label of what the visitor was doing, shown in the title. */
  intent?: string;
  /** Where the visitor returns after a successful sign-in. */
  callbackURL?: string;
  /** Optional secondary action: let the guest review the export options first. */
  onBrowseOptions?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open || !authEnabled) return null;

  const start = (providerId: string) => {
    setError(null);
    setBusy(providerId);
    void signIn(providerId as "google", { callbackURL }).catch((err: unknown) => {
      setBusy(null);
      setError(err instanceof Error ? err.message : "تعذّر تسجيل الدخول. حاول مرة أخرى.");
    });
  };

  return (
    <div
      className="fixed inset-0 z-[calc(var(--z-dialog)+2)] grid place-items-center bg-navy/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`تسجيل الدخول مطلوب قبل ${intent}`}
      dir="rtl"
    >
      <div className="w-full max-w-md rounded-[16px] border border-line bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-[#161c26]">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-navy/10 text-navy dark:bg-white/10 dark:text-white">
            <Lock className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-[17px] font-extrabold">تسجيل الدخول مطلوب لإكمال {intent}</h2>
            <p className="mt-1.5 text-[12.5px] leading-6 text-muted">
              التحرير متاح لك كزائر بالكامل، وتبقى مسودتك محفوظة في متصفحك. نحتاج حسابًا
              واحدًا فقط قبل تنزيل الملف، لربط المخرج بك وبتفاصيل الترخيص الخاصة بك.
            </p>
          </div>
        </div>

        <ul className="mt-4 grid gap-2 text-[12px] text-muted">
          <li className="flex items-center gap-2">
            <ShieldCheck className="size-4 shrink-0 text-navy-2 dark:text-gold-2" aria-hidden />
            لا يتغيّر أي محتوى في مشروعك — يُطلب الحساب عند التنزيل فقط.
          </li>
          <li className="flex items-center gap-2">
            <PenLine className="size-4 shrink-0 text-navy-2 dark:text-gold-2" aria-hidden />
            يمكنك متابعة التحرير ثم العودة للتصدير في أي وقت.
          </li>
        </ul>

        <div className="mt-5 grid gap-2">
          {SOCIAL_PROVIDERS.map((provider) => (
            <button
              key={provider.providerId}
              type="button"
              disabled={busy !== null}
              onClick={() => start(provider.providerId)}
              className={cn(
                "inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-navy text-[13px] font-extrabold text-white transition hover:bg-navy-2",
                "disabled:cursor-wait disabled:opacity-60",
              )}
            >
              {busy === provider.providerId ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy === provider.providerId ? "جارٍ التحويل…" : `الدخول عبر ${provider.label}`}
            </button>
          ))}
        </div>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-[12px] leading-6 text-danger"
          >
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4 dark:border-white/10">
          {onBrowseOptions && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onBrowseOptions();
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-line px-4 text-[12px] font-bold dark:border-white/10"
            >
              <ArrowLeft className="size-4" aria-hidden />
              استعراض خيارات التصدير
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-[10px] px-4 text-[12px] font-bold text-muted hover:bg-line-2 dark:hover:bg-white/5"
          >
            متابعة التحرير
          </button>
        </div>

        <p className="mt-4 text-[10.5px] leading-5 text-muted">
          {BRAND.platform} — {BRAND.tagline}. تسجيل الدخول يتم عبر مزوّد الهوية نفسه المستخدم في
          المنصة، ولا نحتفظ بكلمة مرور.
        </p>
      </div>
    </div>
  );
}
