import { useEffect, useRef } from "react";
import { ArrowLeft, BriefcaseBusiness, FileText, LayoutTemplate, Table2, FileDown, Palette, ShieldCheck, Workflow, Files } from "lucide-react";
import { toast } from "sonner";
import { PACKS } from "@/lib/editor/templates";
import { useEditor } from "@/lib/editor/store";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { ProjectCard } from "@/components/site/ProjectCard";
import { PRODUCT_COPY } from "@/lib/product/copy";
import { CARD_W, CARD_WRAP, SITE_CARD, iconTint } from "@/components/site/cards";

/**
 * Six capability cards (was four): the two extra entries carry the privacy
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

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const recent = projects.slice(0, 3);

  const openEditor = async (id: string) => {
    await openProject(id);
    window.location.assign("/editor");
  };

  return (
    <div className="min-h-full bg-paper dark:bg-[#111722]">
      <SiteHeader current="/" />

      <main>
        <section className="border-b border-line bg-white dark:border-white/10 dark:bg-[#161c26]">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:py-16 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
            <div>
            <p className="mb-3 text-[12px] font-bold tracking-[0.2em] text-green dark:text-gold-2">{PRODUCT_COPY.hero.eyebrow}</p>
            <h1 className="max-w-3xl text-[32px] font-extrabold leading-[1.3] sm:text-[48px]">{PRODUCT_COPY.hero.title}</h1>
            <p className="mt-5 max-w-2xl text-[16px] leading-8 text-muted sm:text-[18px] sm:leading-9">{PRODUCT_COPY.hero.description}</p>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => window.location.assign("/demo")}
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-navy px-5 text-[14px] font-extrabold text-white shadow-sm transition hover:bg-navy-2"
              >
                {PRODUCT_COPY.hero.primary}
                <ArrowLeft className="size-4" />
              </button>
              <a href="/purchase" className="inline-flex h-12 items-center gap-2 rounded-xl border border-line px-5 text-[14px] font-bold transition hover:bg-line-2 dark:border-white/10 dark:hover:bg-white/5">{PRODUCT_COPY.hero.secondary}</a>
              <a
                href="/projects"
                className="inline-flex h-12 items-center rounded-xl px-3 text-[14px] font-bold text-navy-2 underline decoration-line underline-offset-4 transition hover:decoration-navy-2 dark:text-gold-2"
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
            <div className="shadow-card dark:shadow-card-dark relative min-h-[280px] overflow-hidden rounded-2xl border border-line bg-[#f4f6f2] p-4 dark:border-white/10 dark:bg-[#252627]">
              <div className="absolute inset-x-4 top-4 flex items-center justify-between border-b border-[#d7e0d7] pb-3 dark:border-white/10"><span className="text-[10px] font-bold text-green">مساحة العرض التجريبي</span><span className="h-2 w-20 rounded-full bg-[#c6a05a]/60" /></div>
              <div className="absolute right-8 top-20 h-36 w-[48%] bg-white shadow-[0_14px_30px_rgba(15,23,42,.12)] dark:bg-[#f8faf8]"><span className="absolute inset-x-5 top-6 h-3 w-2/3 bg-[#0c3d2c]" /><span className="absolute inset-x-5 top-14 h-14 border border-[#d8e0db]" /><span className="absolute bottom-5 right-5 h-3 w-1/3 bg-[#c6a05a]/70" /></div>
              <div className="absolute bottom-8 left-8 grid gap-2 text-right"><span className="text-[11px] font-extrabold text-[#0c3d2c] dark:text-[#d7d8d9]">محرر التقارير</span><span className="max-w-[180px] text-[12px] leading-6 text-muted">قوالب، طبقات، مؤشرات، وتصدير في مساحة عمل واحدة.</span></div>
            </div>
          </div>
        </section>

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
                onClick={() => window.location.assign(pack.id === "blank" ? "/demo" : "/purchase")}
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
                <span className="mt-auto inline-flex pt-4 text-[11px] font-extrabold text-navy-2 dark:text-gold-2">{pack.id === "blank" ? "فتح العرض" : "متاح في النسخة الكاملة"}</span>
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
    </div>
  );
}

