import { useState } from "react";
import {
  BookOpen,
  Brush,
  Grid3x3,
  Image as ImageIcon,
  Maximize2,
  Monitor,
  Ruler,
} from "lucide-react";
import {
  SIZE_PRESETS,
  pageSize,
  THEMES,
  type SizeId,
  type ThemeId,
} from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { applyInstitutionalBackground } from "@/lib/editor/institutional-backgrounds";
import { useInstitutionalBackgrounds } from "@/lib/editor/use-institutional-backgrounds";
import { cn } from "@/lib/utils";
import { ColorField } from "./ui/ColorField";
import { ScrubInput } from "./ui/ScrubInput";
import { PageBackground } from "./PageBackground";

const chip =
  "inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-line px-2 text-[11px] font-extrabold disabled:opacity-50";

interface DesignPreset {
  id: string;
  label: string;
  hint: string;
  theme: ThemeId;
  bg: string;
  swatch: string[];
}

/** Document design presets — theme + page paint as ONE decision. */
const DESIGN_PRESETS: DesignPreset[] = [
  {
    id: "white-official",
    label: "رسمي أبيض",
    hint: "سمة نَسَق على ورق أبيض",
    theme: "official",
    bg: "#ffffff",
    swatch: ["#006c35", "#c9a86a", "#ffffff"],
  },
  {
    id: "ministry",
    label: "وزاري هادئ",
    hint: "أزرق وزاري على ورق نقي",
    theme: "ministry",
    bg: "#ffffff",
    swatch: ["#12344d", "#b08a4f", "#ffffff"],
  },
  {
    id: "sand-report",
    label: "تقرير رملي",
    hint: "دفء رملي للوثائق الثقافية",
    theme: "sand",
    bg: "#fffdf8",
    swatch: ["#3f2e1f", "#c4a574", "#fffdf8"],
  },
  {
    id: "slate-brief",
    label: "عرض حديث",
    hint: "رمادي عصري للعروض التنفيذية",
    theme: "slate",
    bg: "#f8fafc",
    swatch: ["#1f2937", "#3b82c4", "#f8fafc"],
  },
  {
    id: "green-band",
    label: "خلفية خضراء",
    hint: "تدرّج أخضر ناعم للغلاف",
    theme: "official",
    bg: "#f3f8f4",
    swatch: ["#006c35", "#e7f2ea", "#f3f8f4"],
  },
  {
    id: "eid",
    label: "مناسبة رسمية",
    hint: "أخضر عيد ذهبي",
    theme: "eid",
    bg: "#ffffff",
    swatch: ["#0c3d2c", "#d4af37", "#ffffff"],
  },
];

