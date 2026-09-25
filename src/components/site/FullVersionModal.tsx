import { useEffect, useState } from "react";
import { Check, X, Key, FileText, Layers, Palette, Printer, Type, HardDrive, CheckCircle2, Minus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BRAND, whatsappHref } from "@/lib/brand";
import { useLicense } from "@/lib/license/client";
import { cn } from "@/lib/utils";

interface FullVersionModalProps {
  open: boolean;
  onClose: () => void;
  defaultTab?: "features" | "activate";
}

const COMPARISON: {
  icon: typeof FileText;
  title: string;
  hint: string;
  demo: string | false;
  full: string;
}[] = [
  { icon: FileText, title: "تصدير PDF عالي الدقة", hint: "للطباعة والأرشفة الرسمية", demo: false, full: "غير مقيد" },
  { icon: Printer, title: "دقة طباعة 300 DPI", hint: "مخرجات جاهزة للمطابع", demo: "صور 72 DPI فقط", full: "حتى 384 DPI" },
  { icon: Layers, title: "Word و PowerPoint و HTML", hint: "ملفات قابلة للتعديل", demo: false, full: "جميع الصيغ" },
  { icon: Palette, title: "حزم الهوية المؤسسية", hint: "ألوان وشعارات وخطوط الجهة", demo: false, full: "هويات متعددة" },
  { icon: Layers, title: "مكتبة القوالب الكاملة", hint: "حزم القوالب المؤسسية", demo: "قالب فارغ فقط", full: "وصول كامل" },
  { icon: Type, title: "الخطوط والموارد", hint: "الموارد المتاحة في المنصة", demo: "أساسية", full: "كاملة" },
  { icon: HardDrive, title: "المشاريع والصفحات", hint: "محفوظة في متصفحك", demo: "مشروع واحد و3 صفحات", full: "بلا حد" },
];

