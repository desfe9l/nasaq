import { useEffect } from "react";
import { BRAND, CONTACT_PHONE_DISPLAY, telHref, whatsappHref } from "@/lib/brand";
import { useEditor } from "@/lib/editor/store";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";

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

        <section className="mt-8 grid gap-4 rounded-[12px] border border-line bg-white p-6 sm:grid-cols-2 dark:border-white/10 dark:bg-white/5">
          <Fact title="الغرض" body={BRAND.tagline} />
          <Fact title="اللغة" body="الواجهة عربية بترتيب RTL كامل — لا ترجمة سطحية." />
          <Fact title="المقاسات" body="A4 رأسي/أفقي، A3، شرائح 16:9، ومقاسات مخصصة بالمليمتر." />
          <Fact title="التصدير" body="PDF وPNG وJPG وPowerPoint وWord وHTML مع نسخة مشروع JSON." />
          <Fact title="الخصوصية" body="الملفات تُحفظ في متصفح الجهاز ولا تُرفع إلى أي سيرفر." />
          <Fact title="الملاءمة" body="مصمّمة للعمل على الشاشات الكبيرة أولاً، وتعمل على الأجهزة اللوحية." />
        </section>

        <section className="mt-8 rounded-[12px] border border-line bg-white p-6 dark:border-white/10 dark:bg-white/5">
          <h2 className="text-[16px] font-extrabold">التطوير</h2>
          <dl className="mt-3 grid gap-2 text-[14px]">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">الاسم</dt>
              <dd className="font-bold">من تطوير {BRAND.owner}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">English</dt>
              <dd className="font-bold" dir="ltr">
                Developed by {BRAND.developerEn}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-[12px] leading-6 text-muted">
            {BRAND.name} هو اسم المنصة، ولا يُعد اسم المطوّر جزءاً منه. حقوق المنتج والتطوير
            محفوظة لـ {BRAND.owner}.
          </p>
        </section>

        <section className="mt-8 rounded-[12px] border border-line bg-white p-6 dark:border-white/10 dark:bg-white/5">
          <h2 className="text-[16px] font-extrabold">بيانات التواصل</h2>
          <dl className="mt-3 grid gap-2 text-[14px]">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">الاسم</dt>
              <dd className="font-bold">{BRAND.owner}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">رقم الجوال</dt>
              <dd className="font-bold tabular-nums" dir="ltr">
                {CONTACT_PHONE_DISPLAY}
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={telHref()}
              className="inline-flex h-11 items-center rounded-[10px] bg-navy px-4 text-[13px] font-extrabold text-white"
            >
              اتصال
            </a>
            <a
              href={whatsappHref()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-line px-4 text-[13px] font-bold dark:border-white/10"
            >
              واتساب
            </a>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-[16px] font-extrabold">ملاحظة عن البيانات</h2>
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

function Fact({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="text-[12px] font-extrabold text-muted">{title}</h3>
      <p className="mt-1 text-[14px] leading-7">{body}</p>
    </div>
  );
}