/** Workspace (canvas) colours — the surface around the artboards. */
const CANVAS_SWATCHES: { id: string; label: string; color: string | null }[] = [
  { id: "auto", label: "تلقائي", color: null },
  { id: "slate", label: "رمادي مهني", color: "#4a5560" },
  { id: "graphite", label: "جرافيت", color: "#3a4149" },
  { id: "warm", label: "دافئ", color: "#5a5248" },
  { id: "light", label: "فاتح", color: "#e8eaee" },
  { id: "ink", label: "داكن جدًا", color: "#22272e" },
];

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-2 rounded-[10px] border border-line p-3">
      <header className="grid gap-0.5">
        <h3 className="inline-flex items-center gap-1.5 text-[12px] font-extrabold">
          {icon}
          {title}
        </h3>
        {hint && <p className="text-[10px] leading-4 text-muted">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

/**
 * «مظهر المستند» — the document-design panel.
 *
 * One professional surface for every REAL layout setting the editor supports:
 * design presets, page size/orientation, page & artboard backgrounds (colour,
 * gradient, image — including the institutional library), the canvas workspace
 * colour, print-guide margins, and document structure switches. Every control
 * is wired to an existing store action — nothing decorative.
 */
export function DocumentAppearancePanel() {
  const themeId = useEditor((s) => s.theme);
  const setTheme = useEditor((s) => s.setTheme);
  const activePageId = useEditor((s) => s.activePageId);
  const pages = useEditor((s) => s.pages);
  const setPageSize = useEditor((s) => s.setPageSize);
  const setAllPageSizes = useEditor((s) => s.setAllPageSizes);
  const setPageBackground = useEditor((s) => s.setPageBackground);
  const canvasColor = useEditor((s) => s.canvasColor);
  const setCanvasColor = useEditor((s) => s.setCanvasColor);
  const printGuides = useEditor((s) => s.printGuides);
  const togglePrintGuide = useEditor((s) => s.togglePrintGuide);
  const showGrid = useEditor((s) => s.showGrid);
  const snapGrid = useEditor((s) => s.snapGrid);
  const snapElements = useEditor((s) => s.snapElements);
  const showOutsidePage = useEditor((s) => s.showOutsidePage);
  const clipExport = useEditor((s) => s.clipExport);
  const toggle = useEditor((s) => s.toggle);
  const setShowOutsidePage = useEditor((s) => s.setShowOutsidePage);
  const setClipExport = useEditor((s) => s.setClipExport);
  const institutional = useInstitutionalBackgrounds();

  const page = pages.find((p) => p.id === activePageId) ?? pages[0];
  const size = page ? pageSize(page) : { w: 210, h: 297 };
  const [custom, setCustom] = useState({ w: size.w, h: size.h });
  const activeSizeId: SizeId =
    SIZE_PRESETS.find((s) => s.w === size.w && s.h === size.h)?.id ?? "custom";

  const applyPreset = (preset: DesignPreset) => {
    setTheme(preset.theme);
    if (!page) return;
    // ONE paint decision for the whole document: every page gets the preset's
    // paper, then a single history entry (live writes + commit).
    for (const p of pages) {
      setPageBackground(p.id, { bg: preset.bg, bgGradient: undefined }, true);
    }
    useEditor.getState().commit();
  };

  const copyBackgroundToAll = () => {
    if (!page) return;
    for (const p of pages) {
      if (p.id === page.id) continue;
      setPageBackground(
        p.id,
        {
          bg: page.bg,
          bgGradient: page.bgGradient,
          bgImage: page.bgImage,
          bgImageFit: page.bgImageFit,
          bgImageX: page.bgImageX,
          bgImageY: page.bgImageY,
        },
        true,
      );
    }
    useEditor.getState().commit();
  };

  const landscape = size.w > size.h;
  const setOrientation = (wantLandscape: boolean) => {
    if (wantLandscape === landscape) return;
    const w = Math.max(size.w, size.h);
    const h = Math.min(size.w, size.h);
    setPageSize(page.id, "custom", wantLandscape ? { w, h } : { w: h, h: w });
    setCustom({ w, h });
  };

  return (
    <div className="grid gap-3">
      <header>
        <h2 className="text-[13px] font-extrabold">مظهر المستند</h2>
        <p className="mt-1 text-[11px] leading-5 text-muted">
          تصميم الصفحة واللوحة والمساحة — كل إعداد هنا مفعّل فعليًا على المستند.
        </p>
      </header>

      {/* ── Presets ─────────────────────────────────────────────────────── */}
      <Section
        icon={<Brush className="size-4" />}
        title="تصاميم جاهزة"
        hint="سمة الألوان وخلفية كل الصفحات معًا — ابدأ من هنا."
      >
        <div className="grid grid-cols-2 gap-1.5">
          {DESIGN_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset)}
              className={cn(
                "rounded-[8px] border p-2 text-right",
                themeId === preset.theme && page?.bg === preset.bg
                  ? "border-navy-2 bg-navy-2/5"
                  : "border-line",
              )}
            >
              <span className="mb-1 flex h-4 overflow-hidden rounded">
                {preset.swatch.map((c, i) => (
                  <span key={i} className="flex-1" style={{ background: c }} />
                ))}
              </span>
              <strong className="block text-[11px]">{preset.label}</strong>
              <span className="block text-[10px] leading-4 text-muted">
                {preset.hint}
              </span>
            </button>
          ))}
        </div>
      </Section>

      {/* ── Page size & orientation ─────────────────────────────────────── */}
      <Section
        icon={<Ruler className="size-4" />}
        title="مقاس الصفحة والاتجاه"
        hint={`${size.w} × ${size.h} مم — الحجم يظهر مباشرة على اللوحة.`}
      >
        <div className="grid grid-cols-2 gap-1.5">
          {SIZE_PRESETS.filter((s) => s.id !== "custom").map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setPageSize(page.id, s.id);
                setCustom({ w: s.w, h: s.h });
              }}
              className={cn(
                "rounded-[8px] border px-2 py-1.5 text-right",
                activeSizeId === s.id ? "border-navy-2 bg-navy-2/5" : "border-line",
              )}
            >
              <strong className="block text-[11px]">{s.name}</strong>
              <span className="block text-[10px] text-muted">
                {s.w} × {s.h} مم
              </span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <ScrubInput
            label="العرض مم"
            value={custom.w}
            min={20}
            max={2000}
            step={1}
            precision={0}
            suffix="مم"
            onChange={(w) => setCustom((v) => ({ ...v, w }))}
            onCommit={(w) => setPageSize(page.id, "custom", { w, h: custom.h })}
          />
          <ScrubInput
            label="الارتفاع مم"
            value={custom.h}
            min={20}
            max={2000}
            step={1}
            precision={0}
            suffix="مم"
            onChange={(h) => setCustom((v) => ({ ...v, h }))}
            onCommit={(h) => setPageSize(page.id, "custom", { w: custom.w, h })}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={cn(chip, !landscape && "border-navy-2 bg-navy-2/5")}
            onClick={() => setOrientation(false)}
          >
            <Maximize2 className="size-3.5 rotate-90" /> رأسي
          </button>
          <button
            type="button"
            className={cn(chip, landscape && "border-navy-2 bg-navy-2/5")}
            onClick={() => setOrientation(true)}
          >
            <Maximize2 className="size-3.5" /> أفقي
          </button>
          <button
            type="button"
            className={chip}
            onClick={() => setAllPageSizes("custom", custom)}
          >
            تطبيق المقاس على كل الصفحات
          </button>
        </div>
      </Section>

      {/* ── Page & artboard backgrounds ─────────────────────────────────── */}
      {page && (
        <Section
          icon={<ImageIcon className="size-4" />}
          title="خلفيات الصفحة واللوحات"
          hint="لون، تدرّج أو صورة — بما فيها المكتبة المؤسسية."
        >
          <PageBackground page={page} />
          {institutional.items.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-extrabold text-muted">
                من المكتبة المؤسسية
              </p>
              <div className="flex flex-wrap gap-1.5">
                {institutional.items.slice(0, 8).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    title={item.name}
                    disabled={page.locked}
                    onClick={() =>
                      setPageBackground(
                        page.id,
                        applyInstitutionalBackground(page, item),
                      )
                    }
                    className="h-12 w-16 overflow-hidden rounded border border-line disabled:opacity-50"
                  >
                    <img src={item.src} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            type="button"
            className={chip}
            disabled={page.locked}
            onClick={copyBackgroundToAll}
          >
            نسخ خلفية هذه الصفحة إلى كل الصفحات
          </button>
        </Section>
      )}

      {/* ── Canvas workspace colour ─────────────────────────────────────── */}
      <Section
        icon={<Monitor className="size-4" />}
        title="لون مساحة العمل"
        hint="سطح اللوحة حول الصفحات — تفضيل للجهاز، لا يُحفظ في المستند."
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {CANVAS_SWATCHES.map((sw) => (
            <button
              key={sw.id}
              type="button"
              title={sw.label}
              aria-label={sw.label}
              aria-pressed={
                sw.color === null ? canvasColor === null : canvasColor === sw.color
              }
              onClick={() => setCanvasColor(sw.color)}
              className={cn(
                "size-8 rounded-lg border-2",
                (sw.color === null ? canvasColor === null : canvasColor === sw.color)
                  ? "border-navy"
                  : "border-line",
              )}
              style={
                sw.color
                  ? { background: sw.color }
                  : {
                      background:
                        "linear-gradient(135deg,#e8eaee 0%,#4a5560 100%)",
                    }
              }
            />
          ))}
          <ColorField
            value={canvasColor ?? undefined}
            fallback="#4a5560"
            label="لون مخصص"
            onChange={(v) => setCanvasColor(v)}
            onCommit={(v) => setCanvasColor(v)}
          />
          <button
            type="button"
            className={chip}
            onClick={() => setCanvasColor(null)}
          >
            إعادة التلقائي
          </button>
        </div>
      </Section>

      {/* ── Margins & print guides ──────────────────────────────────────── */}
      <Section
        icon={<Ruler className="size-4" />}
        title="الهوامش وأدلة الطباعة"
        hint="منطقة الآمنة، هامش التجليد والقت — مرئية على اللوحة ومحسوبة في الفحص."
      >
        <div className="grid gap-1.5">
          {(
            [
              ["safe", "المنطقة الآمنة", "10 مم من كل حافة"],
              ["gutter", "هامش التجليد", "15 مم للجانب المجلّد"],
              ["bleed", "القت (Bleed)", "3 مم خارج حدود القص"],
            ] as const
          ).map(([kind, label, hint]) => (
            <label
              key={kind}
              className="flex items-center justify-between gap-2 rounded-[8px] border border-line px-2.5 py-2"
            >
              <span>
                <strong className="block text-[11px]">{label}</strong>
                <span className="block text-[10px] text-muted">{hint}</span>
              </span>
              <input
                type="checkbox"
                checked={Boolean(printGuides[kind])}
                onChange={() => togglePrintGuide(kind)}
                className="size-4"
              />
            </label>
          ))}
        </div>
      </Section>

      {/* ── Structure & spacing ─────────────────────────────────────────── */}
      <Section
        icon={<Grid3x3 className="size-4" />}
        title="بنية المستند والمسافات"
        hint="سلوك اللوحة والتصدير — إعدادات حقيقية محفوظة مع مساحة العمل."
      >
        <div className="grid gap-1.5">
          {(
            [
              ["showGrid", showGrid, "إظهار الشبكة", "شبكة قياس على اللوحة"],
              ["snapGrid", snapGrid, "المحاذاة للشبكة", "جذب العناصر إلى الشبكة"],
              ["snapElements", snapElements, "المحاذاة للعناصر", "حواف ذكية بجانب العناصر"],
            ] as const
          ).map(([key, on, label, hint]) => (
            <label
              key={key}
              className="flex items-center justify-between gap-2 rounded-[8px] border border-line px-2.5 py-2"
            >
              <span>
                <strong className="block text-[11px]">{label}</strong>
                <span className="block text-[10px] text-muted">{hint}</span>
              </span>
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(key)}
                className="size-4"
              />
            </label>
          ))}
          <label className="flex items-center justify-between gap-2 rounded-[8px] border border-line px-2.5 py-2">
            <span>
              <strong className="block text-[11px]">إظهار ما خارج الصفحة</strong>
              <span className="block text-[10px] text-muted">
                عرض العناصر الممتدة خارج حدود اللوحة أثناء التحرير
              </span>
            </span>
            <input
              type="checkbox"
              checked={showOutsidePage}
              onChange={(e) => setShowOutsidePage(e.target.checked)}
              className="size-4"
            />
          </label>
          <label className="flex items-center justify-between gap-2 rounded-[8px] border border-line px-2.5 py-2">
            <span>
              <strong className="block text-[11px]">قص التصدير</strong>
              <span className="block text-[10px] text-muted">
                استبعاد ما يتدلى خارج الصفحة من ملفات التصدير
              </span>
            </span>
            <input
              type="checkbox"
              checked={clipExport !== false}
              onChange={(e) => setClipExport(e.target.checked)}
              className="size-4"
            />
          </label>
          {page && (
            <label className="flex items-center justify-between gap-2 rounded-[8px] border border-line px-2.5 py-2">
              <span>
                <strong className="block text-[11px]">قفل قص محتوى اللوحة</strong>
                <span className="block text-[10px] text-muted">
                  إخفاء أي طبقة تخرج عن حدود هذه الصفحة (العنصر يبقى في الملف)
                </span>
              </span>
              <input
                type="checkbox"
                checked={page.clipContent !== false}
                onChange={(e) =>
                  setPageBackground(page.id, { clipContent: e.target.checked })
                }
                className="size-4"
              />
            </label>
          )}
        </div>
      </Section>

      {/* ── Document identity (kept from the old theme tab) ─────────────── */}
      <Section
        icon={<BookOpen className="size-4" />}
        title="ألوان السمة"
        hint="السمة تُطبَّق على العناصر الجديدة والمُدرجة."
      >
        <div className="grid grid-cols-1 gap-1.5">
          {(Object.values(THEMES) as (typeof THEMES)[ThemeId][]).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              className={cn(
                "flex items-center gap-2 rounded-[8px] border p-2 text-right",
                themeId === t.id ? "border-navy-2 bg-navy-2/5" : "border-line",
              )}
            >
              <span className="flex h-6 w-12 shrink-0 overflow-hidden rounded border border-line">
                <span className="w-1/2" style={{ background: t.primary }} />
                <span className="w-1/3" style={{ background: t.accent }} />
                <span className="w-[16.6%]" style={{ background: t.surface }} />
              </span>
              <span className="min-w-0">
                <strong className="block text-[11px]">{t.name}</strong>
                <span className="block truncate text-[10px] text-muted">{t.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}
