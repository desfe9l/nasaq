import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, CalendarDays, Check, Clock3, Copy, MessageCircle, Phone } from "lucide-react";
import { toast } from "sonner";
import { BRAND, CONTACT_PHONE_DISPLAY, CONTACT_PHONE_INTL, telHref, whatsappHref } from "@/lib/brand";
import { useEditor } from "@/lib/editor/store";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";

const SCOPES = ["تقرير رسمي", "عرض تقديمي", "غلاف ومستند", "تصميم إنفوجرافيك", "استفسار آخر"];

export function ContactPage() {
  const hydrate = useEditor((s) => s.hydrate);
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
          QR.toDataURL(whatsappHref(message), { width: 168, margin: 1 }),
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
    <div className="min-h-full bg-paper dark:bg-[#111722]">
      <SiteHeader current="/contact" />

      <main className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
        <p className="text-[12px] font-extrabold tracking-[0.16em] text-green dark:text-gold-2">تواصل تجاري مباشر</p>
        <h1 className="mt-3 text-[30px] font-extrabold">كيف نساعدك في بدء العمل؟</h1>
        <p className="mt-3 text-[15px] leading-8 text-muted">
          تحدث مباشرة مع {BRAND.team} للاستفسار عن الترخيص، تجهيز الهوية، أو تسليم نسخة مناسبة لجهتك.
        </p>

        <div className="mt-8 grid gap-6 border-y border-line py-7 md:grid-cols-[1fr_auto] md:items-center dark:border-white/10">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[13px] font-extrabold text-muted">
              <Phone className="size-4 text-navy-2 dark:text-gold-2" />
              التواصل المباشر
              {/* Live availability badge + copy-to-clipboard on the number row. */}
              <span className="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-extrabold leading-5 text-emerald-700 dark:text-emerald-300">
                <span aria-hidden>🟢</span>
                <span>متاح الآن</span>
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <a href={telHref()} className="block whitespace-nowrap text-[28px] font-extrabold tabular-nums text-ink dark:text-white" dir="ltr">
                {CONTACT_PHONE_DISPLAY}
              </a>
              <button
                type="button"
                onClick={() => void copyNumber()}
                aria-label="نسخ الرقم الدولي"
                className="inline-flex size-9 items-center justify-center rounded-[8px] border border-line text-muted transition hover:border-navy-2 hover:text-navy-2 dark:border-white/10"
                title="نسخ الرقم"
              >
                {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
              </button>
            </div>
            <p className="mt-2 text-[12px] text-muted">رقم دولي للاتصال وواتساب. اختر نوع الطلب أدناه ليُضاف تلقائياً إلى رسالتك.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <a
              href={telHref()}
              className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-navy px-4 text-[13px] font-extrabold text-white"
            >
              <Phone className="size-4" />
              اتصال مباشر
            </a>
            <a
              href={whatsappHref(message)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-green px-4 text-[13px] font-extrabold text-white"
            >
              <MessageCircle className="size-4" />
              مراسلة واتساب
            </a>
            <button
              type="button"
              onClick={() => void copyNumber()}
              className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-line px-4 text-[13px] font-bold dark:border-white/10"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              نسخ الرقم الدولي
            </button>
            <a
              href={whatsappHref(demoBookingMessage)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-emerald-500/50 bg-emerald-500/10 px-4 text-[13px] font-extrabold text-emerald-700 dark:text-emerald-300"
            >
              <CalendarDays className="size-4" />
              حجز موعد عرض توضيحي (15 دقيقة)
            </a>
          </div>
        </div>

        <section className="mt-8 grid gap-6 border-b border-line pb-8 md:grid-cols-[1.1fr_.9fr] dark:border-white/10">
          <div>
          <h2 className="text-[16px] font-extrabold">نوع الطلب</h2>
          <p className="mt-1 text-[12px] text-muted">
            اختر نوع الطلب ليُضاف تلقائياً إلى نص رسالة واتساب — وأضف الجهة والموعد الاختياريين.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {SCOPES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                aria-pressed={scope === s}
                className={
                  scope === s
                    ? "rounded-full border border-navy bg-navy px-3 py-1.5 text-[12px] font-bold text-white"
                    : "rounded-full border border-line px-3 py-1.5 text-[12px] font-bold text-muted dark:border-white/10"
                }
              >
                {s}
              </button>
            ))}
          </div>

          {/* Optional metadata feeding the live message builder. */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[11px] font-extrabold text-muted">
              اسم الجهة (اختياري)
              <input
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
                placeholder="مثال: إدارة الاتصال المؤسسي"
                className="h-10 rounded-[8px] border border-line bg-white px-3 text-[13px] font-semibold dark:border-white/10 dark:bg-white/5"
              />
            </label>
            <label className="grid gap-1 text-[11px] font-extrabold text-muted">
              الموعد النهائي (اختياري)
              <input
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                placeholder="مثال: 15 أكتوبر 2026"
                className="h-10 rounded-[8px] border border-line bg-white px-3 text-[13px] font-semibold dark:border-white/10 dark:bg-white/5"
              />
            </label>
          </div>

          <p className="mt-4 whitespace-pre-line rounded-[8px] border border-line bg-line-2/60 p-3 text-[13px] leading-7 dark:border-white/10 dark:bg-white/5">
            {message}
          </p>
          <a
            href={whatsappHref(message)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-[8px] bg-green px-4 text-[12px] font-extrabold text-white"
          >
            <MessageCircle className="size-3.5" />
            إرسال هذه الرسالة على واتساب
          </a>
          </div>
          <aside className="border-r-2 border-gold pr-4">
            <BadgeCheck className="size-5 text-navy-2 dark:text-gold-2" />
            <h2 className="mt-3 text-[15px] font-extrabold">طلب ترخيص أو تسليم</h2>
            <p className="mt-2 text-[12px] leading-6 text-muted">لشراء نسخة كاملة، نحدد نوع الترخيص أولاً، ثم نرسل تفاصيل الدفع ونجهز التسليم وخطوات بدء الاستخدام.</p>
            <a href="/purchase" className="mt-4 inline-flex text-[12px] font-extrabold text-navy-2 underline underline-offset-4 dark:text-gold-2">عرض النسخ والتراخيص</a>

            {/* Desktop QR: scan to continue this exact message on mobile. */}
            <div ref={qrBoxRef} className="mt-6 hidden md:block">
              <div className="inline-flex flex-col items-center gap-2 rounded-[10px] border border-line bg-white p-3 dark:border-white/10 dark:bg-white/5">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="رمز QR لمتابعة المحادثة عبر واتساب" className="size-[168px]" />
                ) : (
                  <div className="grid size-[168px] place-items-center rounded bg-line-2 text-center text-[11px] text-muted">
                    جارٍ تجهيز الرمز…
                  </div>
                )}
                <span className="text-[11px] font-bold text-muted">
                  امسح الرمز لمتابعة المحادثة من هاتفك
                </span>
              </div>
            </div>
          </aside>
        </section>

        <section className="mt-8 flex items-start gap-3">
          <Clock3 className="mt-0.5 size-5 shrink-0 text-navy-2 dark:text-gold-2" />
          <div><h2 className="text-[16px] font-extrabold">أوقات الرد</h2>
          <p className="mt-2 text-[14px] leading-7 text-muted">
            عادةً يتم الرد خلال أوقات العمل الرسمية. إن لم يكن الرقم متاحاً، أرسل رسالة واتساب وسيتم
            التواصل في أقرب وقت.
          </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
