import { useEffect, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";
import { PACKS, PAGE_TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategoryId } from "@/lib/editor/templates";
import { SIZE_PRESETS, THEMES, pageSize, type PackId } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { cn } from "@/lib/utils";
import { canUseDemoPack } from "@/lib/product/product";
import { useLicense } from "@/lib/license/client";
import { useMemo } from "react";

const SIZE_OPTIONS = SIZE_PRESETS.filter((s) => s.id !== "custom");

export function TemplatesPage() {
  const hydrate = useEditor((s) => s.hydrate);
  const createProject = useEditor((s) => s.createProject);
  const [category, setCategory] = useState<TemplateCategoryId | "all">("all");
  const [theme, setTheme] = useState<keyof typeof THEMES>("official");

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const templates = useMemo(
    () => PAGE_TEMPLATES.filter((t) => category === "all" || t.category === category),
    [category],
  );

  const { entitlements } = useLicense();

  const startFrom = async (packId: string) => {
    if (!canUseDemoPack(packId) && !entitlements.premium_templates) {
      window.location.assign("/license");
      return;
    }
    const pack = PACKS.find((p) => p.id === packId);
    const created = await createProject(packId as PackId, theme);
    if (created) {
      toast.success(`تم إنشاء «${pack?.title || packId}»`);
      window.location.assign("/editor");
    }
  };

  return (
    <div className="min-h-full bg-paper dark:bg-[#111722]">
      <SiteHeader current="/templates" />

      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="text-[26px] font-extrabold">القوالب</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-7 text-muted">
          اختر قالب بداية لإنشاء مشروع كامل، أو انتقل إلى المحرر وأضف صفحات جاهزة من تصنيفات القوالب.
          أي قالب تختاره ينشئ نسخة جديدة — القالب الأصلي لا يتغير.
        </p>

        <section className="mt-8">
          <h2 className="text-[17px] font-extrabold">مشاريع جاهزة</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {SIZE_OPTIONS.map((s) => (
              <span
                key={s.id}
                className="rounded-full border border-line px-3 py-1.5 text-[11px] font-bold text-muted dark:border-white/10"
              >
                {s.name} — {s.w} × {s.h} مم
              </span>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PACKS.map((pack) => (
              <div
                key={pack.id}
                className="flex flex-col rounded-[12px] border border-line bg-white p-5 dark:border-white/10 dark:bg-white/5"
              >
                <strong className="text-[15px] font-extrabold">{pack.title}</strong>
                <span className="mt-1 text-[12px] leading-6 text-muted">{pack.desc}</span>
                <span className="mt-2 text-[11px] font-bold text-muted">{pack.pages}</span>
                <button
                  type="button"
                  onClick={() => void startFrom(pack.id)}
                  className="mt-4 inline-flex h-10 items-center justify-center gap-1.5 rounded-[8px] bg-navy text-[12px] font-extrabold text-white"
                >
                  <Plus className="size-3.5" />
                  {canUseDemoPack(pack.id) || entitlements.premium_templates ? "بدء العرض من هذا القالب" : "متاح في النسخة الكاملة"}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-[17px] font-extrabold">صفحات داخل التقرير</h2>
          <p className="mt-1 text-[13px] text-muted">
            هذه الصفحات تُضاف داخل مشروع مفتوح من تبويب «قوالب» في المحرر.
          </p>

          <div className="mt-4 flex flex-wrap gap-1.5">
            <Chip active={category === "all"} onClick={() => setCategory("all")} label="الكل" />
            {TEMPLATE_CATEGORIES.map((c) => (
              <Chip
                key={c.id}
                active={category === c.id}
                onClick={() => setCategory(c.id)}
                label={c.title}
              />
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {(Object.keys(THEMES) as (keyof typeof THEMES)[]).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id)}
                aria-pressed={theme === id}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold",
                  theme === id ? "border-navy bg-navy text-white" : "border-line text-muted dark:border-white/10",
                )}
              >
                <span className="size-3 rounded-full" style={{ background: THEMES[id].primary }} />
                {THEMES[id].name}
              </button>
            ))}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => {
              const size = pageSize({ w: t.size?.w, h: t.size?.h });
              const basePalette = THEMES[theme];
              const palette = theme === "official" && t.preview
                ? { ...basePalette, primary: "#0c3d2c", primarySoft: "#145c42", accent: "#c6a05a" }
                : basePalette;
              return (
                <div key={t.id} className="rounded-[12px] border border-line bg-white p-4 dark:border-white/10 dark:bg-white/5">
                  <TemplateCardPreview variant={t.preview} palette={palette} aspectRatio={`${size.w} / ${size.h}`} />
                  <strong className="block text-[14px] font-extrabold">{t.title}</strong>
                  {t.concept && <span className="mt-1 block text-[9px] font-bold uppercase tracking-wide text-green">{t.concept}</span>}
                  <span className="mt-1 block text-[12px] leading-6 text-muted">{t.desc}</span>
                  <span className="mt-2 block text-[11px] font-bold text-muted tabular-nums">
                    {Math.round(size.w)} × {Math.round(size.h)} مم
                  </span>
                </div>
              );
            })}
          </div>

          <a
            href="/editor"
            className="mt-8 inline-flex h-11 items-center gap-2 rounded-[10px] bg-navy px-4 text-[13px] font-extrabold text-white"
          >
            اذهب إلى المحرر لإدراج القوالب
            <ArrowLeft className="size-4" />
          </a>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function TemplateCardPreview({
  variant = "grid",
  palette,
  aspectRatio,
}: {
  variant?: string;
  palette: (typeof THEMES)[keyof typeof THEMES];
  aspectRatio: string;
}) {
  const green = palette.primary;
  const gold = palette.accent;
  const line = palette.line;
  const common = "absolute block";
  return (
    <span className="relative mb-3 block overflow-hidden rounded-[6px] border border-line bg-white" style={{ aspectRatio }}>
      {variant === "editorial" && <><span className={common} style={{ right: "9%", top: "12%", width: "43%", height: "5%", background: green }} /><span className={common} style={{ right: "9%", top: "23%", width: "64%", height: "16%", background: palette.ink }} /><span className={common} style={{ right: "9%", top: "50%", width: "44%", height: "25%", border: `1px solid ${line}` }} /><span className={common} style={{ left: "12%", top: "45%", width: "15%", height: "18%", background: green }} /></>}
      {variant === "grid" && <><span className={common} style={{ inset: "0 0 auto", height: "18%", background: green }} /><span className={common} style={{ right: "8%", top: "25%", width: "38%", height: "23%", border: `1px solid ${line}` }} /><span className={common} style={{ left: "8%", top: "25%", width: "38%", height: "23%", border: `1px solid ${line}` }} /><span className={common} style={{ right: "8%", bottom: "12%", width: "38%", height: "22%", background: palette.surface, border: `1px solid ${line}` }} /><span className={common} style={{ left: "8%", bottom: "12%", width: "38%", height: "22%", background: palette.surface, border: `1px solid ${line}` }} /></>}
      {variant === "data" && <><span className={common} style={{ right: "8%", top: "16%", width: "45%", height: "26%", background: green }} /><span className={common} style={{ left: "8%", top: "15%", width: "25%", height: "22%", background: palette.ink }} /><span className={common} style={{ right: "8%", bottom: "16%", width: "84%", height: "30%", border: `1px solid ${line}` }} /><span className={common} style={{ left: "17%", bottom: "21%", width: "7%", height: "15%", background: gold }} /><span className={common} style={{ left: "29%", bottom: "21%", width: "7%", height: "24%", background: green }} /></>}
      {variant === "flow" && <><span className={common} style={{ right: "9%", top: "12%", width: "55%", height: "5%", background: green }} /><span className={common} style={{ right: "9%", top: "28%", width: "76%", height: "12%", border: `1px solid ${line}` }} /><span className={common} style={{ right: "18%", top: "46%", width: "67%", height: "14%", background: palette.surface, border: `1px solid ${line}` }} /><span className={common} style={{ right: "27%", top: "66%", width: "58%", height: "16%", border: `1px solid ${line}` }} /></>}
      {variant === "asymmetric" && <><span className={common} style={{ inset: "0 auto 0 0", width: "30%", background: green }} /><span className={common} style={{ right: "8%", top: "20%", width: "52%", height: "16%", background: palette.ink }} /><span className={common} style={{ right: "12%", top: "47%", width: "27%", height: "18%", background: gold }} /><span className={common} style={{ right: "8%", bottom: "12%", width: "55%", height: "16%", border: `1px solid ${line}` }} /></>}
      {variant === "modular" && <><span className={common} style={{ right: "8%", top: "15%", width: "48%", height: "27%", border: `1px solid ${line}` }} /><span className={common} style={{ left: "8%", top: "15%", width: "31%", height: "16%", background: green }} /><span className={common} style={{ left: "8%", top: "36%", width: "31%", height: "30%", border: `1px solid ${line}` }} /><span className={common} style={{ right: "8%", bottom: "14%", width: "70%", height: "18%", background: palette.surface }} /></>}
      {variant === "executive" && <><span className={common} style={{ left: "44%", top: "12%", width: "12%", height: "8%", borderRadius: "50%", background: gold }} /><span className={common} style={{ right: "20%", top: "31%", width: "60%", height: "9%", background: green }} /><span className={common} style={{ right: "28%", top: "48%", width: "44%", height: "14%", border: `1px solid ${line}` }} /><span className={common} style={{ left: "36%", bottom: "13%", width: "28%", height: "13%", background: palette.ink }} /></>}
      {variant === "statistical" && <><span className={common} style={{ right: "8%", top: "15%", width: "40%", height: "22%", background: green }} /><span className={common} style={{ left: "8%", top: "16%", width: "23%", height: "15%", background: palette.ink }} /><span className={common} style={{ left: "13%", bottom: "17%", width: "74%", height: "28%", borderBottom: `2px solid ${line}` }} /><span className={common} style={{ left: "20%", bottom: "17%", width: "6%", height: "16%", background: green }} /><span className={common} style={{ left: "34%", bottom: "17%", width: "6%", height: "24%", background: gold }} /></>}
      {variant === "section" && <><span className={common} style={{ right: "8%", top: "17%", width: "76%", height: "26%", background: green }} /><span className={common} style={{ right: "8%", top: "56%", width: "48%", height: "8%", background: palette.ink }} /><span className={common} style={{ right: "8%", top: "71%", width: "33%", height: "5%", background: palette.muted }} /><span className={common} style={{ left: "10%", bottom: "13%", width: "10%", height: "10%", background: gold, borderRadius: "50%" }} /></>}
      {variant === "process" && <><span className={common} style={{ right: "8%", top: "18%", width: "80%", height: "5%", background: green }} /><span className={common} style={{ right: "74%", top: "13%", width: "12%", height: "12%", borderRadius: "50%", background: green }} /><span className={common} style={{ right: "51%", top: "13%", width: "12%", height: "12%", borderRadius: "50%", border: `1px solid ${green}` }} /><span className={common} style={{ right: "28%", top: "13%", width: "12%", height: "12%", borderRadius: "50%", border: `1px solid ${green}` }} /><span className={common} style={{ right: "8%", top: "13%", width: "12%", height: "12%", borderRadius: "50%", border: `1px solid ${green}` }} /><span className={common} style={{ right: "8%", bottom: "16%", width: "70%", height: "20%", border: `1px solid ${line}` }} /></>}
    </span>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[12px] font-bold",
        active ? "border-navy bg-navy text-white" : "border-line text-muted dark:border-white/10",
      )}
    >
      {label}
    </button>
  );
}