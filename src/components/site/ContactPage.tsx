import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  Clock3,
  Copy,
  Headphones,
  LayoutTemplate,
  MessageCircle,
  Phone,
  QrCode,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { BRAND, CONTACT_PHONE_INTL, WHATSAPP_MESSAGES, telHref, whatsappHref } from "@/lib/brand";
import { useEditor } from "@/lib/editor/store";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { SocialLinks } from "@/components/site/SocialLinks";
import { ClientRequestForm } from "./ClientRequestPanel";
import { cn } from "@/lib/utils";
import type { RequestKind } from "@/lib/requests/types";

const SCOPES = ["تقرير رسمي", "عرض تقديمي", "غلاف ومستند", "تصميم إنفوجرافيك", "قالب مخصص", "استفسار عام"];

type ActiveHubTab = "whatsapp" | "template" | "support";

export function ContactPage() {
  const hydrate = useEditor((s) => s.hydrate);
  const [activeTab, setActiveTab] = useState<ActiveHubTab>("whatsapp");
  const [scope, setScope] = useState(SCOPES[0]);
  const [entity, setEntity] = useState("");
  const [deadline, setDeadline] = useState("");
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const qrBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  /** Live WhatsApp message: request chip + optional entity + optional deadline. */
  const message = useMemo(() => {
    let text = `السلام عليكم ${BRAND.team}، أرغب بالاستفسار عن: ${scope} عبر ${BRAND.nameAr}.`;
    if (entity.trim()) text += `\nالجهة: ${entity.trim()}`;
    if (deadline.trim()) text += `\nالموعد النهائي: ${deadline.trim()}`;
    return text;
  }, [scope, entity, deadline]);

  const demoBookingMessage = `السلام عليكم ${BRAND.team}، أرغب بحجز موعد لعرض توضيحي لمدة 15 دقيقة لمنصة ${BRAND.nameAr}.`;

  // Desktop QR → continue the same WhatsApp thread on the phone.
  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      import("qrcode")
        .then(({ default: QR }) =>
          QR.toDataURL(whatsappHref(message), { width: 160, margin: 1 }),
        )
        .then((url) => {
          if (!cancelled) setQrDataUrl(url);
        })
        .catch(() => {
          if (!cancelled) setQrDataUrl(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [message]);

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_PHONE_INTL);
      setCopied(true);
      toast.success("تم نسخ الرقم بالصيغة الدولية");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("تعذر النسخ — يمكنك تحديد الرقم يدوياً");
    }
  };

  return (
    <div className="min-h-screen bg-page">
      <SiteHeader current="/contact" />

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 pb-24 md:pb-12">
        {/* Masthead */}
        <header className="overflow-hidden rounded-2xl border border-line bg-surface p-6 sm:p-8 mb-8 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-extrabold tracking-[0.16em] text-brand">
                  {BRAND.platformEn} · SUPPORT & ENTERPRISE HUB
                </p>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-surface-2 px-2.5 py-0.5 text-[10px] font-bold text-success">
                  <span className="size-1.5 rounded-full bg-success" />
                  متاح الآن
                </span>
              </div>
              <h1 className="mt-1 text-2xl sm:text-3xl font-black text-ink">
                مركز التواصل والدعم المؤسسي
              </h1>
              <p className="mt-1.5 max-w-2xl text-xs sm:text-sm font-semibold leading-6 text-muted">
                تواصل مباشر وسريع مع فريق نَسَق للاستفسارات الفورية، طلب تصميم قوالب حصرية لجهتك،
                أو الحصول على الدعم التقني لمشاريعك.
              </p>
            </div>

            {/* Quick Action Pills */}
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={telHref()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-bold text-ink transition hover:border-brand hover:text-brand"
              >
                <Phone className="size-3.5" />
                <span>اتصال مباشر</span>
              </a>
              <button
                type="button"
                onClick={() => void copyNumber()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-bold text-ink transition hover:border-brand hover:text-brand"
                title="نسخ الرقم الدولي"
              >
                {copied ? <Check className="size-3.5 text-brand" /> : <Copy className="size-3.5" />}
                <span dir="ltr">{CONTACT_PHONE_INTL}</span>
              </button>
              <a
                href={whatsappHref(demoBookingMessage)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-navy px-3.5 text-xs font-extrabold text-on-brand shadow-sm transition hover:bg-navy-2 active:scale-[0.98]"
              >
                <CalendarDays className="size-3.5" />
                <span>حجز موعد عرض توضيحي (15 دقيقة)</span>
              </a>
            </div>
          </div>
        </header>

        {/* ── 3 Interactive Core Cards ── */}
        <section aria-labelledby="channels-heading" className="mb-8">
          <h2 id="channels-heading" className="sr-only">قنوات التواصل والدعم</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Card 1: WhatsApp Direct */}
            <article
              role="button"
              tabIndex={0}
              onClick={() => setActiveTab("whatsapp")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setActiveTab("whatsapp");
              }}
              className={cn(
                "group relative flex cursor-pointer flex-col justify-between rounded-2xl border p-5 transition shadow-sm",
                activeTab === "whatsapp"
                  ? "border-brand bg-surface ring-2 ring-brand/20 shadow-card"
                  : "border-line bg-surface hover:border-brand/60 hover:bg-surface-2",
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="grid size-11 place-items-center rounded-xl bg-navy text-on-brand">
                    <MessageCircle className="size-5" />
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-muted">
                    <span className="size-1.5 rounded-full bg-success" />
                    متوسط الرد: أقل من 15 دقيقة
                  </span>
                </div>
                <h3 className="mt-4 text-base font-black text-ink group-hover:text-brand">
                  تواصل مباشر عبر واتساب
                </h3>
                <p className="mt-1.5 text-xs font-semibold leading-5 text-muted">
                  محادثة فورية وسريعة مع مسؤولي المنصة للاستفسارات العامة، الشراء، أو الدعم الفوري.
                </p>
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-line pt-3 text-xs font-black text-brand">
                <span>{activeTab === "whatsapp" ? "القناة المحددة حاليًا" : "اختيار المراسلة الفورية"}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px]", activeTab === "whatsapp" ? "bg-navy text-on-brand" : "bg-surface-2 text-muted")}>
                  {activeTab === "whatsapp" ? "نشط" : "عرض"}
                </span>
              </div>
            </article>

            {/* Card 2: Custom Enterprise Template */}
            <article
              role="button"
              tabIndex={0}
              onClick={() => setActiveTab("template")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setActiveTab("template");
              }}
              className={cn(
                "group relative flex cursor-pointer flex-col justify-between rounded-2xl border p-5 transition shadow-sm",
                activeTab === "template"
                  ? "border-brand bg-surface ring-2 ring-brand/20 shadow-card"
                  : "border-line bg-surface hover:border-brand/60 hover:bg-surface-2",
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="grid size-11 place-items-center rounded-xl bg-brand/10 text-brand">
                    <LayoutTemplate className="size-5" />
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-muted">
                    <Sparkles className="size-3 text-brand" />
                    تصميم حصري ومعتمد
                  </span>
                </div>
                <h3 className="mt-4 text-base font-black text-ink group-hover:text-brand">
                  طلب قالب مؤسسي مخصص
                </h3>
                <p className="mt-1.5 text-xs font-semibold leading-5 text-muted">
                  برمجة وتصميم قوالب تقارير وخطابات تتطابق 100% مع الهوية البصرية الرسمية لجهتك.
                </p>
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-line pt-3 text-xs font-black text-brand">
                <span>{activeTab === "template" ? "القناة المحددة حاليًا" : "بدء طلب القالب"}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px]", activeTab === "template" ? "bg-navy text-on-brand" : "bg-surface-2 text-muted")}>
                  {activeTab === "template" ? "نشط" : "عرض"}
                </span>
              </div>
            </article>

            {/* Card 3: Technical Support */}
            <article
              role="button"
              tabIndex={0}
              onClick={() => setActiveTab("support")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setActiveTab("support");
              }}
              className={cn(
                "group relative flex cursor-pointer flex-col justify-between rounded-2xl border p-5 transition shadow-sm",
                activeTab === "support"
                  ? "border-brand bg-surface ring-2 ring-brand/20 shadow-card"
                  : "border-line bg-surface hover:border-brand/60 hover:bg-surface-2",
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="grid size-11 place-items-center rounded-xl bg-navy text-on-brand">
                    <Headphones className="size-5" />
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-muted">
                    <BadgeCheck className="size-3 text-brand" />
                    متابعة تذكرة رسمية
                  </span>
                </div>
                <h3 className="mt-4 text-base font-black text-ink group-hover:text-brand">
                  الإبلاغ عن مشكلة أو دعم فني
                </h3>
                <p className="mt-1.5 text-xs font-semibold leading-5 text-muted">
                  مساعدة متخصصة في مشاكل الاستيراد، محاذاة الخطوط، معالجة الطبقات، وحفظ الملفات.
                </p>
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-line pt-3 text-xs font-black text-brand">
                <span>{activeTab === "support" ? "القناة المحددة حاليًا" : "فتح تذكرة دعم"}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px]", activeTab === "support" ? "bg-navy text-on-brand" : "bg-surface-2 text-muted")}>
                  {activeTab === "support" ? "نشط" : "عرض"}
                </span>
              </div>
            </article>
          </div>
        </section>

        {/* ── Active Hub Content Section ── */}
        <section aria-labelledby="hub-content-heading" className="rounded-3xl border border-line bg-surface p-6 sm:p-8 shadow-card">
          <h2 id="hub-content-heading" className="sr-only">تفاصيل القناة المحددة</h2>

          {/* TAB 1: WhatsApp Interactive Builder */}
          {activeTab === "whatsapp" && (
            <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="grid size-9 place-items-center rounded-lg bg-navy text-on-brand">
                    <MessageCircle className="size-4" />
                  </span>
                  <div>
                    <h3 className="text-base font-black text-ink">مُنشئ رسالة واتساب المباشرة</h3>
                    <p className="text-xs font-semibold text-muted">
                      اختر موضوع الاستفسار ليتم تجهيز نص الرسالة تلقائيًا قبل الانتقال لواتساب
                    </p>
                  </div>
                </div>

                {/* Scope chips */}
                <div className="mt-5">
                  <label className="text-xs font-black text-ink">نوع الاستفسار أو الطلب</label>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {SCOPES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setScope(s)}
                        aria-pressed={scope === s}
                        className={cn(
                          "rounded-xl border px-3.5 py-2 text-xs font-bold transition active:scale-[0.98]",
                          scope === s
                            ? "border-brand bg-navy text-on-brand shadow-sm font-black"
                            : "border-line bg-surface-2 text-muted hover:text-ink hover:border-brand/40",
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Optional Entity & Deadline */}
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <label htmlFor="wa-entity" className="text-xs font-bold text-muted">
                      اسم الجهة أو المؤسسة (اختياري)
                    </label>
                    <input
                      id="wa-entity"
                      value={entity}
                      onChange={(e) => setEntity(e.target.value)}
                      placeholder="مثال: وزارة / هيئة / شركة..."
                      className="h-10 rounded-xl border border-line bg-page px-3 text-xs font-bold text-ink outline-none transition focus:border-brand focus:ring-1 focus:ring-brand"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <label htmlFor="wa-deadline" className="text-xs font-bold text-muted">
                      الموعد النهائي للتسليم (اختياري)
                    </label>
                    <input
                      id="wa-deadline"
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                      placeholder="مثال: نهاية الشهر الحالي"
                      className="h-10 rounded-xl border border-line bg-page px-3 text-xs font-bold text-ink outline-none transition focus:border-brand focus:ring-1 focus:ring-brand"
                    />
                  </div>
                </div>

                {/* Generated Message Preview */}
                <div className="mt-5">
                  <p className="text-xs font-bold text-muted mb-1.5">نص الرسالة التلقائي:</p>
                  <div className="rounded-xl border border-line bg-surface-2 p-3.5 text-xs font-semibold leading-6 text-ink whitespace-pre-line">
                    {message}
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <a
                    href={whatsappHref(message)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-navy px-6 text-xs font-black text-on-brand shadow-sm transition hover:bg-navy-2 active:scale-[0.98]"
                  >
                    <MessageCircle className="size-4" />
                    <span>إرسال المحادثة على واتساب الآن</span>
                  </a>
                  <a
                    href={whatsappHref(WHATSAPP_MESSAGES.support)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-xs font-bold text-muted hover:text-ink hover:bg-surface-2 transition"
                  >
                    فتح محادثة عامة
                  </a>
                </div>
              </div>

              {/* QR Code Sidebar for Mobile Handoff */}
              <aside className="rounded-2xl border border-line bg-surface-2/60 p-5 flex flex-col items-center justify-center text-center">
                <div className="flex items-center gap-2 text-xs font-black text-ink mb-3">
                  <QrCode className="size-4 text-brand" />
                  <span>المتابعة من هاتفك المحمول</span>
                </div>
                <div ref={qrBoxRef} className="rounded-2xl border border-line bg-surface p-3.5 shadow-sm">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="رمز QR للمحادثة الفورية عبر واتساب"
                      className="size-40 rounded-lg"
                    />
                  ) : (
                    <div className="grid size-40 place-items-center rounded-lg bg-surface-2 text-xs text-muted">
                      جارٍ توليد الرمز...
                    </div>
                  )}
                </div>
                <p className="mt-3 text-[11px] font-semibold text-muted max-w-[200px]">
                  امسح الرمز بكاميرا الجوال لمتابعة المحادثة مباشرة دون الحاجة لنسخ أي أرقام.
                </p>

                <div className="mt-5 w-full border-t border-line pt-4 text-right">
                  <div className="flex items-center gap-2 text-xs font-bold text-ink">
                    <Clock3 className="size-3.5 text-brand" />
                    <span>ساعات العمل المباشرة:</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted leading-5">
                    الرد فوري طوال ساعات العمل الرسمية. الرسائل الواردة خارج أوقات العمل تُجاب في بداية يوم العمل التالي.
                  </p>
                </div>
              </aside>
            </div>
          )}

          {/* TAB 2: Custom Template Request */}
          {activeTab === "template" && (
            <div>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand">
                    <LayoutTemplate className="size-5" />
                  </span>
                  <div>
                    <h3 className="text-base font-black text-ink">طلب قالب مؤسسي مخصص</h3>
                    <p className="text-xs font-semibold text-muted">
                      سيقوم فريق المصممين في نَسَق ببناء القالب وربطه بحساب مؤسستك خلال ٤٨ ساعة عمل.
                    </p>
                  </div>
                </div>
                <span className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-bold text-muted">
                  مباشر داخل المنصة
                </span>
              </div>
              <ClientRequestForm source="contact" defaultKind="template" />
            </div>
          )}

          {/* TAB 3: Technical Support Request */}
          {activeTab === "support" && (
            <div>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-navy text-on-brand">
                    <Headphones className="size-5" />
                  </span>
                  <div>
                    <h3 className="text-base font-black text-ink">تذكرة دعم فني واستفسارات استخدام</h3>
                    <p className="text-xs font-semibold text-muted">
                      فريق الدعم الفني الهندسي يتابع التذاكر مباشرة ويقدم الحلول التقنية المباشرة.
                    </p>
                  </div>
                </div>
                <span className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-bold text-muted">
                  أولوية الدعم الفني
                </span>
              </div>
              <ClientRequestForm source="contact" defaultKind="support" />
            </div>
          )}
        </section>

        {/* ── Official Social Links & Footer Section ── */}
        <section aria-labelledby="social-heading" className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 id="social-heading" className="text-sm font-black text-ink">
                الحسابات الرسمية لمنصة نَسَق
              </h3>
              <p className="mt-0.5 text-xs font-semibold text-muted">
                تابع التحديثات المؤسسية والإصدارات الجديدة عبر قنواتنا المعتمدة.
              </p>
            </div>
            <SocialLinks variant="full" />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
