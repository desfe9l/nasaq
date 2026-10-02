import { useEffect, useState } from "react";
import { MonitorDown, Share, X } from "lucide-react";
import { toast } from "sonner";
import {
  canInstallApp,
  installOfferSeen,
  isIosSafari,
  isStandalone,
  markInstallOfferSeen,
  onInstallChange,
  promptInstallApp,
} from "@/lib/app-install";
import { cn } from "@/lib/utils";

/**
 * «ثبّت نَسَق على سطح المكتب» — the one-time install offer and its button.
 *
 * First editor visit (and the workspace page, as a permanent button) offers
 * the native install dialog where the browser supports it; iOS Safari gets
 * the honest share-sheet path instead of a dead button.
 */
export function AppInstallNotice({
  variant = "auto",
  className,
}: {
  /** `auto` shows the one-time card; `button` is a permanent control. */
  variant?: "auto" | "button";
  className?: string;
}) {
  const [, bump] = useState(0);
  useEffect(
    () =>
      onInstallChange(() => {
        bump((n) => n + 1);
      }),
    [],
  );
  const [open, setOpen] = useState(false);
  const [iosHelp, setIosHelp] = useState(false);

  useEffect(() => {
    if (variant !== "auto" || isStandalone() || installOfferSeen()) return;
    const timer = window.setTimeout(() => {
      if (canInstallApp() || isIosSafari()) setOpen(true);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [variant]);

  if (isStandalone()) return null;

  const dismiss = () => {
    setOpen(false);
    markInstallOfferSeen();
  };

  const install = async () => {
    if (isIosSafari() && !canInstallApp()) {
      setIosHelp(true);
      return;
    }
    const result = await promptInstallApp();
    if (result === "accepted") {
      toast.success("تم تثبيت نَسَق — ستجده مع تطبيقات سطح المكتب");
      dismiss();
    } else if (result === "dismissed") {
      dismiss();
    } else {
      setIosHelp(true);
    }
  };

  if (variant === "button") {
    return (
      <span className={cn("relative inline-flex", className)}>
        <button
          type="button"
          onClick={() => void install()}
          className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[11px] font-extrabold text-ink transition hover:border-brand hover:bg-paper/60"
        >
          <MonitorDown className="size-3.5" aria-hidden />
          تثبيت التطبيق
        </button>
        {iosHelp && (
          <span
            role="dialog"
            aria-label="طريقة التثبيت على أجهزة أبل"
            className="absolute bottom-full start-0 z-50 mb-2 grid w-64 gap-1.5 rounded-xl border border-line bg-surface p-3 text-[11px] leading-5 shadow-lg"
          >
            <span className="flex items-center gap-1.5 font-extrabold text-ink">
              <Share className="size-3.5" aria-hidden /> على iPhone / iPad
            </span>
            <span className="text-muted">
              افتح الموقع في Safari، اضغط زر المشاركة، ثم «إضافة إلى الشاشة
              الرئيسية». على الكمبيوتر: قائمة المتصفح ← «تثبيت التطبيق».
            </span>
            <button
              type="button"
              onClick={() => setIosHelp(false)}
              className="mt-1 self-start rounded-[6px] border border-line px-2 py-1 font-bold text-muted"
            >
              إغلاق
            </button>
          </span>
        )}
      </span>
    );
  }

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label="تثبيت نَسَق كتطبيق سطح المكتب"
      className="fixed bottom-4 start-4 z-[var(--z-bubble)] grid w-[min(92vw,340px)] gap-2 rounded-2xl border border-line bg-surface p-4 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-navy/10 text-brand">
          <MonitorDown className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-extrabold text-ink">
            ثبّت نَسَق كتطبيق سطح المكتب
          </p>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            نافذة مستقلة بدون شريط المتصفح، تشغيل أسرع، ووصول مباشر من سطح
            المكتب أو قائمة التطبيقات.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="إخفاء عرض التثبيت"
          className="grid size-7 shrink-0 place-items-center rounded-[6px] text-muted hover:bg-line-2"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void install()}
          className="h-9 flex-1 rounded-[8px] bg-navy text-[11px] font-extrabold text-white transition hover:opacity-90"
        >
          تثبيت الآن
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="h-9 rounded-[8px] border border-line px-3 text-[11px] font-extrabold text-muted"
        >
          لاحقًا
        </button>
      </div>
    </div>
  );
}
