import { useState } from "react";
import {
  Type,
  Image as ImageIcon,
  Shapes,
  Minus,
  Star,
  Table2,
  Square,
  SeparatorHorizontal,
  Stamp,
  QrCode,
  BadgePercent,
  LayoutTemplate,
  Palette,
  Settings2,
  Layers,
  Ruler,
  Gauge,
  FileCode2,
  FileText,
  Baseline,
  ChevronDown,
  Eye,
  X,
  FolderOpen,
} from "lucide-react";
import {
  SIZE_PRESETS,
  TEXT_PRESETS,
  THEMES,
  TYPE_NAME,
  pageSize,
  sizeIdOf,
  type CanvasEl,
  type ElType,
  type ThemeId,
} from "@/lib/editor/model";
import { SHAPES, shapesByGroup } from "@/lib/editor/shapes";

/** localStorage slot for the author's starred fonts. */
const FAVORITE_FONTS_KEY = "nasaq.font-favorites";
import { detectPlatform } from "@/lib/editor/fonts";
import {
  PAGE_TEMPLATES,
  TEMPLATE_CATEGORIES,
  type TemplateCategoryId,
} from "@/lib/editor/templates";
import { useEditor, type LeftTab } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { ShapePreview } from "./ShapePreview";
import { AccordionSection, useAccordionState } from "./ui/Accordion";
import { ScrubField } from "./ui/ScrubInput";
import { AssetLibrary } from "./AssetLibrary";
import { SmartLibraryPanel, TemplatePreview } from "./SmartLibrary";
import { TablePickerOverlay } from "./TablePicker";

const TABS: { id: LeftTab; label: string; icon: typeof Type }[] = [
  { id: "elements", label: "عناصر", icon: LayoutTemplate },
  { id: "shapes", label: "أشكال", icon: Shapes },
  { id: "library", label: "المكتبة", icon: FolderOpen },
  { id: "templates", label: "قوالب", icon: FileText },
  { id: "pages", label: "صفحات", icon: Layers },
  { id: "theme", label: "سمة", icon: Palette },
  { id: "fonts", label: "خطوط", icon: Baseline },
  { id: "settings", label: "إعدادات", icon: Settings2 },
];

const TOOL_GROUPS: {
  title: string;
  items: { type: ElType; label: string; icon: typeof Type }[];
}[] = [
  {
    title: "نص",
    items: [
      { type: "text", label: "نص", icon: Type },
      { type: "box", label: "مربع محتوى", icon: Square },
    ],
  },
  {
    title: "صور وشعارات",
    items: [
      { type: "image", label: "صورة", icon: ImageIcon },
      { type: "logo", label: "شعار", icon: BadgePercent },
      { type: "svg", label: "إضافة SVG من الجهاز", icon: FileCode2 },
      { type: "qr", label: "رمز QR", icon: QrCode },
    ],
  },
  {
    title: "جداول وإحصاءات",
    items: [
      { type: "table", label: "جدول", icon: Table2 },
      { type: "stat", label: "بطاقة رقم", icon: BadgePercent },
      { type: "progress", label: "شريط تقدم", icon: Gauge },
      { type: "stamp", label: "ختم", icon: Stamp },
    ],
  },
  {
    title: "خطوط وفواصل",
    items: [
      { type: "line", label: "خط", icon: Minus },
      { type: "divider", label: "فاصل", icon: SeparatorHorizontal },
      { type: "icon", label: "أيقونة", icon: Star },
    ],
  },
];

