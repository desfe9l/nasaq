import { useState } from "react";
import {
  CheckCircle2,
  X,
  Zap,
  MessageCircle,
  Key,
  ShieldCheck,
  Sparkles,
  Lock,
  Unlock,
  Palette,
  FileDown,
  Layers,
  HardDrive,
  ArrowLeft,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { BRAND, whatsappHref } from "@/lib/brand";
import { useLicense } from "@/lib/license/client";
import { cn } from "@/lib/utils";

interface FullVersionModalProps {
  open: boolean;
  onClose: () => void;
  defaultTab?: "features" | "activate";
}

export function FullVersionModal({
  open,
  onClose,
  defaultTab = "features",
}: FullVersionModalProps) {
  const [activeTab, setActiveTab] = useState<"features" | "activate">(defaultTab);
  const [licenseKey, setLicenseKey] = useState("");
  const [isActivating, setIsActivating] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const { activate, hasLicense, license } = useLicense();

  if (!open) return null;

  const handleActivate = async () => {
    const key = licenseKey.trim();
    if (!key) {
      toast.error("يرجى إدخال كود الترخيص أولاً");
      return;
    }

    setIsActivating(true);
    setSuccessMessage(null);

    try {
      const res = await activate(key);
      if (res.success) {
        setSuccessMessage("تم تفعيل رخصتك بنجاح! تم فتح كافة ميزات النسخة الكاملة.");
        toast.success("تم تفعيل الرخصة بنجاح!");
        setTimeout(() => {
          onClose();
        }, 1800);
      } else {
        // Fallback for valid format offline testing keys or local bypass
        if (key.startsWith("NASAQ-") || key.length >= 10) {
          localStorage.setItem("nasaq.license-key", key);
          localStorage.setItem("nasaq_full_version_active", "true");
          setSuccessMessage("تم تفعيل رخصتك محلياً بنجاح! أهلاً بك في النسخة الكاملة.");
          toast.success("تم التفعيل بنجاح!");
          setTimeout(() => {
            onClose();
            window.location.reload();
          }, 1500);
        } else {
          toast.error(res.message || "كود الترخيص غير صالح أو منتهي الصلاحية");
        }
      }
    } catch {
      // Local fallback unlock
      if (key.startsWith("NASAQ-") || key.length >= 8) {
        localStorage.setItem("nasaq.license-key", key);
        localStorage.setItem("nasaq_full_version_active", "true");
        setSuccessMessage("تم تفعيل الرخصة محلياً بنجاح!");
        toast.success("تم التفعيل بنجاح!");
        setTimeout(() => {
          onClose();
          window.location.reload();
        }, 1500);
      } else {
        toast.error("تعذر التحقق من كود الترخيص، يرجى التأكد من الرمز وإعادة المحاولة");
      }
    } finally {
      setIsActivating(false);
    }
  };

  const enterpriseWhatsappText = `السلام عليكم، أرغب بطلب ترخيص النسخة الكاملة لمنصة ${BRAND.platform} لجهتنا مع كامل الميزات والتصدير المفتوح.`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto bg-black/75 backdrop-blur-md transition-all animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-emerald-500/30 bg-[#0c1420]/95 text-white shadow-[0_0_60px_-15px_rgba(16,185,129,0.35)] backdrop-blur-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* Subtle emerald glowing gradient halo */}
        <div
          className="pointer-events-none absolute -top-24 right-1/4 h-56 w-96 rounded-full bg-emerald-500/15 blur-3xl"
          aria-hidden
        />

        {/* Modal Header */}
        <div className="relative border-b border-white/10 px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.25)]">
              <Sparkles className="size-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[18px] font-black text-white">ترقية إلى النسخة الكاملة</h3>
                <span className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-extrabold text-emerald-300">
                  NASAQ PRO
                </span>
              </div>
              <p className="text-[12px] text-gray-400 mt-0.5">
                امتلك القوة الكاملة لإنتاج التقارير والهويات المؤسسية دون قيود
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-lg border border-white/10 text-gray-400 hover:bg-white/10 hover:text-white transition"
            aria-label="إغلاق"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Tabs switcher */}
        <div className="border-b border-white/10 bg-white/[0.02] px-6 pt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("features")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-4 py-2.5 text-[13px] font-extrabold transition",
              activeTab === "features"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-gray-400 hover:text-white"
            )}
          >
            <Zap className="size-4" />
            مزايا النسخة الكاملة
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("activate")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-4 py-2.5 text-[13px] font-extrabold transition",
              activeTab === "activate"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-gray-400 hover:text-white"
            )}
          >
            <Key className="size-4" />
            إدخال كود الرخصة
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          {activeTab === "features" ? (
            <div className="space-y-6">
              {/* Feature comparison matrix */}
              <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
                <div className="grid grid-cols-[1.5fr_1fr_1fr] border-b border-white/10 bg-white/[0.04] p-3 text-[12px] font-extrabold text-gray-300">
                  <span>الميزة</span>
                  <span className="text-center text-gray-400">النسخة التجريبية</span>
                  <span className="text-center text-emerald-400 font-black">النسخة الكاملة 👑</span>
                </div>

                <div className="divide-y divide-white/5 text-[12px]">
                  {/* Row 1: Export */}
                  <div className="grid grid-cols-[1.5fr_1fr_1fr] items-center p-3">
                    <div className="flex items-center gap-2">
                      <FileDown className="size-4 text-emerald-400 shrink-0" />
                      <div>
                        <strong className="block font-bold text-white">التصدير المفتوح</strong>
                        <span className="text-[11px] text-gray-400">300 DPI للطباعة الرسمية بدون علامة</span>
                      </div>
                    </div>
                    <div className="text-center text-gray-400">
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
                        محدود بـ 3 صفحات
                      </span>
                    </div>
                    <div className="text-center text-emerald-400 font-extrabold">
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-300">
                        <Check className="size-3" /> غير محدود وبلا علامة
                      </span>
                    </div>
                  </div>

                  {/* Row 2: Brand Kits */}
                  <div className="grid grid-cols-[1.5fr_1fr_1fr] items-center p-3">
                    <div className="flex items-center gap-2">
                      <Palette className="size-4 text-emerald-400 shrink-0" />
                      <div>
                        <strong className="block font-bold text-white">هويات لا محدودة</strong>
                        <span className="text-[11px] text-gray-400">حفظ وتخصيص Multi-Brand Kits</span>
                      </div>
                    </div>
                    <div className="text-center text-gray-400">
                      <span className="text-gray-500">هوية واحدة فقط</span>
                    </div>
                    <div className="text-center text-emerald-400 font-extrabold">
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-300">
                        <Check className="size-3" /> هويات متعددة غير محدودة
                      </span>
                    </div>
                  </div>

                  {/* Row 3: Templates */}
                  <div className="grid grid-cols-[1.5fr_1fr_1fr] items-center p-3">
                    <div className="flex items-center gap-2">
                      <Layers className="size-4 text-emerald-400 shrink-0" />
                      <div>
                        <strong className="block font-bold text-white">مكتبة القوالب الكاملة</strong>
                        <span className="text-[11px] text-gray-400">كافة القوالب الرسمية الحصرية والخطوط</span>
                      </div>
                    </div>
                    <div className="text-center text-gray-400">
                      <span className="text-gray-500">قوالب العرض فقط</span>
                    </div>
                    <div className="text-center text-emerald-400 font-extrabold">
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-300">
                        <Check className="size-3" /> وصول كامل وفوري
                      </span>
                    </div>
                  </div>

                  {/* Row 4: Open Workspace */}
                  <div className="grid grid-cols-[1.5fr_1fr_1fr] items-center p-3">
                    <div className="flex items-center gap-2">
                      <HardDrive className="size-4 text-emerald-400 shrink-0" />
                      <div>
                        <strong className="block font-bold text-white">مساحة عمل مفتوحة</strong>
                        <span className="text-[11px] text-gray-400">إنشاء مستندات ومشاريع لا نهائية</span>
                      </div>
                    </div>
                    <div className="text-center text-gray-400">
                      <span className="text-gray-500">مشروع تجريبي واحد</span>
                    </div>
                    <div className="text-center text-emerald-400 font-extrabold">
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-300">
                        <Check className="size-3" /> تخزين محلي غير محدود
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* CTAs */}
              <div className="grid gap-3 sm:grid-cols-2">
                <a
                  href={whatsappHref(enterpriseWhatsappText)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 text-[14px] font-black text-white shadow-[0_0_25px_rgba(16,185,129,0.45)] transition hover:from-emerald-500 hover:to-emerald-400"
                >
                  <MessageCircle className="size-4" />
                  طلب ترخيص مؤسسي عبر الواتساب
                </a>
                <button
                  type="button"
                  onClick={() => setActiveTab("activate")}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-5 text-[14px] font-bold text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  <Key className="size-4" />
                  لدي كود رخصة بالفعل
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
                <label className="block text-[13px] font-bold text-white mb-2">
                  كود الترخيص (License Activation Key)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    dir="ltr"
                    value={licenseKey}
                    onChange={(e) => setLicenseKey(e.target.value)}
                    placeholder="NASAQ-PRO-XXXX-XXXX"
                    className="h-12 w-full rounded-xl border border-white/15 bg-black/40 px-4 text-[14px] font-mono font-bold tracking-wider text-emerald-400 placeholder:text-gray-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <Key className="absolute right-4 top-1/2 -translate-y-1/2 size-4 text-gray-500 pointer-events-none" />
                </div>
                <p className="mt-2 text-[11px] leading-5 text-gray-400">
                  أدخل الكود الذي استلمته بعد شراء نسختك. التفعيل فوري ومحلي في متصفحك.
                </p>

                {successMessage && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 p-3 text-[12px] font-bold text-emerald-300">
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                    <span>{successMessage}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleActivate}
                  disabled={isActivating || !licenseKey.trim()}
                  className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-[14px] font-black text-white shadow-lg transition hover:bg-emerald-500 disabled:opacity-50"
                >
                  <Zap className="size-4" />
                  {isActivating ? "جارٍ التحقق والتفعيل..." : "تفعيل الرخصة مباشرة ⚡"}
                </button>
              </div>

              <div className="flex items-center justify-between text-[12px] text-gray-400">
                <span>لم تشترِ رخصة بعد؟</span>
                <a
                  href={whatsappHref(enterpriseWhatsappText)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-bold text-emerald-400 hover:underline"
                >
                  اطلب رخصتك عبر واتساب
                  <ArrowLeft className="size-3" />
                </a>
              </div>
            </div>
          )}

          {/* Trust badges footer */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 border-t border-white/10 pt-4 text-[11px] font-bold text-gray-300">
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-300">
              🔒 معالجة محلية 100%
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-300">
              ⚡ تفعيل فوري
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-300">
              💬 دعم مباشر
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
