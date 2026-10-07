import { useEffect, useState } from "react";
import {
  FileCheck2,
  Layers,
  Loader2,
  PenLine,
  ShieldCheck,
} from "lucide-react";
import { BRAND } from "@/lib/brand";
import { SOCIAL_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import type { PendingSummary } from "@/lib/nsq/inbox";
import { NSQ_RESUME_URL } from "@/lib/nsq/intake";
import { cn } from "@/lib/utils";

/**
 * «مشروع نَسَق بانتظارك» — the account step for a received `.nsq`.
 *
 * Shown only AFTER the file has been validated and preserved in the inbox, so
 * signing in (or creating an account — Google sign-in does both) can never
 * lose it. It previews the actual project (first page, title, page count) so
 * the visitor sees something they can use, not a download wall. Reuses the
 * platform's existing auth client and provider list; after the round
 * trip `NSQ_RESUME_URL` brings them straight back into the editor, where the
 * project opens.
 */
export function NsqAccountGate({
  summary,
  onLater,
  onDiscard,
}: {
  summary: PendingSummary;
  onLater: () => void;
  onDiscard: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onLater();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onLater]);

  if (!authEnabled) return null;

  const start = (providerId: string) => {
    setError(null);
    setBusy(providerId);
    void signIn(providerId as "google", {
      callbackURL: NSQ_RESUME_URL,
      errorCallbackURL: NSQ_RESUME_URL,
    })
      .then(() => setBusy(null))
      .catch((err: unknown) => {
        setBusy(null);
        setError(
          err instanceof Error
            ? err.message
            : "تعذّر تسجيل الدخول. حاول مرة أخرى.",
        );
      });
  };

  const pages = summary.pageCount;
  const pagesLabel =
    pages === 1 ? "صفحة واحدة" : pages === 2 ? "صفحتان" : `${pages} صفحات`;

  return (
    <div
      className="fixed inset-0 z-[calc(var(--z-dialog)+2)] grid place-items-center bg-navy/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nsq-gate-title"
      dir="rtl"
      onClick={onLater}
    >
      <div
        className="grid max-h-[92vh] w-full max-w-[720px] overflow-y-auto rounded-[16px] border border-line bg-surface shadow-2xl sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* The project itself — what the visitor is about to get. */}
        <div className="flex flex-col items-center justify-center gap-3 border-b border-line bg-line-2/50 p-5 sm:border-b-0 sm:border-l">
          <div className="grid w-full max-w-[240px] place-items-center overflow-hidden rounded-[10px] border border-line bg-surface shadow-sm">
            {summary.thumbnail ? (
              <img
                src={summary.thumbnail}
                alt={`معاينة الصفحة الأولى من «${summary.title}»`}
                className="block h-auto max-h-[300px] w-full object-contain"
              />
            ) : (
              <div className="grid aspect-[210/297] w-full place-items-center text-muted">
                <Layers className="size-10" aria-hidden />
              </div>
            )}
          </div>
          <div className="w-full max-w-[240px] text-center">
            <strong className="block truncate text-[14px] font-extrabold text-brand">
              {summary.title}
            </strong>
            <span className="mt-0.5 block text-[11.5px] text-muted">
              {pagesLabel} · مشروع {BRAND.platform} قابل للتعديل
            </span>
          </div>
        </div>

        <div className="p-6">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 px-2.5 py-1 text-[11px] font-extrabold text-success">
            <FileCheck2 className="size-3.5" aria-hidden />
            تم التعرّف على الملف وحفظه بأمان
          </span>
          <h2
            id="nsq-gate-title"
            className="mt-3 text-[18px] font-extrabold leading-7"
          >
            مشروعك جاهز للفتح في {BRAND.platform}
          </h2>
          <p className="mt-1.5 text-[12.5px] leading-6 text-muted">
            سجّل الدخول أو أنشئ حسابك المجاني لفتح المشروع في المحرر مباشرةً،
            وتعديل نصوصه وصوره وطبقاته كما صمّمها صاحبها.
          </p>

          <ul className="mt-4 grid gap-2 text-[12px] text-muted">
            <li className="flex items-center gap-2">
              <ShieldCheck
                className="size-4 shrink-0 text-brand-hover"
                aria-hidden
              />
              الملف محفوظ في متصفحك ولن يضيع أثناء تسجيل الدخول.
            </li>
            <li className="flex items-center gap-2">
              <PenLine
                className="size-4 shrink-0 text-brand-hover"
                aria-hidden
              />
              يُفتح تلقائيًا بعد الدخول كمشروع جديد في مكتبتك.
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
                  "inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-navy text-[13px] font-extrabold text-on-brand transition hover:bg-navy-2",
                  "disabled:cursor-wait disabled:opacity-60",
                )}
              >
                {busy === provider.providerId ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {busy === provider.providerId
                  ? "جارٍ التحويل…"
                  : `الدخول أو إنشاء حساب عبر ${provider.label}`}
              </button>
            ))}
          </div>

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-[12px] leading-6 text-error"
            >
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <button
              type="button"
              onClick={onLater}
              className="h-9 rounded-[9px] px-3 text-[12px] font-bold text-muted hover:bg-line-2"
            >
              لاحقًا
            </button>
            <button
              type="button"
              onClick={onDiscard}
              className="h-9 rounded-[9px] px-3 text-[11.5px] font-bold text-muted underline-offset-4 hover:text-error hover:underline"
            >
              إزالة الملف
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
