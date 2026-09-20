import { useEffect, useState } from "react";
import { CheckCircle2, FilePenLine, FolderKanban, LayoutTemplate, LockKeyhole, Palette, RotateCcw, Save, ShieldCheck, Type } from "lucide-react";
import { BrandLogo, SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { DEFAULT_BRAND_KIT, type BrandKit } from "@/lib/product/product";
import { readBrandKit, resetBrandKit, saveBrandKit } from "@/lib/product/brand-kit";
import { BRAND } from "@/lib/brand";

export function BrandKitPage() {
  const [kit, setKit] = useState<BrandKit>(DEFAULT_BRAND_KIT);
  const [saved, setSaved] = useState(false);

  useEffect(() => setKit(readBrandKit()), []);
  const update = <K extends keyof BrandKit>(key: K, value: BrandKit[K]) => setKit((current) => ({ ...current, [key]: value }));
  const save = () => { saveBrandKit(kit); setSaved(true); window.setTimeout(() => setSaved(false), 1800); };

  return (
    <div className="min-h-full bg-paper dark:bg-[#111722]">
      <SiteHeader current="/brand-kit" />
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <section className="border-b border-line pb-10 dark:border-white/10"><div className="flex items-center gap-4"><span className="scale-125 origin-right"><BrandLogo /></span><div><p className="text-[11px] font-bold tracking-[0.18em] text-green">هوية المنتج</p><p className="mt-3 max-w-2xl text-[14px] leading-7 text-muted">منصة عربية تساعدك على إنشاء التقارير والمستندات والعروض وتنظيمها في مساحة عمل واحدة.</p></div></div></section>

        <section className="grid gap-6 border-b border-line py-10 lg:grid-cols-[1.15fr_.85fr] dark:border-white/10"><div><h2 className="text-[20px] font-extrabold">صُممت وطُوّرت بعناية</h2><p className="mt-3 text-[14px] leading-7 text-muted">{BRAND.owner} هو المصمم والمطور خلف {BRAND.name}. يركز العمل على أدوات عملية وواضحة تساعد الفرق والأفراد على تجهيز مخرجاتهم الرسمية بطريقة منظمة.</p></div><div className="flex items-center gap-4 border-r-2 border-gold pr-4"><img src="/nasaq-mark.svg" alt="" aria-hidden className="size-12" /><div><strong className="block text-[16px] font-extrabold">فيصل المضياني</strong><span className="mt-1 block text-[12px] text-muted">المصمم والمطور</span></div></div></section>

        <section className="py-10"><h2 className="text-[20px] font-extrabold">ماذا تقدم {BRAND.name}؟</h2><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Service icon={FilePenLine} title="تحرير التصاميم والمستندات" body="نصوص وصور وأشكال وجداول وعناصر قابلة للتحريك والتعديل." /><Service icon={LayoutTemplate} title="قوالب وصفحات جاهزة" body="ابدأ بتكوين منظم ثم عدّل المحتوى والهوية بما يناسب عملك." /><Service icon={FolderKanban} title="إدارة المشاريع" body="احفظ مشاريعك محلياً، وافتحها ونظم صفحاتها قبل التصدير." /><Service icon={Type} title="تجربة عربية" body="دعم RTL، النص العربي، المحاذاة، الخطوط، والأرقام في مساحة عمل واحدة." /><Service icon={Palette} title="هوية مرنة" body="اضبط ألوان الجهة وخطوطها ورؤوس الصفحات وتذييلها للمستند." /><Service icon={CheckCircle2} title="معاينة وتصدير" body="راجع التصميم ثم صدّره بالصيغة المتاحة وفق نوع الترخيص." /></div></section>

        <section className="grid gap-5 border-y border-line py-10 lg:grid-cols-2 dark:border-white/10"><div><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-navy-2 dark:text-gold-2" /><h2 className="text-[20px] font-extrabold">لماذا {BRAND.name}؟</h2></div><p className="mt-3 text-[14px] leading-7 text-muted">تجمع المنصة القوالب والمشاريع والصفحات والعناصر وأدوات التحرير في واجهة عربية واحدة، لتصل إلى أدوات العمل بسرعة وتحافظ على تنظيم الملف من البداية إلى التصدير.</p></div><div><div className="flex items-center gap-2"><LockKeyhole className="size-5 text-navy-2 dark:text-gold-2" /><h2 className="text-[20px] font-extrabold">الأمان والخصوصية</h2></div><p className="mt-3 text-[14px] leading-7 text-muted">يحفظ الإصدار الحالي المشاريع داخل متصفحك ولا يرفعها تلقائياً إلى خادم. لا تُضمَّن مفاتيح API أو بيانات اعتماد في الواجهة أو المستودع. أما التراخيص المدفوعة فتحتاج تحققاً خادمياً عند نشر النسخة التجارية، ولا يمكن اعتبار كود الواجهة المتاح للمتصفح محمياً من النسخ.</p></div></section>

        <section className="py-10"><h2 className="text-[20px] font-extrabold">معلومات المنتج</h2><dl className="mt-5 grid gap-3 sm:grid-cols-3"><Fact label="اسم المنتج" value="نَسَق | NASAQ" /><Fact label="المصمم والمطور" value="فيصل المضياني" /><Fact label="نوع المنتج" value="منصة تصميم وتحرير عربية" /></dl></section>

        <section className="border-t border-line pt-10 dark:border-white/10"><div className="max-w-2xl"><h2 className="text-[20px] font-extrabold">هوية مستندك</h2><p className="mt-2 text-[14px] leading-7 text-muted">اضبط معلومات الجهة وألوانها وخطوطها هنا، ثم احفظها محلياً لاستخدامها في إعداد المستندات.</p></div>
        <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_300px]">
          <section className="grid gap-5 rounded-[12px] border border-line bg-white p-5 dark:border-white/10 dark:bg-white/5">
            <Field label="اسم الجهة"><input value={kit.organizationName} onChange={(e) => update("organizationName", e.target.value)} placeholder="اسم الجهة أو الإدارة" /></Field>
            <div className="grid gap-3 sm:grid-cols-3"><ColorField label="اللون الأساسي" value={kit.primaryColor} onChange={(value) => update("primaryColor", value)} /><ColorField label="اللون الثانوي" value={kit.secondaryColor} onChange={(value) => update("secondaryColor", value)} /><ColorField label="الذهبي الهادئ" value={kit.accentColor} onChange={(value) => update("accentColor", value)} /></div>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="الخط العربي"><select value={kit.arabicFont} onChange={(e) => update("arabicFont", e.target.value)}><option>Tajawal</option><option>Cairo</option><option>IBM Plex Sans Arabic</option><option>Noto Sans Arabic</option></select></Field><Field label="الخط الإنجليزي"><input value={kit.englishFont} onChange={(e) => update("englishFont", e.target.value)} /></Field></div>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="أسلوب الترويسة"><select value={kit.headerStyle} onChange={(e) => update("headerStyle", e.target.value as BrandKit["headerStyle"])}><option value="official">رسمي</option><option value="minimal">مختصر</option><option value="band">شريط هوية</option></select></Field><Field label="أسلوب التذييل"><select value={kit.footerStyle} onChange={(e) => update("footerStyle", e.target.value as BrandKit["footerStyle"])}><option value="official">رسمي</option><option value="simple">بسيط</option><option value="none">بدون تذييل</option></select></Field></div>
            <div className="flex flex-wrap gap-2 border-t border-line pt-4 dark:border-white/10"><button type="button" onClick={save} className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-navy px-4 text-[12px] font-extrabold text-white"><Save className="size-4" />{saved ? "تم الحفظ" : "حفظ الهوية محليًا"}</button><button type="button" onClick={() => setKit(resetBrandKit())} className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-line px-4 text-[12px] font-bold dark:border-white/10"><RotateCcw className="size-4" />إعادة الضبط</button></div>
          </section>
          <aside className="rounded-[12px] border border-line bg-white p-5 dark:border-white/10 dark:bg-white/5"><div className="flex items-start gap-3"><ShieldCheck className="size-5 text-green" /><div><h2 className="text-[14px] font-extrabold">فصل الهوية عن الواجهة</h2><p className="mt-1 text-[12px] leading-6 text-muted">تؤثر هذه القيم على تصميم المستند مستقبلًا، بينما يبقى الوضع الداكن/الفاتح خاصًا بواجهة المحرر فقط.</p></div></div><div className="mt-6 overflow-hidden border border-line bg-white dark:border-white/10"><div className="h-14" style={{ background: kit.primaryColor }} /><div className="p-4" style={{ fontFamily: kit.arabicFont }}><p className="text-[10px]" style={{ color: kit.secondaryColor }}>{kit.organizationName || "اسم الجهة"}</p><h3 className="mt-2 text-[19px] font-extrabold" style={{ color: kit.primaryColor }}>عنوان التقرير</h3><span className="mt-3 block h-1 w-16" style={{ background: kit.accentColor }} /></div></div><div className="mt-4 flex gap-2"><span className="size-6 rounded-full" style={{ background: kit.primaryColor }} /><span className="size-6 rounded-full" style={{ background: kit.secondaryColor }} /><span className="size-6 rounded-full" style={{ background: kit.accentColor }} /></div></aside>
        </div></section>
      </main>
      <SiteFooter />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1 text-[11px] font-extrabold text-muted">{label}{children}</label>; }
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <Field label={label}><div className="flex h-10 items-center gap-2 rounded-[8px] border border-line px-2 dark:border-white/10"><input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="size-6 border-0 bg-transparent p-0" /><input value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1 border-0 bg-transparent text-[12px] uppercase outline-none" dir="ltr" /></div></Field>; }
function Service({ icon: Icon, title, body }: { icon: typeof FilePenLine; title: string; body: string }) { return <div className="border border-line bg-white p-4 dark:border-white/10 dark:bg-white/5"><Icon className="size-5 text-navy-2 dark:text-gold-2" /><h3 className="mt-3 text-[14px] font-extrabold">{title}</h3><p className="mt-1 text-[12px] leading-6 text-muted">{body}</p></div>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="border border-line bg-white p-4 dark:border-white/10 dark:bg-white/5"><dt className="text-[11px] font-extrabold text-muted">{label}</dt><dd className="mt-2 text-[14px] font-extrabold">{value}</dd></div>; }
