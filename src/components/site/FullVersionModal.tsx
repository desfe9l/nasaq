import { useEffect, useState } from "react";
import {
  CheckCircle2,
  X,
  MessageCircle,
  Key,
  Sparkles,
  Palette,
  FileDown,
  Layers,
  HardDrive,
  Printer,
  Type,
  Check,
  Minus,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { BRAND, whatsappHref } from "@/lib/brand";
import { useLicense } from "@/lib/license/client";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { cn } from "@/lib/utils";

interface FullVersionModalProps {
  open: boolean;
  onClose: () => void;
  defaultTab?: "features" | "activate";
}

/**
 * «طلب النسخة الكاملة» — the one upgrade surface.
 *
 * Activation goes ONLY through the existing server-validated license API
 * (`useLicense().activate` → activateLicenseFn → validateLicenseFn). There is
 * deliberately no local/offline "unlock": entitlements are granted by the
 * server or not at all.
 */
const COMPARISON: {
  icon: typeof FileDown;
  title: string;
  hint: string;
  demo: string | false;
  full: string;
}[] = [
  { icon: FileDown, title: "تصدير PDF عالي الدقة", hint: "PDF للطباعة والأرشفة الرسمية", demo: false, full: "غير مقيّد" },
  { icon: Printer, title: "دقة طباعة 300 DPI", hint: "مخرجات جاهزة للمطابع", demo: "صور 72 DPI فقط", full: "حتى 384 DPI" },
  { icon: Layers, title: "Word · PowerPoint · HTML", hint: "ملفات قابلة للتعديل وملف المشروع", demo: false, full: "جميع الصيغ" },
  { icon: Palette, title: "حزم الهوية (Brand Kits)", hint: "ألوان وشعارات وخطوط الجهة", demo: false, full: "هويات متعددة" },
  { icon: Sparkles, title: "مكتبة القوالب الكاملة", hint: "كل حزم القوالب المؤسسية", demo: "قالب فارغ فقط", full: "وصول كامل" },
  { icon: Type, title: "الخطوط والموارد المعتمدة", hint: "حسب الموارد المتاحة في المنصة", demo: "أساسية", full: "كاملة" },
  { icon: HardDrive, title: "المشاريع والصفحات المحلية", hint: "تُحفظ في متصفحك", demo: "مشروع واحد · 3 صفحات", full: "بلا حد" },
];

const TRUST = ["💻 تخزين محلي أولًا", "⚡ تفعيل فوري", "💬 دعم مباشر"];

export function FullVersionModal({ open, onClose, defaultTab = "features" }: FullVersionModalProps) {
  const [activeTab, setActiveTab] = useState<"features" | "activate">(defaultTab);
  const [licenseKey, setLicenseKey] = useState("");
  const [isActivating, setIsActivating] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const user = useCurrentUser();
  const { activate, hasLicense, license } = useLicense(user?.id, user?.primaryEmail);

  useEffect(() => {
    if (open) setActiveTab(defaultTab);
  }, [open, defaultTab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const handleActivate = async () => {
    const key = licenseKey.trim();
    setErrorMessage(null);
    if (!key) {
      setErrorMessage("يرجى إدخال كود الرخصة أولاً");
      return;
    }
    setIsActivating(true);
    setSuccessMessage(null);
    try {
      const res = await activate(key);
      if (res.success) {
        setSuccessMessage("تم تفعيل رخصتك بنجاح — أُتيحت مزايا النسخة الكاملة.");
        toast.success("تم تفعيل الرخصة بنجاح");
        // Other open surfaces (editor, export dialog) re-validate on reload.
        setTimeout(() => window.location.reload(), 1400);
      } else {
        setErrorMessage(res.message || "كود الرخصة غير صالح أو منتهي الصلاحية");
      }
    } catch {
      setErrorMessage("تعذر التحقق من كود الرخصة — تحقق من الاتصال ثم أعد المحاولة");
    } finally {
      setIsActivating(false);
    }
  };

  const enterpriseWhatsappText = `السلام عليكم، أرغب بطلب ترخيص مؤسسي للنسخة الكاملة من منصة ${BRAND.platform} (${BRAND.platformEn}).`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="طلب النسخة الكاملة"
      dir="rtl"
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-md animate-in fade-in duration-200 sm:p-5"
      onClick={onClose}
    >
      <div
        className="relative my-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-emerald-500/25 bg-[#0b1320]/95 text-white shadow-[0_24px_70px_-20px_rgba(0,0,0,0.8),0_0_50px_-20px_rgba(16,185,129,0.35)] backdrop-blur-2xl animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute -top-28 right-1/4 h-56 w-96 rounded-full bg-emerald-500/12 blur-3xl" aria-hidden />

        {/* Header */}
        <div className="relative flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <Sparkles className="size-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[17px] font-black text-white sm:text-[18px]">طلب النسخة الكاملة</h3>
              <p className="text-[12px] text-gray-400">التجريبية مقابل النسخة الكاملة من {BRAND.platform}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/10 text-gray-400 transition hover:bg-white/10 hover:text-white"
            aria-label="إغلاق"
          >
            <X className="size-4" />
          </button>
        </div>

        {hasLicense && license && (
          <div className="relative mx-5 mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] font-bold text-emerald-300 sm:mx-6">
            <CheckCircle2 className="size-4 shrink-0" />
            لديك رخصة نشطة ({license.keyPrefix}…) — مزايا النسخة الكاملة مفعّلة على هذا المتصفح.
          </div>
        )}

        {/* Tabs */}
        <div className="relative flex border-b border-white/10 px-3 sm:px-4" role="tablist">
          {(
            [
              ["features", "المقارنة والمزايا", Layers],
              ["activate", "إدخال كود الرخصة", Key],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              className={cn(
                "flex items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] font-extrabold transition sm:px-4",
                activeTab === id ? "border-emerald-500 text-emerald-400" : "border-transparent text-gray-400 hover:text-white",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="relative p-5 sm:p-6">
          {activeTab === "features" ? (
            <div className="space-y-5">
              <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
                <div className="grid grid-cols-[1.6fr_1fr_1fr] border-b border-white/10 bg-white/[0.04] px-3 py-2.5 text-[12px] font-extrabold text-gray-300">
                  <span>الميزة</span>
                  <span className="text-center text-gray-400">التجريبية</span>
                  <span className="text-center font-black text-emerald-400">النسخة الكاملة</span>
                </div>
                <div className="divide-y divide-white/5 text-[12px]">
                  {COMPARISON.map((row) => (
                    <div key={row.title} className="grid grid-cols-[1.6fr_1fr_1fr] items-center gap-1 px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <row.icon className="size-4 shrink-0 text-emerald-400" />
                        <div className="min-w-0">
                          <strong className="block font-bold text-white">{row.title}</strong>
                          <span className="text-[11px] text-gray-400">{row.hint}</span>
                        </div>
                      </div>
                      <div className="text-center text-[11px] text-gray-400">
                        {row.demo === false ? (
                          <Minus className="mx-auto size-4 text-gray-600" aria-label="غير متاح" />
                        ) : (
                          row.demo
                        )}
                      </div>
                      <div className="text-center">
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-extrabold text-emerald-300">
                          <Check className="size-3" /> {row.full}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("activate")}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-emerald-600 to-emerald-500 px-5 text-[14px] font-black text-white shadow-[0_0_22px_rgba(16,185,129,0.35)] transition hover:from-emerald-500 hover:to-emerald-400"
                >
                  ⚡ تفعيل الرخصة مباشرة
                </button>
                <a
                  href={whatsappHref(enterpriseWhatsappText)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-5 text-[14px] font-bold text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  <MessageCircle className="size-4" />
                  💬 طلب ترخيص مؤسسي عبر الواتساب
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
                <label htmlFor="nasaq-license-key" className="mb-2 block text-[13px] font-bold text-white">
                  إدخال كود الرخصة
                </label>
                <div className="relative">
                  <input
                    id="nasaq-license-key"
                    type="text"
                    dir="ltr"
                    autoComplete="off"
                    spellCheck={false}
                    value={licenseKey}
                    onChange={(e) => {
                      setLicenseKey(e.target.value);
                      setErrorMessage(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleActivate();
                    }}
                    placeholder="NASAQ-XXXX-XXXX-XXXX"
                    className="h-12 w-full rounded-xl border border-white/15 bg-black/40 pe-4 ps-10 font-mono text-[14px] font-bold tracking-wider text-emerald-300 placeholder:text-gray-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <Key className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-gray-500" />
                </div>
                <p className="mt-2 text-[11px] leading-5 text-gray-400">
                  يُتحقق من الكود عبر خادم التراخيص، ثم تُفعَّل المزايا فورًا على هذا المتصفح.
                </p>
                {errorMessage && (
                  <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] font-bold text-red-300" role="alert">
                    {errorMessage}
                  </p>
                )}
                {successMessage && (
                  <p className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] font-bold text-emerald-300" role="status">
                    <CheckCircle2 className="size-4 shrink-0" />
                    {successMessage}
                  </p>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={isActivating}
                  onClick={() => void handleActivate()}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-emerald-600 to-emerald-500 px-5 text-[14px] font-black text-white shadow-[0_0_22px_rgba(16,185,129,0.35)] transition hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-60"
                >
                  {isActivating ? <Loader2 className="size-4 animate-spin" /> : null}
                  {isActivating ? "جارٍ التحقق…" : "⚡ تفعيل الرخصة مباشرة"}
                </button>
                <a
                  href={whatsappHref(enterpriseWhatsappText)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-5 text-[14px] font-bold text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  💬 طلب ترخيص مؤسسي عبر الواتساب
                </a>
              </div>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 border-t border-white/10 pt-4">
            {TRUST.map((badge) => (
              <span key={badge} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-bold text-gray-300">
                {badge}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
