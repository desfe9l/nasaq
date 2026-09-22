import { useState, useEffect, useRef } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  FileText,
  LayoutTemplate,
  Table2,
  FileDown,
  Palette,
  ShieldCheck,
  Workflow,
  Files,
  Sparkles,
  Zap,
  MousePointer,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { PACKS } from "@/lib/editor/templates";
import { useEditor } from "@/lib/editor/store";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { ProjectCard } from "@/components/site/ProjectCard";
import { PRODUCT_COPY } from "@/lib/product/copy";
import { CARD_W, CARD_WRAP, SITE_CARD, iconTint } from "@/components/site/cards";
import { FullVersionModal } from "@/components/site/FullVersionModal";

/**
 * Six capability cards: the two extra entries carry the privacy
 * and multi-format/pagination story. Icons sit on an emerald backlight tile;
 * the card itself uses the shared lift + a soft emerald glow on hover.
 */
const HIGHLIGHTS: { icon: typeof FileText; title: string; desc: string }[] = [
  { icon: LayoutTemplate, title: PRODUCT_COPY.capabilities[0][0], desc: PRODUCT_COPY.capabilities[0][1] },
  { icon: Table2, title: PRODUCT_COPY.capabilities[1][0], desc: PRODUCT_COPY.capabilities[1][1] },
  { icon: Palette, title: PRODUCT_COPY.capabilities[2][0], desc: PRODUCT_COPY.capabilities[2][1] },
  { icon: FileDown, title: PRODUCT_COPY.capabilities[3][0], desc: PRODUCT_COPY.capabilities[3][1] },
  { icon: ShieldCheck, title: PRODUCT_COPY.capabilities[4][0], desc: PRODUCT_COPY.capabilities[4][1] },
  { icon: Files, title: PRODUCT_COPY.capabilities[5][0], desc: PRODUCT_COPY.capabilities[5][1] },
];

/** Value badges shown under the features CTA. */
const CTA_BADGES = ["🔒 معالجة محلية 100%", "📐 جاهز للطباعة 300DPI", "🇸🇦 دعم الخطوط العربية الرسمية"];

