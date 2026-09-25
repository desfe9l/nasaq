import { useState, useEffect, useRef } from "react";
import { ArrowLeft, Briefcase, FileText, LayoutTemplate, Table2, FileDown, Palette, ShieldCheck, Workflow, Files, Ruler, Building2, Users, Megaphone, PenTool, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { PACKS } from "@/lib/editor/templates";
import { useEditor } from "@/lib/editor/store";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { ProjectCard } from "@/components/site/ProjectCard";
import { PRODUCT_COPY } from "@/lib/product/copy";
import { CARD_W, CARD_WRAP, SITE_CARD } from "@/components/site/cards";
import { FullVersionModal } from "@/components/site/FullVersionModal";
import { HeroShowcase } from "@/components/site/HeroShowcase";
import { useSiteSettings } from "@/lib/admin/use-site-settings";

const HIGHLIGHTS: { icon: typeof FileText; title: string; desc: string }[] = [
  { icon: LayoutTemplate, title: PRODUCT_COPY.capabilities[0][0], desc: PRODUCT_COPY.capabilities[0][1] },
  { icon: Table2, title: PRODUCT_COPY.capabilities[1][0], desc: PRODUCT_COPY.capabilities[1][1] },
  { icon: Palette, title: PRODUCT_COPY.capabilities[2][0], desc: PRODUCT_COPY.capabilities[2][1] },
  { icon: FileDown, title: PRODUCT_COPY.capabilities[3][0], desc: PRODUCT_COPY.capabilities[3][1] },
  { icon: ShieldCheck, title: PRODUCT_COPY.capabilities[4][0], desc: PRODUCT_COPY.capabilities[4][1] },
  { icon: Files, title: PRODUCT_COPY.capabilities[5][0], desc: PRODUCT_COPY.capabilities[5][1] },
];

export function HomePage() {
  const importProject = useEditor((s) => s.importProject);
  const projects = useEditor((s) => s.projects);
  const projectsLoading = useEditor((s) => s.projectsLoading);
  const hydrate = useEditor((s) => s.hydrate);
  const openProject = useEditor((s) => s.openProject);
  const fileInput = useRef<HTMLInputElement>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const { texts } = useSiteSettings();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const recent = projects.slice(0, 3);

  const openEditor = async (id: string) => {
    await openProject(id);
    window.location.assign("/editor");
  };

  return (
    <div className="min-h-full bg-white dark:bg-[#111722]">
      <SiteHeader current="/" />
      <main>
        {/* Hero — مؤسسي رسمي هادئ */}
        <section className="border-b border-line/70 bg-white dark:border-white/10 dark:bg-[#111722]">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-16">
            <div>
              <div className="mb-4 inline-flex items-center rounded-full border border-[#006C35]/15 bg-[#006C35]/5 px-3 py-1 text-[11px] font-bold tracking-wide text-[#0F1E33] dark:border-white/10 dark:bg-white/5 dark:text-white/70">
                {texts.heroEyebrow.trim() || PRODUCT_COPY.hero.eyebrow}
              </div>
              <h1 className="max-w-2xl text-[28px] font-extrabold leading-[1.25] text-[#0F1E33] dark:text-white sm:text-[38px]">
                {texts.heroTitle.trim() || PRODUCT_COPY.hero.title}
              </h1>
              <p className="mt-4 max-w-xl text-[15px] leading-8 text-[#475467] dark:text-white/60">
                {texts.heroDescription.trim() || PRODUCT_COPY.hero.description}
              </p>
              <p className="mt-3 max-w-xl text-[13px] leading-6 text-[#667085] dark:text-white/40">
                منصة واحدة لإعداد التقارير السنوية ولوحات المؤشرات والخطابات الرسمية والعروض التنفيذية، مع التزام كامل بالهوية المؤسسية وجودة طباعة 300 DPI.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <a href="/editor" className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#006C35] px-6 text-[14px] font-bold text-white shadow-sm transition hover:bg-[#00542a]">
                  <span>فتح المحرر</span>
                  <ArrowLeft className="size-4" />
                </a>
                <a href="/purchase" className="inline-flex h-11 items-center rounded-[10px] border border-line bg-white px-5 text-[13px] font-bold text-[#0F1E33] hover:bg-[#f8faf9] dark:border-white/15 dark:bg-white/5 dark:text-white">
                  استعراض الخطط والأسعار
                </a>
                <a href="/projects" className="inline-flex h-11 items-center rounded-[10px] px-3 text-[13px] font-bold text-[#475467] underline-offset-4 hover:text-[#0F1E33] hover:underline dark:text-white/60">
                  كل مشاريعي
                </a>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-[#f8faf9] px-3 py-1 text-[11px] font-semibold text-[#344054] dark:border-white/10 dark:bg-white/5 dark:text-white/60">تخزين محلي أولًا</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-[#f8faf9] px-3 py-1 text-[11px] font-semibold text-[#344054] dark:border-white/10 dark:bg-white/5 dark:text-white/60">جاهز للطباعة 300 DPI</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-[#f8faf9] px-3 py-1 text-[11px] font-semibold text-[#344054] dark:border-white/10 dark:bg-white/5 dark:text-white/60">دعم الخطوط العربية الرسمية</span>
              </div>

              <p className="mt-4 text-[11px] leading-6 text-[#98a2b3] dark:text-white/30">{PRODUCT_COPY.demoNote}</p>

              <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const parsed = JSON.parse(String(reader.result));
                    void importProject(parsed).then(() => window.location.assign("/editor"));
                  } catch {
                    toast.error("تعذر قراءة الملف — تأكد أنه ملف مشروع بصيغة JSON");
                  }
                };
                reader.onerror = () => toast.error("تعذر قراءة الملف");
                reader.readAsText(file);
                e.target.value = "";
              }} />
            </div>

            <div>
              <HeroShowcase />
              <p className="mt-3 text-[11px] text-[#667085] dark:text-white/40">معاينة حقيقية من المحرر — تقارير، مؤشرات، خطابات رسمية بجودة مؤسسية</p>
            </div>
          </div>
        </section>

        {/* لمن تناسب — مؤسسي */}
        <section className="border-b border-line/60 bg-[#fcfdfc] py-10 dark:border-white/10 dark:bg-[#151b27] sm:py-12">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
              <div>
                <p className="text-[11px] font-bold tracking-[0.14em] text-[#006C35]">لمن تناسب</p>
                <h2 className="mt-2 text-[20px] font-extrabold text-[#0F1E33] dark:text-white">مصممة للجهات والمؤسسات والفرق المحترفة</h2>
                <p className="mt-2 text-[13px] leading-7 text-[#475467] dark:text-white/60">توفر نَسَق بيئة عمل تناسب المتطلبات الرسمية، مع التزام بالهوية البصرية والجودة الطباعية وسهولة إعادة الاستخدام عبر القوالب.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { icon: Building2, title: "الجهات الحكومية", desc: "تقارير أداء وإحصائيات وخطابات رسمية بهوية موحدة." },
                  { icon: Briefcase, title: "الشركات والمؤسسات", desc: "عروض تنفيذية وملفات تعريفية وتقارير دورية." },
                  { icon: Megaphone, title: "إدارات الإعلام والاتصال", desc: "إنتاج يومي منظم للمخرجات الإعلامية والمؤسسية." },
                  { icon: PenTool, title: "المصممون وصناع التقارير", desc: "تحكم دقيق بالعناصر والخطوط والتصدير دون تعقيد." },
                ].map((c) => (
                  <div key={c.title} className="flex gap-3 rounded-[12px] border border-line/60 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
                    <c.icon className="mt-0.5 size-4 shrink-0 text-[#0F1E33] dark:text-white/70" />
                    <div>
                      <h3 className="text-[13px] font-bold text-[#0F1E33] dark:text-white">{c.title}</h3>
                      <p className="mt-1 text-[12px] leading-6 text-[#667085] dark:text-white/50">{c.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ماذا تقدم */}
        <section className="border-b border-line/60 bg-white py-10 dark:border-white/10 dark:bg-[#111722] sm:py-12">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-[11px] font-bold tracking-[0.14em] text-[#006C35]">ماذا تقدم نَسَق</p>
              <h2 className="mt-2 text-[20px] font-extrabold text-[#0F1E33] dark:text-white">إنتاج بصري منظم للمخرجات المتكررة</h2>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {[
                [Briefcase, "للفرق المؤسسية", "إنتاج منظم للمخرجات المتكررة مع حفظ الهوية."],
                [Workflow, "لسير العمل الحقيقي", "من البيانات والهيكل إلى ملف جاهز للعرض والطباعة."],
                [ShieldCheck, "لعمل آمن ومنظم", "تخزين محلي أولًا ومسار واضح للترخيص والتصدير."],
              ].map(([Icon, title, desc]) => (
                <div key={String(title)} className="flex gap-3 rounded-[12px] border border-line/60 bg-[#fcfdfc] p-4 dark:border-white/10 dark:bg-white/[0.03]">
                  <span className="grid size-9 place-items-center rounded-[9px] border border-[#006C35]/10 bg-[#006C35]/5 text-[#006C35] dark:border-white/10 dark:bg-white/5">
                    <Icon className="size-4" />
                  </span>
                  <div>
                    <strong className="block text-[13px] font-bold text-[#0F1E33] dark:text-white">{String(title)}</strong>
                    <span className="mt-1 block text-[12px] leading-6 text-[#667085] dark:text-white/50">{String(desc)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* أحدث المشاريع */}
        <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <h2 className="text-[18px] font-bold text-[#0F1E33] dark:text-white">أحدث المشاريع</h2>
          <p className="mt-1 text-[13px] text-[#667085] dark:text-white/50">المشاريع تُحفظ محليًا في متصفحك، مع اتصال عند الحاجة للترخيص أو الذكاء الاصطناعي.</p>
          {projectsLoading ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {[0, 1, 2].map((i) => <div key={i} className="h-[120px] animate-pulse rounded-[12px] border border-line bg-[#f8faf9] dark:border-white/10 dark:bg-white/5" />)}
            </div>
          ) : recent.length ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {recent.map((p) => <ProjectCard key={p.id} project={p} onOpen={openEditor} compact />)}
            </div>
          ) : (
            <div className="mt-6 rounded-[12px] border border-dashed border-line bg-[#fcfdfc] p-8 text-center dark:border-white/10 dark:bg-white/[0.02]">
              <p className="text-[13px] font-bold text-[#0F1E33] dark:text-white">لا توجد مشاريع بعد</p>
              <p className="mt-1 text-[12px] text-[#667085] dark:text-white/50">ابدأ بتقرير رسمي جاهز أو بصفحة فارغة.</p>
            </div>
          )}
        </section>

        {/* قوالب البداية */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6">
          <h2 className="text-[18px] font-bold text-[#0F1E33] dark:text-white">قوالب البداية</h2>
          <p className="mt-1 text-[13px] text-[#667085] dark:text-white/50">كل قالب ينشئ نسخة جديدة داخل مشروعك.</p>
          <div className={`mt-6 ${CARD_WRAP}`}>
            {PACKS.map((pack) => (
              <button key={pack.id} type="button" onClick={() => pack.id === "blank" ? window.location.assign("/demo") : setModalOpen(true)} className={`flex flex-col rounded-[12px] border border-line/70 bg-white p-5 text-right hover:border-[#0F1E33]/20 dark:border-white/10 dark:bg-white/[0.03] ${CARD_W} ${SITE_CARD}`}>
                <div className="mb-3 flex items-center justify-between">
                  <span className="grid size-8 place-items-center rounded-[8px] bg-[#f8faf9] text-[#0F1E33] dark:bg-white/5 dark:text-white/70">
                    <FileText className="size-4" />
                  </span>
                  <span className="text-[11px] text-[#98a2b3]">{pack.pages}</span>
                </div>
                <strong className="block text-[14px] font-bold text-[#0F1E33] dark:text-white">{pack.title}</strong>
                <span className="mt-1 block text-[12px] leading-5 text-[#667085] dark:text-white/50">{pack.desc}</span>
                <span className="mt-auto pt-4 text-[11px] font-bold text-[#006C35]">{pack.id === "blank" ? "فتح العرض" : "متاح في النسخة الكاملة"}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ماذا تتضمن المنصة */}
        <section className="border-t border-line/60 bg-[#f8faf9] py-10 dark:border-white/10 dark:bg-[#151b27] sm:py-12">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <h2 className="text-[18px] font-bold text-[#0F1E33] dark:text-white">ماذا تتضمن المنصة</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {HIGHLIGHTS.map((h) => {
                const Icon = h.icon;
                return (
                  <div key={h.title} className="rounded-[12px] border border-line/60 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="flex items-start gap-3">
                      <span className="grid size-8 place-items-center rounded-[8px] border border-[#006C35]/10 bg-[#006C35]/5 text-[#006C35] dark:border-white/10 dark:bg-white/5">
                        <Icon className="size-4" />
                      </span>
                      <div>
                        <strong className="block text-[13px] font-bold text-[#0F1E33] dark:text-white">{h.title}</strong>
                        <p className="mt-1 text-[12px] leading-6 text-[#667085] dark:text-white/50">{h.desc}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="/templates" className="inline-flex h-10 items-center rounded-[10px] bg-[#0F1E33] px-5 text-[13px] font-bold text-white hover:bg-black dark:bg-white dark:text-[#0F1E33]">استعراض القوالب</a>
              <a href="/purchase" className="inline-flex h-10 items-center rounded-[10px] border border-line bg-white px-5 text-[13px] font-bold text-[#0F1E33] hover:bg-[#fcfdfc] dark:border-white/10 dark:bg-white/5 dark:text-white">الخطط والأسعار</a>
            </div>
          </div>
        </section>

        {/* الخطط باختصار */}
        <section className="bg-white py-10 dark:bg-[#111722] sm:py-12">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold tracking-[0.14em] text-[#006C35]">الخطط والتراخيص</p>
                <h2 className="mt-2 text-[18px] font-bold text-[#0F1E33] dark:text-white">اختر الخطة المناسبة</h2>
              </div>
              <a href="/purchase" className="text-[13px] font-bold text-[#006C35] hover:underline">عرض جميع الباقات</a>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {[
                { name: "مجاني", price: "0 ر.س", desc: "للتقييم والبدء", features: ["أدوات أساسية", "حفظ محلي", "تصدير 72 DPI"] },
                { name: "فردي — Pro", price: "199 ر.س / 3 أشهر", desc: "للمصممين والأفراد", features: ["تصدير حتى 384 DPI", "كل الصيغ", "قوالب وهوية كاملة"] },
                { name: "فريق — Team", price: "499 ر.س / 3 أشهر", desc: "للفرق", features: ["كل مزايا Pro", "مساحة عمل مشتركة", "دعم بأولوية"] },
              ].map((p, i) => (
                <div key={p.name} className={`rounded-[12px] border p-5 ${i === 2 ? "border-[#006C35]/20 bg-[#f6fdf8] dark:bg-[#006C35]/10" : "border-line/70 bg-[#fcfdfc] dark:border-white/10 dark:bg-white/[0.02]"}`}>
                  <h3 className="text-[14px] font-bold text-[#0F1E33] dark:text-white">{p.name}</h3>
                  <p className="mt-1 text-[11px] text-[#667085] dark:text-white/40">{p.desc}</p>
                  <p className="mt-3 text-[18px] font-extrabold text-[#0F1E33] dark:text-white">{p.price}</p>
                  <ul className="mt-3 grid gap-1.5">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-[12px] text-[#344054] dark:text-white/60">
                        <CheckCircle2 className="size-3.5 text-[#006C35]" /> {f}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
      <FullVersionModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