export function LeftPanel({
  onUpload,
  onUploadSvg,
  onAddCustomAsset,
}: {
  onUpload: (kind: "image" | "logo" | "font" | "library") => void;
  onUploadSvg: () => void;
  /** «+ إضافة» in the smart library: import an SVG as a reusable icon/divider. */
  onAddCustomAsset: (kind: "icon" | "divider") => void;
}) {
  const tab = useEditor((s) => s.leftTab);
  const setLeftTab = useEditor((s) => s.setLeftTab);
  const addElement = useEditor((s) => s.addElement);
  const addTemplatePage = useEditor((s) => s.addTemplatePage);
  const theme = useEditor((s) => s.theme);
  const setTheme = useEditor((s) => s.setTheme);
  const orgName = useEditor((s) => s.orgName);
  const setOrg = useEditor((s) => s.setOrg);
  const name = useEditor((s) => s.name);
  const setName = useEditor((s) => s.setName);
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const setActivePage = useEditor((s) => s.setActivePage);
  const setPageSize = useEditor((s) => s.setPageSize);
  const setAllPageSizes = useEditor((s) => s.setAllPageSizes);
  const addPage = useEditor((s) => s.addPage);
  const duplicatePage = useEditor((s) => s.duplicatePage);
  const deletePage = useEditor((s) => s.deletePage);
  const movePageById = useEditor((s) => s.movePageById);
  const renamePage = useEditor((s) => s.renamePage);
  const toggle = useEditor((s) => s.toggle);
  const showGrid = useEditor((s) => s.showGrid);
  const snapGrid = useEditor((s) => s.snapGrid);
  const snapElements = useEditor((s) => s.snapElements);
  const dark = useEditor((s) => s.dark);
  const storage = useEditor((s) => s.storage);

  const [category, setCategory] = useState<TemplateCategoryId | "all">("all");
  /*
   * Phase 7 — the smart library is a set of collapsible categories, so the
   * palette reads as an index instead of an endless wall of buttons. Shapes and
   * icons start open (the two the author reaches for first); the rest open on
   * demand and stay open for the session.
   */
  const library = useAccordionState<
    | "basics"
    | "shapes"
    | "icons"
    | "dividers"
    | "indicators"
    | "tables"
    | "templates"
  >("library", { shapes: true, icons: true });

  /*
   * Collapsible tool categories: only the first (نص) starts open, so the
   * palette reads as a short index instead of one long wall of buttons —
   * the author opens the group they need rather than scrolling past all of
   * them. Keys follow TOOL_GROUPS titles.
   */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    نص: true,
  });
  const toggleGroup = (title: string) =>
    setOpenGroups((state) => ({ ...state, [title]: !(state[title] ?? false) }));
  const [customSize, setCustomSize] = useState({ w: 210, h: 297 });
  const [qrBusy, setQrBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<
    (typeof PAGE_TEMPLATES)[number] | null
  >(null);

  const page = pages.find((p) => p.id === activePageId);
  const activeSizeId = sizeIdOf(page);

  const add = async (type: ElType) => {
    if (type === "image" || type === "logo") {
      onUpload(type);
      return;
    }
    // رسم SVG من الجهاز: opens the file picker (LeftPanel needs no input of
    // its own — the studio owns the <input> and the toast flow).
    if (type === "svg") {
      onUploadSvg();
      return;
    }
    if (type === "table") {
      // A table needs a shape (rows/columns) before it exists, so the palette
      // opens the builder rather than dropping an arbitrary 3×4 grid.
      setPickerOpen(true);
      return;
    }
    if (type === "qr") {
      const text = window.prompt("رابط أو نص الرمز", "https://") || "";
      if (!text.trim()) return;
      setQrBusy(true);
      try {
        const QRCode = (await import("qrcode")).default;
        const src = await QRCode.toDataURL(text, {
          margin: 1,
          width: 512,
          color: { dark: "#006c35", light: "#ffffff" },
        });
        addElement("qr", { content: text, src });
      } catch {
        // Encoding failures (an over-long payload) still leave a usable frame.
        addElement("qr", { content: text });
      } finally {
        setQrBusy(false);
      }
      return;
    }
    addElement(type);
  };

  const applyCustomSize = (scope: "page" | "all") => {
    const w = Math.max(20, Math.min(1000, customSize.w));
    const h = Math.max(20, Math.min(1000, customSize.h));
    if (scope === "all") setAllPageSizes("custom", { w, h });
    else if (page) setPageSize(page.id, "custom", { w, h });
  };

  const templates = PAGE_TEMPLATES.filter(
    (t) => category === "all" || t.category === category,
  );

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-line bg-white dark:border-white/10 dark:bg-[#161c26]">
      {/*
       * Tab strip (Phase 1): a horizontally scrollable row instead of a fixed
       * 8-column grid. At the panel's minimum width the old grid squeezed
       * labels under icons until they overlapped; the strip keeps every tab on
       * one line and scrolls when it cannot.
       */}
      <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-line p-1.5 dark:border-white/10">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setLeftTab(t.id)}
              title={t.label}
              className={cn(
                "grid h-12 min-w-[52px] flex-1 shrink-0 place-items-center gap-0.5 rounded-[8px] text-[9px] font-extrabold",
                tab === t.id
                  ? "bg-navy text-white"
                  : "text-muted hover:bg-line-2 dark:text-white/70 dark:hover:bg-white/5",
              )}
            >
              <Icon className="size-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="editor-pane-scroll editor-panel-body p-3">
        {tab === "elements" && (
          <div className="grid gap-3">
            {pickerOpen && (
              <TablePickerOverlay
                theme={THEMES[theme]}
                onClose={() => setPickerOpen(false)}
                onAdd={(over, style) => {
                  addElement("table", {
                    ...over,
                    style: { ...(over.style || {}), ...(style || {}) },
                  });
                  setPickerOpen(false);
                }}
              />
            )}

            {/* «عناصر أساسية» — text, images/logos and the code-bearing blocks. */}
            <AccordionSection
              title="عناصر أساسية"
              id="basics"
              open={library.isOpen("basics", false)}
              onToggle={() => library.toggle("basics")}
            >
              {TOOL_GROUPS.map((group) => (
                <section key={group.title}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.title)}
                    aria-expanded={openGroups[group.title] ?? false}
                    className="mb-2 flex w-full items-center justify-between text-[11px] font-extrabold tracking-wide text-muted transition hover:text-ink dark:hover:text-white"
                  >
                    {group.title}
                    <ChevronDown
                      className={cn(
                        "size-3.5 transition-transform",
                        (openGroups[group.title] ?? false)
                          ? "rotate-0"
                          : "-rotate-90",
                      )}
                    />
                  </button>
                  {(openGroups[group.title] ?? false) && (
                    <div className="grid grid-cols-2 gap-2">
                      {group.items.map((t) => {
                        const Icon = t.icon;
                        return (
                          <button
                            key={t.type}
                            type="button"
                            disabled={qrBusy && t.type === "qr"}
                            onClick={() => void add(t.type)}
                            /*
                             * Horizontal card: label and icon share one compact row
                             * instead of the icon towering over the label. The fixed
                             * 64px-tall vertical cards stacked seven rows tall and
                             * pushed every section below them out of view; at this
                             * height the whole palette fits with the quick-title
                             * section still on screen. Labels wrap when long (the
                             * SVG upload one does), so extra services can be added
                             * to TOOL_GROUPS later without a new layout.
                             */
                            className="flex min-h-[38px] items-center justify-between gap-2 rounded-[8px] border border-line px-2.5 py-1.5 text-start text-[11px] font-bold leading-snug transition hover:border-navy-2 hover:bg-navy-2/5 disabled:opacity-50 dark:border-white/10 dark:hover:border-gold/60"
                            title={TYPE_NAME[t.type]}
                          >
                            <span className="min-w-0">{t.label}</span>
                            <Icon className="size-4 shrink-0 text-navy-2 dark:text-gold-2" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {/* Upload lives inside its own category — the trailing duplicate
                    section (and the scroll it cost) is gone; the hint stays as a
                    muted caption under the merged buttons. */}
                  {group.title === "صور وشعارات" &&
                    (openGroups[group.title] ?? false) && (
                      <>
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => onUpload("image")}
                            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[8px] bg-navy text-[11px] font-extrabold text-white"
                          >
                            <ImageIcon className="size-3.5" /> رفع صورة
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpload("logo")}
                            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold dark:border-white/10"
                          >
                            <BadgePercent className="size-3.5" /> رفع شعار
                          </button>
                        </div>
                        <p className="mt-1.5 text-[10px] leading-5 text-muted">
                          أو اسحب الصورة وأفلتها على الصفحة مباشرة — تُضاف في
                          موضع الإفلات.
                        </p>
                      </>
                    )}
                </section>
              ))}
            </AccordionSection>

            {/* نصوص جاهزة — typography starters, kept with the basics palette. */}
            <section>
              <h3 className="mb-2 text-[11px] font-extrabold tracking-wide text-muted">
                نص سريع
              </h3>
              <div className="grid gap-2">
                {TEXT_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      addElement("text", {
                        content: p.sample,
                        w: p.w,
                        h: p.h,
                        name: p.label,
                        style: {
                          fontFamily: "Tajawal",
                          textAlign: "right",
                          color: THEMES[theme].ink,
                          ...p.style,
                        },
                      } as Partial<CanvasEl>)
                    }
                    className="flex items-center justify-between rounded-[8px] px-2.5 py-1.5 text-right transition hover:bg-line-2 dark:hover:bg-white/5"
                  >
                    <span className="text-[12px] font-bold">{p.label}</span>
                    <span className="text-[11px] text-muted">
                      {Math.round(Number(p.style.fontSize) || 12)}pt
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === "library" && (
          <>
            {/*
             * The smart library (Phase 7) lives with the assets, so «المكتبة» is
             * one shelf: ready-made elements behind accordions, then the files
             * the author uploaded. Both read the same store actions.
             */}
            <SmartLibraryPanel
              theme={theme}
              onAddCustomAsset={onAddCustomAsset}
              onOpenShapes={() => setLeftTab("shapes")}
              onOpenTemplates={() => setLeftTab("templates")}
              onPreviewTemplate={setPreviewTemplate}
            />
            <div className="mt-3 border-t border-line pt-3 dark:border-white/10">
              <AssetLibrary />
            </div>
          </>
        )}

        {tab === "shapes" && (
          <div className="grid gap-4">
            <header className="grid grid-cols-[1fr_auto] items-center gap-2">
              <div>
                <h2 className="text-[13px] font-extrabold">الأشكال</h2>
                <p className="mt-0.5 text-[11px] leading-5 text-muted">
                  انقر لإضافة الشكل، ثم عدّل التعبئة والإطار من لوحة الخصائص.
                </p>
              </div>
              <span className="text-[11px] text-muted tabular-nums">
                {SHAPES.length}
              </span>
            </header>

            {shapesByGroup().map((group) => (
              <section key={group.group}>
                <h3 className="mb-2 text-[11px] font-extrabold tracking-wide text-muted">
                  {group.group}
                </h3>
                <div className="grid grid-cols-4 gap-1.5">
                  {group.items.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        addElement("shape", {
                          name: s.label,
                          style: { fill: THEMES[theme].primary, shapeId: s.id },
                        })
                      }
                      title={s.label}
                      className="grid aspect-square place-items-center rounded-[8px] border border-line p-1.5 text-navy-2 transition hover:border-navy-2 hover:bg-navy-2/5 dark:border-white/10 dark:text-gold-2"
                    >
                      <ShapePreview
                        shapeId={s.id}
                        className="size-full max-h-8"
                      />
                    </button>
                  ))}
                </div>
              </section>
            ))}

            <section className="grid gap-1.5">
              <h3 className="text-[11px] font-extrabold tracking-wide text-muted">
                خطوط وفواصل
              </h3>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => addElement("line")}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold dark:border-white/10"
                >
                  <Minus className="size-3.5" /> خط
                </button>
                <button
                  type="button"
                  onClick={() => addElement("divider")}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold dark:border-white/10"
                >
                  <SeparatorHorizontal className="size-3.5" /> فاصل
                </button>
              </div>
            </section>
          </div>
        )}

        {tab === "fonts" && <FontsTab />}

        {tab === "templates" && (
          <div>
            <header className="mb-2.5">
              <h2 className="text-[13px] font-extrabold">صفحات جاهزة</h2>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                تُضاف كصفحة جديدة في المشروع الحالي — القالب الأصلي لا يتغير.
              </p>
            </header>
            <div className="mb-3 flex flex-wrap gap-1.5">
              <CategoryChip
                active={category === "all"}
                onClick={() => setCategory("all")}
                label="الكل"
              />
              {TEMPLATE_CATEGORIES.map((c) => (
                <CategoryChip
                  key={c.id}
                  active={category === c.id}
                  onClick={() => setCategory(c.id)}
                  label={c.title}
                />
              ))}
            </div>
            <div className="grid gap-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setPreviewTemplate(t)}
                  className="grid grid-cols-[72px_1fr_auto] items-center gap-2 rounded-[8px] border border-line p-2 text-right transition hover:border-navy-2 hover:bg-navy-2/5 dark:border-white/10"
                >
                  <TemplatePreview variant={t.preview} />
                  <span className="min-w-0">
                    <strong className="block text-[12px]">{t.title}</strong>
                    {t.concept && (
                      <span className="block text-[9px] font-bold uppercase tracking-wide text-green">
                        {t.concept}
                      </span>
                    )}
                    <span className="block text-[11px] leading-4 text-muted">
                      {t.desc}
                    </span>
                  </span>
                  <Eye className="size-3.5 shrink-0 text-muted" />
                </button>
              ))}
              {!templates.length && (
                <p className="rounded-[8px] border border-dashed border-line p-4 text-center text-[12px] text-muted">
                  لا قوالب في هذا التصنيف
                </p>
              )}
            </div>
            {previewTemplate && (
              <div
                className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-4"
                role="dialog"
                aria-modal="true"
                aria-label={`معاينة ${previewTemplate.title}`}
                onClick={() => setPreviewTemplate(null)}
              >
                <div
                  className="w-full max-w-sm rounded-[10px] border border-line bg-white p-3 shadow-2xl dark:border-white/10 dark:bg-[#303132]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-[14px] font-extrabold">
                        {previewTemplate.title}
                      </h3>
                      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-green">
                        {previewTemplate.concept || "Template"}
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-muted">
                        {previewTemplate.desc}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreviewTemplate(null)}
                      className="grid size-7 place-items-center rounded-[6px] border border-line dark:border-white/10"
                      title="إغلاق المعاينة"
                      aria-label="إغلاق المعاينة"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <TemplatePreview variant={previewTemplate.preview} large />
                  <button
                    type="button"
                    onClick={() => {
                      addTemplatePage(previewTemplate.id);
                      setPreviewTemplate(null);
                    }}
                    className="mt-3 h-9 w-full rounded-[7px] bg-navy text-[11px] font-extrabold text-white"
                  >
                    إضافة القالب كصفحة قابلة للتحرير
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "pages" && (
          <div className="grid gap-3">
            <header className="flex items-center justify-between">
              <h2 className="text-[13px] font-extrabold">الصفحات</h2>
              <span className="text-[11px] text-muted tabular-nums">
                {pages.length}
              </span>
            </header>
            <div className="grid gap-2">
              {pages.map((p, i) => (
                <div
                  key={p.id}
                  className={cn(
                    "rounded-[8px] border p-2",
                    p.id === activePageId
                      ? "border-navy-2 bg-navy-2/5"
                      : "border-line dark:border-white/10",
                  )}
                >
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <span className="grid size-5 shrink-0 place-items-center rounded bg-line-2 text-[10px] font-extrabold text-muted dark:bg-white/10">
                      {i + 1}
                    </span>
                    <input
                      value={p.name}
                      onChange={(e) => renamePage(p.id, e.target.value)}
                      onFocus={() => setActivePage(p.id)}
                      aria-label={`اسم الصفحة ${i + 1}`}
                      className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-[12px] font-bold hover:border-line focus:border-navy-2 focus:bg-white dark:focus:bg-white/5"
                    />
                  </div>
                  <p className="mb-2 text-[10px] text-muted tabular-nums">
                    {Math.round(pageSize(p).w)} × {Math.round(pageSize(p).h)} مم
                    · {p.elements.length} عنصر
                  </p>
                  <div className="grid grid-cols-4 gap-1">
                    <MiniButton onClick={() => duplicatePage(p.id)} label="نسخ">
                      نسخ
                    </MiniButton>
                    <MiniButton
                      onClick={() => movePageById(p.id, -1)}
                      label="تحريك لأعلى"
                      disabled={i === 0}
                    >
                      ↑
                    </MiniButton>
                    <MiniButton
                      onClick={() => movePageById(p.id, 1)}
                      label="تحريك لأسفل"
                      disabled={i === pages.length - 1}
                    >
                      ↓
                    </MiniButton>
                    <MiniButton
                      onClick={() => deletePage(p.id)}
                      label="حذف الصفحة"
                      danger
                    >
                      حذف
                    </MiniButton>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => addPage()}
              className="h-10 rounded-[8px] bg-navy text-[12px] font-extrabold text-white"
            >
              إضافة صفحة
            </button>
            <p className="text-[11px] leading-5 text-muted">
              لإعادة الترتيب بالسحب والإفلات، استخدم شريط الصفحات أسفل منطقة
              التصميم.
            </p>
          </div>
        )}

        {tab === "theme" && (
          <div>
            <header className="mb-2.5">
              <h2 className="text-[13px] font-extrabold">سمة المستند</h2>
            </header>
            <label className="mb-3 block text-[11px] font-extrabold text-muted">
              اسم المشروع
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 h-9 w-full rounded-[8px] border border-line bg-white px-2.5 text-[13px] font-semibold text-ink dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </label>
            <label className="mb-3 block text-[11px] font-extrabold text-muted">
              اسم الجهة
              <input
                value={orgName}
                onChange={(e) => setOrg(e.target.value)}
                placeholder="اسم الجهة أو العميل"
                className="mt-1 h-9 w-full rounded-[8px] border border-line bg-white px-2.5 text-[13px] font-semibold text-ink dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </label>
            <div className="grid gap-2">
              {(Object.values(THEMES) as (typeof THEMES)[ThemeId][]).map(
                (t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTheme(t.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-[8px] border p-2.5 text-right",
                      theme === t.id
                        ? "border-navy-2 bg-navy-2/5"
                        : "border-line dark:border-white/10",
                    )}
                  >
                    <span className="flex size-9 shrink-0 overflow-hidden rounded-md border border-line">
                      <span
                        className="w-1/2"
                        style={{ background: t.primary }}
                      />
                      <span
                        className="w-1/3"
                        style={{ background: t.accent }}
                      />
                      <span
                        className="w-[16.6%]"
                        style={{ background: t.surface }}
                      />
                    </span>
                    <span className="min-w-0">
                      <strong className="block text-[12px]">{t.name}</strong>
                      <span className="text-[11px] text-muted">{t.desc}</span>
                    </span>
                  </button>
                ),
              )}
            </div>
            <p className="mt-3 text-[11px] leading-5 text-muted">
              السمة تُطبَّق على العناصر الجديدة والقوالب المُدرجة. العناصر
              الحالية تحتفظ بألوانها.
            </p>
          </div>
        )}

        {tab === "settings" && (
          <div className="grid gap-4">
            <section>
              <h2 className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-extrabold">
                <Ruler className="size-4" /> مقاس الصفحة
              </h2>
              <div className="grid gap-1.5">
                {SIZE_PRESETS.filter((s) => s.id !== "custom").map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => page && setPageSize(page.id, s.id)}
                    className={cn(
                      "rounded-[8px] border px-2.5 py-2 text-right",
                      activeSizeId === s.id
                        ? "border-navy-2 bg-navy-2/5"
                        : "border-line dark:border-white/10",
                    )}
                  >
                    <strong className="block text-[12px]">{s.name}</strong>
                    <span className="text-[11px] text-muted">{s.desc}</span>
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <ScrubField
                  label="العرض مم"
                  value={customSize.w}
                  min={20}
                  max={2000}
                  step={1}
                  precision={0}
                  suffix="مم"
                  onChange={(w) => setCustomSize((v) => ({ ...v, w }))}
                />
                <ScrubField
                  label="الارتفاع مم"
                  value={customSize.h}
                  min={20}
                  max={2000}
                  step={1}
                  precision={0}
                  suffix="مم"
                  onChange={(h) => setCustomSize((v) => ({ ...v, h }))}
                />
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => applyCustomSize("page")}
                  className="h-9 rounded-[8px] border border-line text-[11px] font-extrabold dark:border-white/10"
                >
                  تطبيق على الصفحة
                </button>
                <button
                  type="button"
                  onClick={() => applyCustomSize("all")}
                  className="h-9 rounded-[8px] border border-line text-[11px] font-extrabold dark:border-white/10"
                >
                  تطبيق على الكل
                </button>
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[13px] font-extrabold">
                الدقة والمحاذاة
              </h2>
              <div className="grid gap-1.5">
                <ToggleRow
                  label="إظهار الشبكة"
                  value={showGrid}
                  onChange={() => toggle("showGrid")}
                />
                <ToggleRow
                  label="التقاط للشبكة"
                  value={snapGrid}
                  onChange={() => toggle("snapGrid")}
                />
                <ToggleRow
                  label="محاذاة العناصر"
                  value={snapElements}
                  onChange={() => toggle("snapElements")}
                />
                <ToggleRow
                  label="الوضع الليلي"
                  value={dark}
                  onChange={() => toggle("dark")}
                />
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[13px] font-extrabold">مكتبة الخطوط</h2>
              <p className="text-[11px] leading-5 text-muted">
                ثمانية خطوط عربية مضمّنة (Tajawal، Cairo، IBM Plex Sans Arabic،
                Noto Sans/Naskh/Kufi، Amiri، Reem Kufi)، مع إمكانية رفع خط مخصص
                بصيغة TTF/OTF/WOFF.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-[13px] font-extrabold">التخزين</h2>
              <p className="text-[11px] leading-5 text-muted">
                {storage.mode === "indexeddb"
                  ? "المشاريع محفوظة محلياً في IndexedDB داخل متصفحك ولا تُرفع إلى أي سيرفر."
                  : "IndexedDB غير متاح في هذا المتصفح؛ يتم الحفظ في LocalStorage بمساحة محدودة."}
              </p>
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * Font library: bundled families, faces found on this device, and anything the
 * author uploaded. Applying a font here updates the selected text element, so
 * the panel doubles as the properties shortcut for typography.
 */
function FontsTab() {
  const choices = useEditor((s) => s.fontChoices);
  const probed = useEditor((s) => s.fontsProbed);
  const selectedId = useEditor((s) => s.selectedId);
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const updateStyle = useEditor((s) => s.updateStyle);
  const [query, setQuery] = useState("");
  /*
   * Starred fonts. Saved to localStorage so favourites survive a reload —
   * the same "UX cache" contract as the rest of the editor's UI prefs.
   */
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(FAVORITE_FONTS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.filter((x) => typeof x === "string")
        : [];
    } catch {
      return [];
    }
  });

  const toggleFavorite = (family: string) => {
    setFavorites((prev) => {
      const next = prev.includes(family)
        ? prev.filter((f) => f !== family)
        : [...prev, family];
      try {
        localStorage.setItem(FAVORITE_FONTS_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — favourites stay for this session only */
      }
      return next;
    });
  };

  const page = pages.find((p) => p.id === activePageId);
  const selected = page?.elements.find((e) => e.id === selectedId);
  const current = selected?.style.fontFamily;
  const matching = choices.filter((f) =>
    f.family.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  // Favourites first (in star order), then everything else by source.
  const favoriteSet = new Set(favorites);
  const favs = matching.filter((f) => favoriteSet.has(f.family));
  const rest = matching.filter((f) => !favoriteSet.has(f.family));
  const bundled =
    favs.length || rest.length
      ? [...favs, ...rest.filter((f) => f.source === "bundled")]
      : rest.filter((f) => f.source === "bundled");
  const system = rest.filter((f) => f.source === "system");
  const uploaded = rest.filter((f) => f.source === "uploaded");

  const apply = (family: string) => {
    if (!selected) return;
    updateStyle(selected.id, { fontFamily: family });
  };

  const group = (title: string, items: typeof choices, hint?: string) =>
    items.length > 0 && (
      <section key={title}>
        <h3 className="mb-2 text-[11px] font-extrabold tracking-wide text-muted">
          {title}
        </h3>
        {hint && (
          <p className="mb-1.5 text-[10px] leading-4 text-muted">{hint}</p>
        )}
        <div className="grid gap-1.5">
          {items.map((f) => {
            const fav = favoriteSet.has(f.family);
            return (
              <button
                key={f.family}
                type="button"
                disabled={!selected}
                onClick={() => apply(f.family)}
                title={selected ? `تطبيق ${f.family}` : "اختر عنصر نص أولاً"}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-[8px] border px-2.5 py-2 text-right disabled:opacity-55",
                  current === f.family
                    ? "border-navy-2 bg-navy-2/5"
                    : "border-line hover:border-navy-2 dark:border-white/10",
                )}
              >
                <span className="min-w-0">
                  <span
                    className="block truncate text-[13px]"
                    style={{
                      fontFamily: `"${f.family.replace(/"/g, "")}", sans-serif`,
                    }}
                  >
                    {f.family}
                  </span>
                  <span className="block truncate text-[10px] text-muted">
                    {f.note}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {/* Star toggle: works even without a text selection, so the
                      author can organise the list before picking an element. */}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={
                      fav
                        ? `إزالة ${f.family} من المفضلة`
                        : `إضافة ${f.family} إلى المفضلة`
                    }
                    aria-pressed={fav}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(f.family);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleFavorite(f.family);
                      }
                    }}
                    className={cn(
                      "grid size-6 place-items-center rounded-[6px]",
                      fav
                        ? "text-amber-500"
                        : "text-muted/50 hover:text-amber-500",
                    )}
                  >
                    <Star className={cn("size-3.5", fav && "fill-amber-400")} />
                  </span>
                  {current === f.family && (
                    <span className="text-[10px] font-extrabold text-navy-2">
                      مُطبَّق
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    );

  return (
    <div className="grid gap-4">
      <header>
        <h2 className="text-[13px] font-extrabold">مكتبة الخطوط</h2>
        <p className="mt-1 text-[11px] leading-5 text-muted">
          {probed
            ? `تم فحص خطوط هذا الجهاز (${detectPlatform()}). انقر على أي خط لتطبيقه على العنصر المحدد.`
            : "جارٍ فحص خطوط الجهاز…"}
        </p>
      </header>

      <label className="grid gap-1 text-[11px] font-extrabold text-muted">
        البحث في الخطوط
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="اكتب اسم الخط"
          className="h-9 rounded-[8px] border border-line bg-white px-2.5 text-[12px] font-semibold text-ink outline-none focus:border-navy-2 dark:border-white/10 dark:bg-white/5 dark:text-white"
        />
      </label>

      {!selected && (
        <p className="rounded-[8px] border border-dashed border-line p-3 text-[11px] leading-5 text-muted">
          حدّد عنصر نص على الصفحة لتفعيل تطبيق الخطوط. يمكنك تصفّح القائمة الآن.
        </p>
      )}

      {group(
        "خطوط مضمّنة",
        bundled,
        "تُحمَّل مع المنصة وتظهر بنفس الشكل على أي جهاز.",
      )}
      {group(
        "خطوط جهازك",
        system,
        "خطوط مثبّتة على هذا الجهاز — قد لا تتوفر على جهاز آخر.",
      )}
      {group("خطوط مرفوعة", uploaded, "خطوط أضفتها أنت في هذا المتصفح.")}

      <p className="text-[10px] leading-5 text-muted">
        تعتمد القائمة على الخطوط المضمّنة وما يستطيع المتصفح التحقق منه على هذا
        الجهاز. قد لا تتوفر خطوط الجهاز على أجهزة أخرى.
      </p>
    </div>
  );
}

function MiniButton({
  onClick,
  label,
  danger,
  disabled,
  children,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "h-7 rounded-[6px] border text-[10px] font-extrabold disabled:opacity-40",
        danger
          ? "border-red-200 text-danger hover:bg-red-50"
          : "border-line text-muted hover:border-navy-2 hover:text-ink dark:border-white/10 dark:text-white/70",
      )}
    >
      {children}
    </button>
  );
}

function CategoryChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] font-bold",
        active
          ? "border-navy-2 bg-navy-2 text-white"
          : "border-line text-muted dark:border-white/10",
      )}
    >
      {label}
    </button>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={value}
      className="flex items-center justify-between rounded-[8px] border border-line px-2.5 py-2 text-[12px] font-bold dark:border-white/10"
    >
      <span>{label}</span>
      <span
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          value ? "bg-navy-2" : "bg-line",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-white shadow transition-all",
            value ? "right-0.5" : "right-[18px]",
          )}
        />
      </span>
    </button>
  );
}