export function FullVersionModal({ open, onClose, defaultTab = "features" }: FullVersionModalProps) {
  const [activeTab, setActiveTab] = useState<"features" | "activate">(defaultTab);
  const [licenseKey, setLicenseKey] = useState("");
  const [isActivating, setIsActivating] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { activate, hasLicense, license } = useLicense();

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
      setErrorMessage("يرجى إدخال كود الرخصة أولا");
      return;
    }
    setIsActivating(true);
    setSuccessMessage(null);
    try {
      const res = await activate(key);
      if (res.success) {
        setSuccessMessage("تم تفعيل رخصتك بنجاح — أتيحت مزايا النسخة الكاملة.");
        toast.success("تم تفعيل الرخصة بنجاح");
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setErrorMessage(res.message || "كود الرخصة غير صالح أو منتهي الصلاحية");
      }
    } catch {
      setErrorMessage("تعذر التحقق من كود الرخصة — تحقق من الاتصال ثم أعد المحاولة");
    } finally {
      setIsActivating(false);
    }
  };

  const enterpriseWhatsappText = `السلام عليكم، أرغب بطلب ترخيص مؤسسي للنسخة الكاملة من منصة ${BRAND.platform}.`;

  return (
    <div role="dialog" aria-modal="true" aria-label="طلب النسخة الكاملة" dir="rtl" className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-[#0F1E33]/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="relative my-auto w-full max-w-2xl overflow-hidden rounded-[14px] border border-line bg-white shadow-xl dark:border-white/10 dark:bg-[#161c26]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-line/70 bg-[#fcfdfc] px-6 py-4 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-[9px] border border-[#006C35]/15 bg-[#006C35]/10 text-[#006C35]">
              <FileText className="size-4" />
            </span>
            <div>
              <h3 className="text-[16px] font-bold text-[#0F1E33] dark:text-white">طلب النسخة الكاملة</h3>
              <p className="mt-0.5 text-[12px] text-[#667085] dark:text-white/50">مقارنة النسخة التجريبية والنسخة الكاملة</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-[8px] border border-line text-[#667085] hover:bg-[#f8faf9] dark:border-white/10 dark:hover:bg-white/5" aria-label="إغلاق">
            <X className="size-4" />
          </button>
        </div>

        {hasLicense && license && (
          <div className="mx-6 mt-4 flex items-center gap-2 rounded-[10px] border border-[#006C35]/20 bg-[#006C35]/5 px-3 py-2 text-[12px] font-semibold text-[#0F1E33] dark:border-white/10 dark:bg-white/5 dark:text-white/70">
            <CheckCircle2 className="size-4 text-[#006C35]" />
            {license.keyPrefix ? `لديك رخصة نشطة (${license.keyPrefix}…)` : "اشتراكك مفعّل من الإدارة"} — مزايا النسخة الكاملة مفعلة.
          </div>
        )}

        <div className="flex border-b border-line/60 bg-white px-2 dark:border-white/10 dark:bg-[#161c26]" role="tablist">
          {[
            ["features", "المقارنة والمزايا"],
            ["activate", "إدخال كود الرخصة"],
          ].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id as any)} className={cn("border-b-2 px-4 py-3 text-[13px] font-bold transition", activeTab === id ? "border-[#0F1E33] text-[#0F1E33] dark:border-white dark:text-white" : "border-transparent text-[#667085] hover:text-[#0F1E33] dark:text-white/50")}>
              {label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeTab === "features" ? (
            <div className="space-y-5">
              <div className="overflow-hidden rounded-[10px] border border-line/70 dark:border-white/10">
                <div className="grid grid-cols-[1.5fr_1fr_1fr] border-b border-line/60 bg-[#f8faf9] px-4 py-2.5 text-[11px] font-bold text-[#475467] dark:border-white/10 dark:bg-white/[0.03] dark:text-white/50">
                  <span>الميزة</span>
                  <span className="text-center">التجريبية</span>
                  <span className="text-center text-[#0F1E33] dark:text-white">النسخة الكاملة</span>
                </div>
                <div className="divide-y divide-line/50 dark:divide-white/5">
                  {COMPARISON.map((row) => (
                    <div key={row.title} className="grid grid-cols-[1.5fr_1fr_1fr] items-center gap-2 px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <row.icon className="size-4 shrink-0 text-[#0F1E33]/60 dark:text-white/40" />
                        <div>
                          <strong className="block text-[13px] font-bold text-[#0F1E33] dark:text-white">{row.title}</strong>
                          <span className="text-[11px] text-[#667085] dark:text-white/40">{row.hint}</span>
                        </div>
                      </div>
                      <div className="text-center text-[12px] text-[#667085] dark:text-white/40">{row.demo === false ? <Minus className="mx-auto size-4 text-[#d0d5dd]" /> : row.demo}</div>
                      <div className="text-center">
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#006C35]/20 bg-[#006C35]/5 px-2.5 py-1 text-[11px] font-bold text-[#0F1E33] dark:border-white/10 dark:bg-white/5 dark:text-white/70">
                          <Check className="size-3" /> {row.full}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button type="button" onClick={() => setActiveTab("activate")} className="inline-flex h-11 items-center justify-center rounded-[10px] bg-[#0F1E33] px-5 text-[13px] font-bold text-white hover:bg-black dark:bg-white dark:text-[#0F1E33]">تفعيل الرخصة</button>
                <a href={whatsappHref(enterpriseWhatsappText)} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center rounded-[10px] border border-line bg-white px-5 text-[13px] font-bold text-[#0F1E33] hover:bg-[#f8faf9] dark:border-white/10 dark:bg-white/5 dark:text-white">طلب ترخيص مؤسسي عبر الواتساب</a>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-[10px] border border-line/70 p-4 dark:border-white/10 dark:bg-white/[0.02]">
                <label htmlFor="nasaq-license-key" className="mb-2 block text-[13px] font-bold text-[#0F1E33] dark:text-white">إدخال كود الرخصة</label>
                <div className="relative">
                  <input id="nasaq-license-key" type="text" dir="ltr" autoComplete="off" spellCheck={false} value={licenseKey} onChange={(e) => { setLicenseKey(e.target.value); setErrorMessage(null); }} onKeyDown={(e) => { if (e.key === "Enter") void handleActivate(); }} placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-V3" className="h-11 w-full rounded-[10px] border border-line bg-white pe-4 ps-10 font-mono text-[13px] font-semibold tracking-wider text-[#0F1E33] placeholder:text-[#98a2b3] focus:border-[#0F1E33] focus:outline-none dark:border-white/10 dark:bg-[#111722] dark:text-white" />
                  <Key className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#98a2b3]" />
                </div>
                {errorMessage && <p className="mt-3 rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-[#b42318] dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300" role="alert">{errorMessage}</p>}
                {successMessage && <p className="mt-3 flex items-center gap-2 rounded-[8px] border border-[#006C35]/20 bg-[#006C35]/5 px-3 py-2 text-[12px] font-semibold text-[#0F1E33] dark:border-white/10 dark:bg-white/5" role="status"><CheckCircle2 className="size-4 text-[#006C35]" />{successMessage}</p>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button type="button" disabled={isActivating} onClick={() => void handleActivate()} className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-[#0F1E33] px-5 text-[13px] font-bold text-white hover:bg-black disabled:opacity-60 dark:bg-white dark:text-[#0F1E33]">
                  {isActivating ? <Loader2 className="size-4 animate-spin" /> : null}
                  {isActivating ? "جارٍ التحقق" : "تفعيل الرخصة"}
                </button>
                <a href={whatsappHref(enterpriseWhatsappText)} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center rounded-[10px] border border-line bg-white px-5 text-[13px] font-bold text-[#0F1E33] hover:bg-[#f8faf9] dark:border-white/10 dark:bg-white/5 dark:text-white">طلب ترخيص مؤسسي</a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
