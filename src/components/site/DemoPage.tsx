import { CheckCircle2, LockKeyhole, Play, Sparkles } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { useEditor } from "@/lib/editor/store";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";

const DEMO_ITEMS = ["مشروع واحد قابل للتحرير", "حتى 3 صفحات", "تصدير PNG وJPG بدقة 72 DPI"];
const FULL_ITEMS = ["مكتبة القوالب كاملة", "مشاريع وصفحات بلا حد تجريبي", "Word وPowerPoint وHTML وملف المشروع", "هوية مؤسسية وخيارات فريق قابلة للتفعيل"];

export function DemoPage() {
  const createProject = useEditor((state) => state.createProject);

  const startDemo = async () => {
    const created = await createProject("blank");
    if (created) window.location.assign("/editor");
  };

  return (
    <div className="min-h-full bg-paper dark:bg-[#111722]">
      <SiteHeader current="/demo" />
      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <p className="text-[12px] font-extrabold tracking-[0.16em] text-green dark:text-gold-2">عرض تجريبي محدود</p>
        <h1 className="mt-3 max-w-3xl text-[30px] font-extrabold leading-[1.35] sm:text-[42px]">استكشف طريقة العمل قبل شراء {BRAND.platform}</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-8 text-muted">تجربة عملية قصيرة تريك التحرير العربي والعناصر والصفحات والتصدير الأساسي، من دون منح نسخة المنتج الكاملة.</p>
        <div className="mt-9 grid gap-5 lg:grid-cols-2">
          <section className="border border-line bg-white p-6 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center gap-3"><Play className="size-5 text-navy-2 dark:text-gold-2" /><h2 className="text-[18px] font-extrabold">ما يتاح في العرض</h2></div>
            <ul className="mt-5 grid gap-3">{DEMO_ITEMS.map((item) => <li key={item} className="flex items-center gap-2 text-[14px]"><CheckCircle2 className="size-4 text-ok" />{item}</li>)}</ul>
            <button type="button" onClick={() => void startDemo()} className="mt-7 inline-flex h-11 items-center gap-2 rounded-[8px] bg-navy px-4 text-[13px] font-extrabold text-white"><Play className="size-4" />بدء العرض التجريبي</button>
          </section>
          <section className="border border-navy/25 bg-[#f6f8f5] p-6 dark:border-gold/30 dark:bg-[#1c2021]">
            <div className="flex items-center gap-3"><LockKeyhole className="size-5 text-navy-2 dark:text-gold-2" /><h2 className="text-[18px] font-extrabold">ما يفتح بعد الشراء</h2></div>
            <ul className="mt-5 grid gap-3">{FULL_ITEMS.map((item) => <li key={item} className="flex items-center gap-2 text-[14px]"><Sparkles className="size-4 text-gold" />{item}</li>)}</ul>
            <a href="/purchase" className="mt-7 inline-flex h-11 items-center gap-2 rounded-[8px] border border-navy px-4 text-[13px] font-extrabold text-navy dark:border-gold dark:text-gold-2">عرض النسخ وخطوات التسليم</a>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}