export function HomePage() {
  const importProject = useEditor((s) => s.importProject);
  const projects = useEditor((s) => s.projects);
  const projectsLoading = useEditor((s) => s.projectsLoading);
  const hydrate = useEditor((s) => s.hydrate);
  const openProject = useEditor((s) => s.openProject);
  const fileInput = useRef<HTMLInputElement>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState(0);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Auto-play through document previews
  useEffect(() => {
    const timer = setInterval(() => {
      setPreviewTab((prev) => (prev + 1) % 3);
    }, 4500);
    return () => clearInterval(timer);
  }, []);

  const recent = projects.slice(0, 3);

  const openEditor = async (id: string) => {
    await openProject(id);
    window.location.assign("/editor");
  };

  return (
    <div className="min-h-full bg-paper dark:bg-[#111722]">
      <SiteHeader current="/" />

      <main>
        {/* Hero Section */}
        <section className="relative overflow-hidden border-b border-line bg-gradient-to-b from-white via-white to-[#f4f7f4] py-14 sm:py-20 dark:border-white/10 dark:from-[#111722] dark:via-[#161d2b] dark:to-[#111722]">
          {/* Subtle background glow */}
          <div
            className="pointer-events-none absolute -top-40 right-1/4 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl dark:bg-emerald-500/15"
            aria-hidden
          />

          <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-[12px] font-extrabold text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300">
                <Sparkles className="size-3.5 animate-pulse" />
                <span>{PRODUCT_COPY.hero.eyebrow}</span>
              </div>

              <h1 className="max-w-3xl text-[34px] font-black leading-[1.25] text-ink drop-shadow-sm sm:text-[50px] dark:text-white dark:drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
                {PRODUCT_COPY.hero.title}
              </h1>

              <p className="mt-5 max-w-2xl text-[16px] leading-8 text-muted sm:text-[18px] sm:leading-9">
                {PRODUCT_COPY.hero.description}
              </p>

              {/* CTAs */}
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => window.location.assign("/demo")}
                  className="group inline-flex h-12 items-center gap-2.5 rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-600 to-emerald-500 px-6 text-[14px] font-black text-white shadow-[0_4px_20px_rgba(16,185,129,0.35)] transition-all hover:-translate-y-0.5 hover:from-emerald-500 hover:to-emerald-400 hover:shadow-[0_8px_30px_rgba(16,185,129,0.5)]"
                >
                  <span>{PRODUCT_COPY.hero.primary}</span>
                  <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" />
                </button>

                <button
                  type="button"
                  onClick={() => setModalOpen(true)}
                  className="inline-flex h-12 items-center gap-2 rounded-xl border border-line bg-white/70 px-5 text-[14px] font-extrabold text-ink shadow-sm backdrop-blur-md transition hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-700 dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:border-emerald-400/40 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300"
                >
                  <Zap className="size-4 text-emerald-600 dark:text-emerald-400" />
                  <span>طلب النسخة الكاملة</span>
                </button>

                <a
                  href="/projects"
                  className="inline-flex h-12 items-center rounded-xl border border-line/60 bg-line/20 px-4 text-[13px] font-bold text-navy-2 backdrop-blur-sm transition hover:bg-line-2 dark:border-white/10 dark:bg-white/5 dark:text-gold-2 dark:hover:bg-white/10"
                >
                  كل مشاريعي
                </a>
              </div>

              <p className="mt-5 text-[12px] leading-6 text-muted">{PRODUCT_COPY.demoNote}</p>

              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
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
                }}
              />
            </div>

            {/* Visual Editor Showcase: macOS-style Window Frame */}
            <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
              <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-[#0d1522] p-1 shadow-[0_20px_50px_rgba(0,0,0,0.35),0_0_40px_-10px_rgba(16,185,129,0.3)]">
                {/* macOS Titlebar */}
                <div className="flex items-center justify-between border-b border-white/10 bg-[#162032] px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="size-3 rounded-full bg-[#ff5f56] inline-block shadow-sm" />
                    <span className="size-3 rounded-full bg-[#ffbd2e] inline-block shadow-sm" />
                    <span className="size-3 rounded-full bg-[#27c93f] inline-block shadow-sm" />
                  </div>
                  <div className="flex items-center gap-1.5 rounded-md border border-white/10 bg-black/40 px-3 py-1 text-[11px] font-mono text-gray-300">
                    <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>nasaq.app/editor</span>
                  </div>
                  <div className="text-[10px] font-extrabold text-emerald-400">NASAQ STUDIO</div>
                </div>

                {/* Sub-toolbar: Active Doc Tabs */}
                <div className="flex items-center gap-1 border-b border-white/10 bg-[#121a29] px-3 py-1.5 text-[11px] overflow-x-auto">
                  {[
                    "تقرير الأداء المؤسسي 2026",
                    "لوحة المؤشرات والبيانات",
                    "خطاب وهوية معتمدة",
                  ].map((title, idx) => (
                    <button
                      key={title}
                      type="button"
                      onClick={() => setPreviewTab(idx)}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-right transition font-bold ${
                        previewTab === idx
                          ? "bg-emerald-600/30 text-emerald-300 border border-emerald-500/40"
                          : "text-gray-400 hover:text-white"
                      }`}
                    >
                      <span className="size-1.5 rounded-full bg-emerald-400" />
                      <span>{title}</span>
                    </button>
                  ))}
                </div>

                {/* Simulated Canvas Viewport with Live Document Render */}
                <div className="relative h-[310px] sm:h-[340px] bg-[#1a2334] p-3 sm:p-5 flex items-center justify-center overflow-hidden">
                  {/* Subtle Grid backdrop */}
                  <div
                    className="absolute inset-0 opacity-15 pointer-events-none"
                    style={{
                      backgroundImage: "radial-gradient(#10b981 1px, transparent 1px)",
                      backgroundSize: "16px 16px",
                    }}
                  />

                  {/* A4 Artboard Simulation */}
                  <div className="relative h-[285px] w-[210px] sm:h-[310px] sm:w-[230px] rounded-sm bg-white text-ink shadow-[0_15px_35px_rgba(0,0,0,0.4)] overflow-hidden flex flex-col justify-between p-3 select-none">
                    {previewTab === 0 && (
                      <>
                        <div className="border-b-2 border-emerald-800 pb-2">
                          <div className="flex items-center justify-between">
                            <span className="rounded bg-emerald-900 px-1.5 py-0.5 text-[7px] font-black text-white">
                              نَسَق
                            </span>
                            <span className="text-[7px] text-gray-500 font-mono">Q3-2026</span>
                          </div>
                          <h4 className="mt-1 text-[10px] font-black text-emerald-950">
                            تقرير قياس مؤشرات الربع السنوي
                          </h4>
                        </div>

                        {/* Interactive selection box */}
                        <div className="relative my-1 rounded border-2 border-emerald-500 bg-emerald-50/70 p-2">
                          <div className="absolute -top-1 -right-1 size-2 rounded-full border border-emerald-500 bg-white" />
                          <div className="absolute -top-1 -left-1 size-2 rounded-full border border-emerald-500 bg-white" />
                          <div className="absolute -bottom-1 -right-1 size-2 rounded-full border border-emerald-500 bg-white" />
                          <div className="absolute -bottom-1 -left-1 size-2 rounded-full border border-emerald-500 bg-white" />
                          <span className="absolute -top-4 left-1/2 -translate-x-1/2 rounded bg-emerald-600 px-1 py-0.2 text-[7px] font-mono text-white shadow">
                            190mm × 35mm
                          </span>
                          <div className="flex items-center justify-between text-[9px] font-black text-emerald-900">
                            <span>نسبة إنجاز التحول الرقمي</span>
                            <span className="text-emerald-700">96.4%</span>
                          </div>
                          <div className="mt-1.5 h-1.5 w-full rounded-full bg-emerald-200">
                            <div className="h-full w-[96.4%] rounded-full bg-emerald-600" />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-1.5 text-[8px]">
                          <div className="rounded border border-gray-200 bg-gray-50 p-1.5 text-center">
                            <span className="block text-gray-500 text-[7px]">إجمالي العمليات</span>
                            <strong className="text-[10px] font-black text-emerald-800">184,200</strong>
                          </div>
                          <div className="rounded border border-gray-200 bg-gray-50 p-1.5 text-center">
                            <span className="block text-gray-500 text-[7px]">مؤشر الجودة</span>
                            <strong className="text-[10px] font-black text-emerald-800">99.1%</strong>
                          </div>
                        </div>

                        <div className="border-t border-gray-200 pt-1 text-[6.5px] text-gray-400 flex justify-between">
                          <span>وثيقة رسمية معتمدة</span>
                          <span>صفحة 1 من 8</span>
                        </div>
                      </>
                    )}

                    {previewTab === 1 && (
                      <>
                        <div className="border-b border-gray-200 pb-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[8px] font-black text-emerald-800">📊 لوحة الإحصائيات</span>
                            <span className="text-[7px] text-gray-500">2026</span>
                          </div>
                          <p className="text-[7px] text-gray-500">تحليل الأداء التراكمي وتوزيع الموارد</p>
                        </div>

                        <div className="my-1 flex items-end gap-1.5 h-20 pt-2 px-1 border-b border-gray-100">
                          <div className="flex-1 bg-emerald-200 rounded-t h-[40%] text-center text-[6px]">40%</div>
                          <div className="flex-1 bg-emerald-400 rounded-t h-[65%] text-center text-[6px]">65%</div>
                          <div className="flex-1 bg-emerald-600 rounded-t h-[88%] text-center text-[6px] text-white">88%</div>
                          <div className="flex-1 bg-emerald-800 rounded-t h-[98%] text-center text-[6px] text-white font-bold">98%</div>
                        </div>

                        <div className="rounded bg-emerald-50 p-1.5 text-[8px] border border-emerald-200">
                          <span className="font-extrabold text-emerald-900 block">نمو قياسي متسارع</span>
                          <span className="text-[7px] text-emerald-700">تجاوزت المستهدفات بنسبة +24%</span>
                        </div>

                        <div className="border-t border-gray-200 pt-1 text-[6.5px] text-gray-400 flex justify-between">
                          <span>نظام التقارير الذكي</span>
                          <span>صفحة 3 من 5</span>
                        </div>
                      </>
                    )}

                    {previewTab === 2 && (
                      <>
                        <div className="text-center border-b border-emerald-800/40 pb-2">
                          <span className="text-[7px] font-bold text-gray-500 block">المملكة العربية السعودية</span>
                          <strong className="text-[9px] font-black text-emerald-900 block">خطاب رسمي معتمد</strong>
                          <span className="text-[6.5px] text-gray-400">الرقم: 4810/ق · التاريخ: 1448هـ</span>
                        </div>

                        <div className="my-2 space-y-1 text-[7.5px] leading-4 text-gray-700">
                          <p className="font-bold text-emerald-950">سعادة الرئيس التنفيذي المحترم،</p>
                          <p>السلام عليكم ورحمة الله وبركاته،</p>
                          <p>بناءً على الصلاحيات الممنوحة وضمن خطة تطوير المخرجات المؤسسية...</p>
                        </div>

                        <div className="mt-auto border-t border-gray-200 pt-1 flex items-center justify-between">
                          <div className="text-[6.5px]">
                            <span className="block font-bold">الاعتماد والتوقيع:</span>
                            <span className="text-emerald-800 font-serif italic text-[8px]">فيصل المضياني</span>
                          </div>
                          <div className="size-7 rounded-full border-2 border-emerald-700/60 flex items-center justify-center text-[6px] font-black text-emerald-800 rotate-12">
                            معتمد
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Floating mini tool palette over mockup */}
                  <div className="absolute bottom-4 right-4 flex items-center gap-1 rounded-xl border border-white/15 bg-black/70 p-1.5 shadow-xl backdrop-blur-md text-white text-[10px]">
                    <span className="flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2 py-1 text-emerald-300 font-bold">
                      <MousePointer className="size-3" /> أداة التحريك
                    </span>
                    <span className="rounded px-1.5 py-1 text-gray-400 hover:text-white">300 DPI</span>
                    <span className="rounded bg-emerald-600 px-2 py-0.5 font-bold text-white text-[9px]">تصدير مباشر</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features highlight bar */}
        <section className="border-b border-line bg-[#f6f8f5] dark:border-white/10 dark:bg-[#1c2021]">
          <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-8 sm:grid-cols-3 sm:px-6 md:py-12">
            {[[BriefcaseBusiness, "للفرق المؤسسية", "إنتاج منظم للمخرجات المتكررة."], [Workflow, "لسير العمل الحقيقي", "من البيانات والهيكل إلى ملف جاهز للعرض."], [ShieldCheck, "لـDemo آمن", "بيانات محلية تجريبية ومسار واضح للنسخة التجارية."]].map(([Icon, title, desc], i) => <div key={String(title)} className={`flex gap-4 rounded-xl bg-white p-4 dark:bg-white/5 ${SITE_CARD}`}><span className={`grid size-10 shrink-0 place-items-center rounded-xl ${iconTint(i)}`}><Icon className="size-5" /></span><div><strong className="block text-[14px] font-extrabold text-ink dark:text-white">{String(title)}</strong><span className="mt-1 block text-[13px] leading-6 text-muted">{String(desc)}</span></div></div>)}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 md:py-16">
          <h2 className="text-[20px] font-extrabold">أحدث المشاريع</h2>
          <p className="mt-1 text-[13px] text-muted">
            المشاريع محفوظة محلياً في متصفحك — لا تُرسل إلى أي سيرفر.
          </p>

          {projectsLoading ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-3 md:gap-6">
              {[0, 1, 2].map((i) => (
                <div key={i} className="shadow-card dark:shadow-card-dark h-[136px] animate-pulse rounded-xl border border-line bg-white dark:border-white/10 dark:bg-white/5" />
              ))}
            </div>
          ) : recent.length ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-3 md:gap-6">
              {recent.map((p) => (
                <ProjectCard key={p.id} project={p} onOpen={openEditor} compact />
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-xl border border-dashed border-line p-8 text-center dark:border-white/15">
              <p className="text-[14px] font-bold">لا توجد مشاريع بعد</p>
              <p className="mt-1 text-[13px] text-muted">ابدأ بتقرير رسمي جاهز أو بصفحة فارغة.</p>
            </div>
          )}
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-12 sm:px-6 md:pb-16">
          <h2 className="text-[20px] font-extrabold">قوالب البداية</h2>
          <p className="mt-1 text-[13px] text-muted">كل قالب ينشئ نسخة جديدة داخل مشروعك.</p>
          <div className={`mt-6 ${CARD_WRAP}`}>
            {PACKS.map((pack) => (
              <button
                key={pack.id}
                type="button"
                onClick={() =>
                  pack.id === "blank"
                    ? window.location.assign("/demo")
                    : setModalOpen(true)
                }
                className={`flex flex-col rounded-xl bg-white p-5 text-right hover:border-navy-2 dark:bg-white/5 ${CARD_W} ${SITE_CARD}`}
              >
                <div className="mb-4 flex items-center justify-between gap-2">
                  <span className={`grid size-10 place-items-center rounded-xl ${iconTint(0)}`}>
                    {pack.id === "blank" ? <FileText className="size-5" /> : <LayoutTemplate className="size-5" />}
                  </span>
                  <span className="text-[11px] font-bold text-muted">{pack.pages}</span>
                </div>
                <strong className="block text-[15px] font-extrabold text-ink dark:text-white">{pack.title}</strong>
                <span className="mt-2 block text-[12px] leading-6 text-muted">{pack.desc}</span>
                <span className="mt-auto inline-flex pt-4 text-[11px] font-extrabold text-navy-2 dark:text-gold-2">
                  {pack.id === "blank" ? "فتح العرض" : "متاح في النسخة الكاملة 👑"}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="border-t border-line bg-white dark:border-white/10 dark:bg-[#161c26]">
          <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 md:py-16">
            <h2 className="text-[20px] font-extrabold">ماذا تتضمن المنصة</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-3">
              {HIGHLIGHTS.map((h) => {
                const Icon = h.icon;
                return (
                  <div
                    key={h.title}
                    className={`group flex flex-col rounded-2xl bg-paper/60 p-6 dark:bg-white/5 ${SITE_CARD} hover:border-emerald-500/50 hover:shadow-[0_14px_34px_-14px_rgba(16,185,129,0.45)] dark:hover:border-emerald-400/40`}
                  >
                    {/* Emerald backlight behind the icon tile. */}
                    <span className="relative grid size-11 place-items-center">
                      <span className="absolute inset-0 rounded-xl bg-emerald-500/10 blur-[6px] transition group-hover:bg-emerald-500/20" aria-hidden />
                      <span className={`relative grid size-10 place-items-center rounded-xl ${iconTint(3)}`}>
                        <Icon className="size-5" />
                      </span>
                    </span>
                    <strong className="mt-4 block text-[15px] font-extrabold text-ink dark:text-white">{h.title}</strong>
                    <p className="mt-2 text-[13px] leading-6 text-muted">{h.desc}</p>
                  </div>
                );
              })}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="/templates"
                className="inline-flex h-11 items-center rounded-xl bg-navy px-4 text-[13px] font-extrabold text-white shadow-sm transition hover:bg-navy-2"
              >
                استعرض القوالب
              </a>
              <a
                href="/about"
                className="inline-flex h-11 items-center rounded-xl border border-line px-4 text-[13px] font-bold transition hover:bg-line-2 dark:border-white/10 dark:hover:bg-white/5"
              >
                عن المنصة
              </a>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {CTA_BADGES.map((badge) => (
                <span
                  key={badge}
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-bold text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300"
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />

      <FullVersionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}

