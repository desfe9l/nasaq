/*
 * «إنشاء مستند جديد» — the configuration step between Home and the editor.
 *
 * Every field starts on a sensible default (one A4 portrait page, the official
 * theme, the organisation name of the last document), so «إنشاء وفتح المحرر»
 * works with no configuration at all. The live preview on the side is painted
 * from the exact `Project` that will be created (`buildNewDocument`), and the
 * store's `createDocument` persists it through the one project library.
 *
 * Shared by the licensed Home and the editor's account menu, so a new document
 * is configured the same way wherever it is started.
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  FileText,
  LayoutTemplate,
  Loader2,
  Minus,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
} from "lucide-react";
import { THEMES, pageSize, type ThemeId } from "@/lib/editor/model";
import { PACKS } from "@/lib/editor/templates";
import { useEditor } from "@/lib/editor/store";
import { DEMO_LICENSE } from "@/lib/product/product";
import {
  BLANK_BACKGROUNDS,
  DOC_KINDS,
  MAX_CUSTOM_MM,
  MAX_NEW_PAGES,
  MIN_CUSTOM_MM,
  PAGE_SIZES,
  PRESET_ORIENTATION,
  STARTER_PACKS,
  blankBackground,
  buildNewDocument,
  clampPages,
  defaultDocumentName,
  defaultNewDocument,
  describeConfig,
  docKind,
  pageDimensions,
  pagesText,
  presetIsSquare,
  type BlankContent,
  type NewDocumentConfig,
  type Orientation,
  type PageSizeId,
} from "@/lib/editor/new-document";
import {
  LENGTH_UNITS,
  LENGTH_UNIT_LABELS,
  describeSize,
  fromMm,
  loadLengthUnit,
  roundUnit,
  saveLengthUnit,
  toMm,
  type LengthUnit,
} from "@/lib/editor/page-units";
import { cn } from "@/lib/utils";
import { DialogHeader, GHOST_BTN, Modal, PRIMARY_BTN } from "./TemplateDialogs";
import { TemplatePreview } from "./TemplatePreview";

const THEME_ORDER: ThemeId[] = ["official", "ministry", "slate", "sand", "eid"];

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[12px] font-extrabold text-ink">
          {title}
        </h3>
        {hint && (
          <span className="text-[11px] font-semibold text-muted">{hint}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/** A selectable tile — one look for every choice in the dialog. */
function Choice({
  active,
  onClick,
  children,
  className,
  label,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "rounded-lg border text-right transition-all duration-150",
        active
          ? "border-brand bg-navy/[0.06] ring-2 ring-navy/20"
          : "border-line bg-surface hover:border-brand hover:bg-paper/60",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * One custom-size field that lets the author TYPE.
 *
 * The previous field clamped on every keystroke, so «2» became the 50 mm
 * floor before «200» could be finished — the numbers felt locked. This one
 * keeps a text draft while focused and commits (clamped to the printable
 * range, converted from the chosen unit) on blur or Enter.
 */
function CustomSizeField({
  axis,
  unit,
  valueMm,
  onCommit,
}: {
  axis: "w" | "h";
  unit: LengthUnit;
  valueMm: number;
  onCommit: (mm: number) => void;
}) {
  const shown = String(roundUnit(fromMm(valueMm, unit), unit));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(",", "."));
    setDraft(null);
    if (!Number.isFinite(n) || n <= 0) return;
    const mm = Math.min(MAX_CUSTOM_MM, Math.max(MIN_CUSTOM_MM, toMm(n, unit)));
    onCommit(Math.round(mm * 10) / 10);
  };
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-extrabold text-muted">
        {axis === "w" ? "العرض" : "الارتفاع"} ({unit})
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? shown}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") setDraft(null);
        }}
        aria-label={`${axis === "w" ? "العرض" : "الارتفاع"} بوحدة ${unit}`}
        className="h-10 rounded-xl border border-line bg-surface px-3 text-[13px] font-bold tabular-nums text-ink outline-none focus:border-brand"
        dir="ltr"
      />
    </label>
  );
}

