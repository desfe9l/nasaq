import { useEffect } from "react";
import { BadgeCheck, MessageCircle, Phone } from "lucide-react";
import { BRAND, CONTACT_PHONE_DISPLAY, telHref, whatsappHref } from "@/lib/brand";
import { useEditor } from "@/lib/editor/store";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";

/** Export formats as self-describing pill badges — never a run-on sentence. */
const FORMAT_PILLS = [
  "📄 PDF",
  "🖼️ PNG",
  "🖼️ JPG",
  "📊 PowerPoint",
  "📝 Word",
  "🌐 HTML",
  "💾 JSON",
] as const;

/** 3×2 grid of platform guarantees. */
const SPECS: { title: string; body: string }[] = [
  { title: "عربي RTL كامل", body: "الواجهة والتحرير والمحاذاة بترتيب من اليمين لليسار — لا ترجمة سطحية." },
  { title: "مقاسات قياسية", body: "A4 رأسي/أفقي، A3، وشرائح 16:9 مع مقاسات مخصصة بالمليمتر." },
  { title: "جودة طباعة 300 DPI", body: "مخرجات PDF وصور بدقة طباعة رسمية صالحة للتسليم." },
  { title: "معالجة محلية 100%", body: "ملفاتك تُحفظ في متصفح الجهاز ولا تُرفع إلى أي سيرفر." },
  { title: "تصميم متجاوب", body: "يعمل على الشاشات الكبيرة أولًا، ويدعم الأجهزة اللوحية والمس." },
  { title: "تصدير متعدد الصيغ", body: "سبع صيغ تصدير (تظهر كشارات بالأعلى) مع معاينة قبل الإخراج." },
];

export function AboutPage() {
  const hydrate = useEditor((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <div className="min-h-full bg-paper dark:bg-[#111722]">
      <SiteHeader current="/about" />

      <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-[26px] font-extrabold">عن {BRAND.lockup}</h1>
        <p className="mt-3 text-[14px] font-bold text-navy-2 dark:text-gold-2">
          {BRAND.platformEn}
        </p>
        <p className="mt-4 text-[15px] leading-8 text-muted">
          {BRAND.name} منصة {BRAND.platform} — طوّرها {BRAND.owner} لتصميم وإخراج التقارير
          والمستندات والتصاميم الرسمية. الفكرة بسيطة: بدلاً من إعادة بناء التقرير في كل مرة، تبدأ
          من صفحة أو قالب جاهز، تعدّل النصوص والأرقام والجداول والصور، ثم تصدّر الملف بجودة طباعة
          مناسبة للتسليم الرسمي.
        </p>

        {/* Export formats as pills — each format stands alone, clearly labelled. */}
        <section className="mt-6">
          <h2 className="text-[13px] font-extrabold text-muted">صيغ التصدير المتاحة</h2>
          <div className="mt-2 flex flex-wrap gap-2" dir="ltr">
            {FORMAT_PILLS.map((pill) => (
              <span
                key={pill}
                className="inline-flex items-center rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-bold shadow-sm dark:border-white/10 dark:bg-white/5"
              >
                {pill}
              </span>
            ))}
          </div>
        </section>

        {/* 3×2 specifications grid. */}
        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SPECS.map((spec) => (
            <div
              key={spec.title}
              className="shadow-card dark:shadow-card-dark rounded-xl border border-line bg-white p-4 dark:border-white/10 dark:bg-white/5"
            >
              <h3 className="text-[13px] font-extrabold text-navy-2 dark:text-gold-2">
                {spec.title}
              </h3>
              <p className="mt-1.5 text-[13px] leading-6 text-muted">{spec.body}</p>
            </div>
          ))}
        </section>

        {/* Verified developer card with direct tel: and WhatsApp actions. */}
        <section className="shadow-card dark:shadow-card-dark mt-8 rounded-xl border border-line bg-white p-6 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-start gap-4">
            <img src="/nasaq-mark.svg" alt="" aria-hidden className="size-14 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[16px] font-extrabold">{BRAND.owner}</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300">
                  <BadgeCheck className="size-3.5" /> مطوّر موثّق للمنصة
                </span>
              </div>
              <p className="mt-1 text-[13px] text-muted">
                المصمم والمطور — <span dir="ltr" className="font-bold">{BRAND.developerEn}</span>
              </p>
              <dl className="mt-3 grid gap-1.5 text-[13px]">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">الجوال</dt>
                  <dd className="font-bold tabular-nums" dir="ltr">{CONTACT_PHONE_DISPLAY}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">الدور</dt>
                  <dd className="font-bold">تصميم وتطوير {BRAND.platform}</dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={telHref()}
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-navy px-4 text-[13px] font-extrabold text-white"
                >
                  <Phone className="size-4" />
                  اتصال مباشر
                </a>
                <a
                  href={whatsappHref()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-green px-4 text-[13px] font-extrabold text-white"
                >
                  <MessageCircle className="size-4" />
                  واتساب
                </a>
              </div>
            </div>
          </div>
          <p className="mt-4 border-t border-line pt-3 text-[12px] leading-6 text-muted dark:border-white/10">
            {BRAND.name} هو اسم المنصة، ولا يُعد اسم المطوّر جزءاً منه. حقوق المنتج والتطوير
            محفوظة لـ {BRAND.owner}.
          </p>
        </section>

        {/* Amber warning banner for the demo-data disclaimer. */}
        <section className="mt-8 rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
          <h2 className="text-[15px] font-extrabold text-amber-700 dark:text-amber-400">
            ⚠️ ملاحظة عن البيانات التجريبية
          </h2>
          <p className="mt-2 text-[14px] leading-7 text-muted">
            القوالب المرفقة تحتوي على بيانات تجريبية موسومة بوضوح (Demo) للعرض فقط. لا تتضمن المنصة أي
            شعارات رسمية أو صور أشخاص أو بيانات جهات حقيقية؛ تُستبدل جميعها بمحتوى العميل قبل التسليم.
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
