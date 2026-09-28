import { CheckCircle2, LockKeyhole, Play, Sparkles } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { useEditor } from "@/lib/editor/store";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { accountIdentity } from "@/lib/auth/identity";
import { useEditorEntry } from "@/lib/auth/use-editor-entry";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";

const DEMO_ITEMS = ["مشروع واحد قابل للتحرير", "حتى 3 صفحات", "تصدير PNG وJPG بدقة 72 DPI"];
const FULL_ITEMS = ["مكتبة القوالب كاملة", "مشاريع وصفحات بلا حد تجريبي", "Word وPowerPoint وHTML وملف المشروع", "هوية مؤسسية وخيارات فريق قابلة للتفعيل"];

export function DemoPage() {
  const createProject = useEditor((state) => state.createProject);
  const { user, isPending } = useCurrentUserState();
  const { entry, openNewDocument } = useEditorEntry();
  // A signed-in account reaches this page only by an old link or a click made
  // before the session resolved; it is never gated by it.
  const direct = entry.ready && entry.direct;
  const { label } = accountIdentity(user);

  const startDemo = async () => {
    const created = await createProject("blank");
    if (created) window.location.assign("/editor");
  };

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader current="/demo" />
      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <p className="text-[12px] font-extrabold tracking-[0.16em] text-ink">
          {direct ? "أهلًا بك في المحرر" : "عرض تجريبي محدود"}
        </p>
        <h1 className="mt-3 max-w-3xl text-[30px] font-extrabold leading-[1.35] sm:text-[42px]">
          {direct
            ? `${label}، المحرر مفتوح لحسابك مباشرة`
            : `استكشف طريقة العمل قبل شراء ${BRAND.platform}`}
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-8 text-muted">
          {direct
            ? "لا تحتاج إلى العرض التجريبي: ادخل المحرر وتُطبَّق حدود اشتراكك الحالي تلقائيًا، وتبقى مشاريعك محفوظة في حسابك."
            : "تجربة عملية قصيرة تريك التحرير العربي والعناصر والصفحات والتصدير الأساسي، من دون منح نسخة المنتج الكاملة."}
        </p>
        <div className="mt-9 grid gap-5 lg:grid-cols-2">
          <section className="rounded-[14px] border border-line bg-surface p-6 transition-all duration-200 hover:border-line/80 hover:shadow-card">
            <div className="flex items-center gap-3"><Play className="size-5 text-brand-hover" /><h2 className="text-[18px] font-extrabold">{direct ? "الدخول إلى المحرر" : "ما يتاح في العرض"}</h2></div>
            <ul className="mt-5 grid gap-3">{DEMO_ITEMS.map((item) => <li key={item} className="flex items-center gap-2 text-[14px]"><CheckCircle2 className="size-4 shrink-0 text-success" /><span>{item}</span></li>)}</ul>
            {direct ? (
              <button type="button" onClick={() => void openNewDocument()} className="mt-7 inline-flex h-11 items-center gap-2 rounded-[10px] bg-navy px-4 text-[13px] font-extrabold text-on-brand transition hover:bg-navy-2"><Play className="size-4" />افتح المحرر</button>
            ) : (
              <button type="button" onClick={() => void startDemo()} className="mt-7 inline-flex h-11 items-center gap-2 rounded-[10px] bg-navy px-4 text-[13px] font-extrabold text-on-brand transition hover:bg-navy-2"><Play className="size-4" />بدء تجربة المحرر</button>
            )}
            {direct && !isPending && (
              <p className="mt-3 text-[11px] leading-5 text-muted">
                حسابك مسجَّل الدخول — الدخول إلى المحرر لا يتطلب أي خطوة إضافية.
              </p>
            )}
          </section>
          <section className="rounded-[14px] border border-brand/25 bg-surface-2 p-6 transition-all duration-200 hover:border-brand/35 hover:shadow-card">
            <div className="flex items-center gap-3"><LockKeyhole className="size-5 text-brand-hover" /><h2 className="text-[18px] font-extrabold">ما يفتح بعد الشراء</h2></div>
            <ul className="mt-5 grid gap-3">{FULL_ITEMS.map((item) => <li key={item} className="flex items-center gap-2 text-[14px]"><Sparkles className="size-4 shrink-0 text-gold" /><span>{item}</span></li>)}</ul>
            <a href="/purchase" className="mt-7 inline-flex h-11 items-center gap-2 rounded-[10px] border border-brand px-4 text-[13px] font-extrabold text-brand transition hover:bg-brand/5">عرض النسخ وخطوات التسليم</a>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