/** A tiny sheet drawn at the page's own proportions. */
function SheetGlyph({
  w,
  h,
  active,
}: {
  w: number;
  h: number;
  active?: boolean;
}) {
  const box = 26;
  const scale = box / Math.max(w, h);
  return (
    <span className="grid size-8 place-items-center" aria-hidden>
      <span
        className={cn(
          "block rounded-[2px] border-[1.5px]",
          active
            ? "border-brand bg-navy/10"
            : "border-muted/60",
        )}
        style={{ width: Math.round(w * scale), height: Math.round(h * scale) }}
      />
    </span>
  );
}

/**
 * The configuration step itself.
 *
 * `variant="dialog"` is the in-place modal the licensed Home and the editor's
 * account menu open; `variant="page"` is the same form as the body of the
 * `/create` screen. One implementation, so the creation screen and the dialog
 * can never disagree about a preset, a limit, or what the preview shows.
 */
export function NewDocumentForm({
  variant = "dialog",
  onClose,
  onCreated,
  initial,
  submitLabel = "إنشاء وفتح المحرر",
}: {
  variant?: "dialog" | "page";
  onClose?: () => void;
  /** Called with the id of the document that was created and is now active. */
  onCreated: (projectId: string | null) => void;
  initial?: Partial<NewDocumentConfig>;
  submitLabel?: string;
}) {
  const isDialog = variant === "dialog";
  const createDocument = useEditor((s) => s.createDocument);
  const entitlements = useEditor((s) => s.entitlements);
  const storeOrg = useEditor((s) => s.orgName);
  const [config, setConfig] = useState<NewDocumentConfig>(() =>
    defaultNewDocument({ orgName: storeOrg || "", ...initial }),
  );
  /* The author's unit of thought — stored once, applied to every size field. */
  const [unit, setUnitState] = useState<LengthUnit>(() => loadLengthUnit());
  const setUnit = (next: LengthUnit) => {
    setUnitState(next);
    saveLengthUnit(next);
  };
  const [busy, setBusy] = useState(false);

  const maxPages = entitlements.unlimited_pages
    ? MAX_NEW_PAGES
    : (DEMO_LICENSE.entitlements.maxPagesPerProject ?? MAX_NEW_PAGES);

  const set = (patch: Partial<NewDocumentConfig>) =>
    setConfig((c) => ({ ...c, ...patch }));

  /* The exact document that will be created — the preview is not a mock-up. */
  const preview = useMemo(() => buildNewDocument(config), [config]);
  const previewPage = preview.pages[0];
  const previewSize = pageSize(previewPage);

  /* One first page per starter pack, painted in the chosen theme. */
  const packPreviews = useMemo(
    () =>
      STARTER_PACKS.map((id) => {
        const pack = PACKS.find((p) => p.id === id)!;
        const project = buildNewDocument(
          defaultNewDocument({
            start: "template",
            pack: id,
            theme: config.theme,
          }),
        );
        return { pack, page: project.pages[0], count: project.pages.length };
      }),
    [config.theme],
  );

  const placeholderName = defaultDocumentName(config);
  const isTemplate = config.start === "template";

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const project = buildNewDocument({
        ...config,
        pages: clampPages(config.pages, maxPages),
      });
      const created = await createDocument(project, {
        autoName: !config.name.trim(),
      });
      if (created) onCreated(useEditor.getState().id ?? null);
    } finally {
      setBusy(false);
    }
  };

  /*
   * Rotating a square sheet changes nothing — the control says so instead of
   * pretending to work. True for the square preset and for a square custom
   * size alike.
   */
  const orientationDisabled =
    !isTemplate &&
    (config.size === "custom"
      ? config.custom.w === config.custom.h
      : presetIsSquare(config.size));

  const body = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {isDialog && (
        <DialogHeader
          title="إنشاء مستند جديد"
          subtitle="الإعدادات الافتراضية جاهزة — أنشئ مباشرةً، أو خصّص المقاس والاتجاه والصفحات قبل الدخول إلى المحرر."
          onClose={() => onClose?.()}
        />
      )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          {/* ── configuration ─────────────────────────────────────────── */}
          <div className="grid min-w-0 content-start gap-4">
            <Section title="نقطة البداية">
              <div className="grid grid-cols-2 gap-2.5">
                <Choice
                  active={!isTemplate}
                  onClick={() => set({ start: "blank" })}
                  className="flex items-start gap-2.5 p-3"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-navy/10 text-brand">
                    <FileText className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-extrabold text-ink">
                      مستند فارغ
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-5 text-muted">
                      صفحات نظيفة بالمقاس الذي تختاره
                    </span>
                  </span>
                </Choice>
                <Choice
                  active={isTemplate}
                  onClick={() => set({ start: "template" })}
                  className="flex items-start gap-2.5 p-3"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gold/25 text-ink">
                    <LayoutTemplate className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-extrabold text-ink">
                      من قالب مرخّص
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-5 text-muted">
                      حزمة جاهزة بصفحاتها ومقاسها
                    </span>
                  </span>
                </Choice>
              </div>
            </Section>

            {isTemplate ? (
              <Section
                title="القالب"
                hint="يُطبَّق مقاس القالب وعدد صفحاته تلقائيًا"
              >
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {packPreviews.map(({ pack, page, count }) => {
                    const size = pageSize(page);
                    const active = config.pack === pack.id;
                    return (
                      <Choice
                        key={pack.id}
                        active={active}
                        onClick={() => set({ pack: pack.id })}
                        className="flex flex-col p-1.5"
                      >
                        <span className="grid h-[88px] place-items-center rounded-lg bg-paper/70 p-1.5">
                          <span
                            className="block"
                            style={{
                              width:
                                size.w >= size.h
                                  ? "100%"
                                  : `${Math.round(88 * (size.w / size.h))}px`,
                            }}
                          >
                            <TemplatePreview
                              page={page}
                              className="rounded-[2px] border border-line shadow-sm"
                            />
                          </span>
                        </span>
                        <span className="mt-1.5 block text-[11.5px] font-extrabold leading-5 text-ink">
                          {pack.title}
                        </span>
                        <span className="text-[10px] font-bold text-muted">
                          {pagesText(count)}
                        </span>
                      </Choice>
                    );
                  })}
                </div>
              </Section>
            ) : (
              <>
                <Section title="نوع المستند">
                  <div className="flex flex-wrap gap-2">
                    {DOC_KINDS.map((kind) => (
                      <Choice
                        key={kind.id}
                        active={config.kind === kind.id}
                        onClick={() =>
                          set({
                            kind: kind.id,
                            size: kind.size,
                            orientation: kind.orientation,
                          })
                        }
                        className="px-3.5 py-2"
                      >
                        <span className="block text-[12px] font-extrabold text-ink">
                          {kind.title}
                        </span>
                        <span className="block text-[10px] font-bold text-muted">
                          {kind.desc}
                        </span>
                      </Choice>
                    ))}
                  </div>
                </Section>

                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Section
                    title="مقاس الصفحة"
                    hint="المقاسات المتعارف عليها + مقاس مخصص"
                  >
                    {/* One unit switcher for the whole dialog — stored per author. */}
                    <div
                      className="flex flex-wrap items-center gap-1.5"
                      role="group"
                      aria-label="وحدة القياس"
                    >
                      <span className="me-1 text-[11px] font-bold text-muted">
                        وحدة القياس
                      </span>
                      {LENGTH_UNITS.map((id) => (
                        <Choice
                          key={id}
                          active={unit === id}
                          onClick={() => setUnit(id)}
                          label={LENGTH_UNIT_LABELS[id]}
                          className="px-2.5 py-1.5"
                        >
                          <span
                            className="block text-[11px] font-extrabold text-ink"
                            dir="ltr"
                          >
                            {id}
                          </span>
                        </Choice>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {PAGE_SIZES.map((size) => {
                        const active = config.size === size.id;
                        const landscape = config.orientation === "landscape";
                        const long = Math.max(size.w, size.h);
                        const short = Math.min(size.w, size.h);
                        return (
                          <Choice
                            key={size.id}
                            active={active}
                            onClick={() => {
                              // A slide is wide and a story is tall by nature;
                              // leaving one restores upright paper.
                              const orientation: Orientation =
                                PRESET_ORIENTATION[size.id as PageSizeId] ??
                                (PRESET_ORIENTATION[config.size]
                                  ? "portrait"
                                  : config.orientation);
                              // Entering «مخصص»: start from the sheet the author
                              // was looking at, laid out in the current orientation,
                              // so the fields never contradict the preview.
                              const base =
                                size.id === "custom"
                                  ? pageDimensions(
                                      config.size === "custom" ? "custom" : config.size,
                                      orientation,
                                      config.custom,
                                    )
                                  : config.custom;
                              set({
                                size: size.id as PageSizeId,
                                orientation,
                                custom: base,
                              });
                            }}
                            className="flex flex-col items-center gap-1 px-2 py-2.5 text-center"
                          >
                            <SheetGlyph
                              w={landscape ? long : short}
                              h={landscape ? short : long}
                              active={active}
                            />
                            <span className="text-[12px] font-extrabold text-ink">
                              {size.name}
                            </span>
                            <span
                              className="text-[10px] font-bold text-muted"
                              dir="ltr"
                            >
                              {size.id === "custom"
                                ? unit
                                : describeSize(size.w, size.h, unit)}
                            </span>
                          </Choice>
                        );
                      })}
                    </div>
                  </Section>

                  <Section title="الاتجاه">
                    <div className="grid grid-cols-2 gap-2 sm:w-[168px]">
                      {(
                        [
                          ["portrait", "رأسي", RectangleVertical],
                          ["landscape", "أفقي", RectangleHorizontal],
                        ] as [Orientation, string, typeof RectangleVertical][]
                      ).map(([id, label, Icon]) => (
                        <Choice
                          key={id}
                          active={config.orientation === id}
                          onClick={() => {
                            if (orientationDisabled) return;
                            if (config.size !== "custom") {
                              set({ orientation: id });
                              return;
                            }
                            // Custom sheet: the orientation IS the numbers, so
                            // flipping it swaps width and height in the fields.
                            const long = Math.max(config.custom.w, config.custom.h);
                            const short = Math.min(config.custom.w, config.custom.h);
                            set({
                              orientation: id,
                              custom:
                                id === "landscape"
                                  ? { w: long, h: short }
                                  : { w: short, h: long },
                            });
                          }}
                          className={cn(
                            "flex flex-col items-center gap-1 px-2 py-2.5 text-center",
                            orientationDisabled &&
                              "cursor-not-allowed opacity-50",
                          )}
                        >
                          <Icon className="size-6 text-muted" aria-hidden />
                          <span className="text-[12px] font-extrabold text-ink">
                            {label}
                          </span>
                        </Choice>
                      ))}
                    </div>
                  </Section>
                </div>

                {config.size === "custom" && (
                  <div className="grid gap-1.5">
                    <div className="grid grid-cols-2 gap-2.5">
                      {(["w", "h"] as const).map((axis) => (
                        <CustomSizeField
                          key={`${axis}-${unit}`}
                          axis={axis}
                          unit={unit}
                          valueMm={config.custom[axis]}
                          onCommit={(mm) => {
                            const custom = { ...config.custom, [axis]: mm };
                            // The numbers decide the orientation — never the
                            // other way round — so a typed 300 × 200 stays wide.
                            set({
                              custom,
                              orientation:
                                custom.w > custom.h
                                  ? "landscape"
                                  : custom.w < custom.h
                                    ? "portrait"
                                    : config.orientation,
                            });
                          }}
                        />
                      ))}
                    </div>
                    <p className="text-[10px] font-bold text-muted" dir="auto">
                      من {roundUnit(fromMm(MIN_CUSTOM_MM, unit), unit)} إلى{" "}
                      {roundUnit(fromMm(MAX_CUSTOM_MM, unit), unit)} {unit} —
                      اكتب الرقم ثم اضغط Enter أو انتقل للحقل التالي
                    </p>
                  </div>
                )}

                <Section
                  title="محتوى الصفحة الفارغة"
                  hint="ينطبق على بداية «مستند فارغ»"
                >
                  <div className="grid grid-cols-2 gap-2.5">
                    <Choice
                      active={config.content === "empty"}
                      onClick={() => set({ content: "empty" as BlankContent })}
                      className="flex items-start gap-3 p-3"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-navy/10 text-brand">
                        <FileText className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-extrabold text-ink">
                          فارغ تمامًا
                        </span>
                        <span className="mt-0.5 block text-[10px] leading-4 text-muted">
                          صفحة بيضاء بلا أي محتوى
                        </span>
                      </span>
                    </Choice>
                    <Choice
                      active={config.content === "chrome"}
                      onClick={() => set({ content: "chrome" as BlankContent })}
                      className="flex items-start gap-3 p-3"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gold/25 text-ink">
                        <LayoutTemplate className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-extrabold text-ink">
                          رأس وتذييل خفيف
                        </span>
                        <span className="mt-0.5 block text-[10px] leading-4 text-muted">
                          هوية الجهة أعلى الصفحة وأسفلها
                        </span>
                      </span>
                    </Choice>
                  </div>
                </Section>

                <Section title="خلفية الصفحة" hint="تُحفظ مع المستند">
                  <div className="flex flex-wrap items-center gap-2">
                    {BLANK_BACKGROUNDS.filter((b) => b.color).map((swatch) => (
                      <Choice
                        key={swatch.id}
                        active={config.bg === swatch.color}
                        onClick={() => set({ bg: swatch.color })}
                        label={swatch.name}
                        className="flex items-center gap-2 px-2.5 py-2"
                      >
                        <span
                          className="size-4 rounded-full border border-line"
                          style={{ background: swatch.color }}
                          aria-hidden
                        />
                        <span className="text-[11px] font-extrabold text-ink">
                          {swatch.name}
                        </span>
                      </Choice>
                    ))}
                    <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-1.5">
                      <input
                        type="color"
                        aria-label="لون خلفية مخصص"
                        value={blankBackground(config.bg)}
                        onChange={(e) => set({ bg: e.target.value })}
                        className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
                      />
                      <span className="text-[11px] font-extrabold text-ink">
                        لون مخصص
                      </span>
                    </label>
                  </div>
                </Section>

                <Section
                  title="عدد الصفحات"
                  hint={
                    entitlements.unlimited_pages
                      ? `حتى ${MAX_NEW_PAGES} صفحة — تضيف المزيد من المحرر`
                      : `حتى ${maxPages} صفحات في هذه النسخة`
                  }
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="صفحة أقل"
                      onClick={() =>
                        set({ pages: clampPages(config.pages - 1, maxPages) })
                      }
                      disabled={config.pages <= 1}
                      className="grid size-10 place-items-center rounded-xl border border-line text-ink transition hover:bg-line-2 disabled:opacity-40"
                    >
                      <Minus className="size-4" />
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      aria-label="عدد الصفحات"
                      min={1}
                      max={maxPages}
                      value={config.pages}
                      onChange={(e) =>
                        set({
                          pages: clampPages(Number(e.target.value), maxPages),
                        })
                      }
                      className="h-10 w-20 rounded-xl border border-line bg-surface text-center text-[14px] font-extrabold tabular-nums text-ink outline-none focus:border-brand"
                    />
                    <button
                      type="button"
                      aria-label="صفحة أكثر"
                      onClick={() =>
                        set({ pages: clampPages(config.pages + 1, maxPages) })
                      }
                      disabled={config.pages >= maxPages}
                      className="grid size-10 place-items-center rounded-xl border border-line text-ink transition hover:bg-line-2 disabled:opacity-40"
                    >
                      <Plus className="size-4" />
                    </button>
                    <span className="ms-1 text-[12px] font-bold text-muted">
                      {pagesText(clampPages(config.pages, maxPages))}
                    </span>
                  </div>
                </Section>
              </>
            )}

            <Section title="سمة الألوان">
              <div className="flex flex-wrap gap-2">
                {THEME_ORDER.map((id) => (
                  <Choice
                    key={id}
                    active={config.theme === id}
                    onClick={() => set({ theme: id })}
                    className="inline-flex items-center gap-2 px-3 py-2"
                  >
                    <span
                      className="flex -space-x-1 space-x-reverse"
                      aria-hidden
                    >
                      <span
                        className="size-3.5 rounded-full ring-2 ring-white"
                        style={{ background: THEMES[id].primary }}
                      />
                      <span
                        className="size-3.5 rounded-full ring-2 ring-white"
                        style={{ background: THEMES[id].accent }}
                      />
                    </span>
                    <span className="text-[12px] font-extrabold text-ink">
                      {THEMES[id].name}
                    </span>
                  </Choice>
                ))}
              </div>
            </Section>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-[12px] font-extrabold text-ink">
                  اسم المستند
                </span>
                <input
                  value={config.name}
                  onChange={(e) => set({ name: e.target.value })}
                  placeholder={placeholderName}
                  maxLength={120}
                  className="h-10 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold text-ink outline-none placeholder:text-muted/70 focus:border-brand"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-[12px] font-extrabold text-ink">
                  اسم الجهة
                </span>
                <input
                  value={config.orgName}
                  onChange={(e) => set({ orgName: e.target.value })}
                  placeholder="يظهر في تذييل الصفحات"
                  maxLength={120}
                  className="h-10 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold text-ink outline-none placeholder:text-muted/70 focus:border-brand"
                />
              </label>
            </div>
          </div>

          {/* ── live preview ──────────────────────────────────────────── */}
          <aside className="order-first lg:order-none">
            <div className="grid gap-3 rounded-2xl border border-line bg-paper/60 p-4 lg:sticky lg:top-0">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold tracking-wide text-muted">
                  معاينة الصفحة الأولى
                </span>
                <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-extrabold text-muted">
                  {pagesText(preview.pages.length)}
                </span>
              </div>
              {/* Compact beside the summary on tablets; full height beside the form on desktop. */}
              <div className="grid gap-3 [--pv-h:170px] sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)] sm:items-center lg:grid-cols-1 lg:[--pv-h:300px]">
                <div className="grid place-items-center rounded-xl bg-surface-2 p-3">
                  <div
                    className="mx-auto w-full"
                    style={{
                      width: `min(100%, calc(var(--pv-h) * ${(previewSize.w / previewSize.h).toFixed(4)}))`,
                    }}
                  >
                    <TemplatePreview
                      page={previewPage}
                      className="rounded-[3px] border border-line shadow-lg"
                    />
                  </div>
                </div>
                <dl className="grid gap-1.5 text-[12px]">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted">البداية</dt>
                    <dd className="font-bold text-ink">
                      {isTemplate
                        ? PACKS.find((p) => p.id === config.pack)?.title
                        : `مستند فارغ · ${docKind(config.kind).title}`}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted">المقاس</dt>
                    <dd className="font-bold text-ink">
                      {describeConfig({
                        ...config,
                        pages: clampPages(config.pages, maxPages),
                      })}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted">الأبعاد</dt>
                    <dd
                      className="font-bold tabular-nums text-ink"
                      dir="ltr"
                    >
                      {describeSize(previewSize.w, previewSize.h, unit)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted">السمة</dt>
                    <dd className="font-bold text-ink">
                      {THEMES[preview.theme]?.name}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </aside>
        </div>

      {/* Pinned to the dialog's bottom edge, so «إنشاء» never scrolls out of reach on a tablet. */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface",
          isDialog
            ? "sticky -bottom-5 z-10 -mx-5 mt-6 px-5 pt-4 pb-5"
            : "mt-6 rounded-b-2xl px-4 py-4",
        )}
      >
          <p className="text-[11px] font-semibold text-muted">
            يُحفظ المستند في مشاريعك تلقائيًا، ويمكن تغيير كل إعداد لاحقًا من
            المحرر.
          </p>
          <div className="flex gap-2">
            {isDialog ? (
              <button
                type="button"
                onClick={() => onClose?.()}
                disabled={busy}
                className={GHOST_BTN}
              >
                إلغاء
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  window.location.assign("/templates");
                }}
                disabled={busy}
                className={GHOST_BTN}
              >
                ابدأ من قالب جاهز
              </button>
            )}
            <button
              type="submit"
              disabled={busy}
              className={cn(PRIMARY_BTN, "min-w-[172px]")}
              data-testid="create-document"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {busy ? "جارٍ الإنشاء…" : submitLabel}
            </button>
          </div>
        </div>
    </form>
  );

  if (!isDialog) return body;
  return (
    <Modal
      label="إنشاء مستند جديد"
      onClose={busy ? () => undefined : () => onClose?.()}
      className="max-w-5xl"
    >
      {body}
    </Modal>
  );
}

/**
 * The modal wrapper kept for the surfaces that configure a document in place
 * (the licensed Home). `/create` renders `NewDocumentForm` directly.
 */
export function NewDocumentDialog({
  onClose,
  onCreated,
  initial,
  submitLabel = "إنشاء وفتح المحرر",
}: {
  onClose: () => void;
  /** Called once the document exists and is the store's active project. */
  onCreated: () => void;
  initial?: Partial<NewDocumentConfig>;
  submitLabel?: string;
}) {
  return (
    <NewDocumentForm
      variant="dialog"
      onClose={onClose}
      onCreated={() => onCreated()}
      initial={initial}
      submitLabel={submitLabel}
    />
  );
}
