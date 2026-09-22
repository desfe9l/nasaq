/*
 * Templates catalog.
 *
 * One surface for the whole template library: the shipped packs and page
 * templates together with the templates the author creates, edits, duplicates
 * or deletes here. Every card paints a REAL page (see TemplatePreview), so what
 * is on the card is what the editor opens.
 *
 * Behaviour contract kept from the previous catalog:
 *   • starter packs stay license-gated (`canUseDemoPack` / premium entitlement)
 *     exactly as before — «استخدام القالب» routes to /license when locked;
 *   • page templates and custom templates respect the demo project/page caps
 *     (`canCreateDemoProject` plus the same `maxPagesPerProject` the editor
 *     enforces), so nothing here widens what a demo licence can do;
 *   • opening a project stays `importProject` + `/editor`.
 *
 * Everything the catalog manages lives in one localStorage slot
 * (`lib/templates/custom-templates.ts`) surfaced through `useSyncExternalStore`:
 * edits appear immediately, across reloads and other tabs, with no rebuild.
 */

import { useEffect, useMemo, useState } from "react";
import { Database, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { SIZE_PRESETS, THEMES, type Page, type ThemeId } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { getProject } from "@/lib/editor/storage";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { CARD_W, CARD_WRAP } from "@/components/site/cards";
import { cn } from "@/lib/utils";
import { DEMO_LICENSE, canCreateDemoProject, canUseDemoPack } from "@/lib/product/product";
import { useLicense } from "@/lib/license/client";
import {
  CATALOG_PILLS,
  entryProjectSeed,
  entryTemplatePages,
  filterCatalog,
  matchesQuery,
  type CatalogEntry,
} from "@/lib/templates/catalog";
import {
  TemplateStorageError,
  clearDraft,
  deleteCustomTemplate,
  duplicateCustomTemplate,
  saveCustomTemplate,
  saveDraft,
  type CatalogPillId,
} from "@/lib/templates/custom-templates";
import { TemplateCard } from "@/components/site/TemplateCard";
import {
  ConfirmDialog,
  QuickViewDialog,
  TemplateFormDialog,
  type TemplateFormValues,
} from "@/components/site/TemplateDialogs";
import { useCatalogEntries, useCustomTemplates, useTemplateDraft } from "@/components/site/useCatalog";

const SIZE_OPTIONS = SIZE_PRESETS.filter((s) => s.id !== "custom");
const THEME_ORDER: ThemeId[] = ["official", "eid", "ministry", "slate", "sand"];

/** A storage/quota failure carries its own Arabic message; anything else is generic. */
function reportError(err: unknown, fallback: string) {
  toast.error(err instanceof TemplateStorageError ? err.message : fallback);
}

export function TemplatesPage() {
  const hydrate = useEditor((s) => s.hydrate);
  const importProject = useEditor((s) => s.importProject);
  const openProject = useEditor((s) => s.openProject);
  const projects = useEditor((s) => s.projects);
  /** The project currently open in the editor — the default source document. */
  const activeProjectId = useEditor((s) => s.id);
  const orgName = useEditor((s) => s.orgName);
  const { entitlements } = useLicense();

  const [theme, setTheme] = useState<ThemeId>("official");
  const [pill, setPill] = useState<CatalogPillId>("all");
  const [query, setQuery] = useState("");
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const [form, setForm] = useState<{ mode: "create" | "edit"; entryId?: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);

  const custom = useCustomTemplates();
  const draft = useTemplateDraft();
  const entries = useCatalogEntries(theme, orgName);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const filtered = useMemo(() => filterCatalog(entries, { pill, query }), [entries, pill, query]);
  const counts = useMemo(() => {
    const map = new Map<CatalogPillId, number>();
    for (const option of CATALOG_PILLS) {
      map.set(
        option.id,
        entries.filter(
          (entry) =>
            (option.id === "all" || entry.pills.includes(option.id)) && matchesQuery(entry, query),
        ).length,
      );
    }
    return map;
  }, [entries, query]);

  const quickEntry = quickViewId ? entries.find((e) => e.id === quickViewId) ?? null : null;
  const confirmEntry = confirmId ? entries.find((e) => e.id === confirmId) ?? null : null;
  const formEntry = form?.entryId ? entries.find((e) => e.id === form.entryId) ?? null : null;
  const customCount = custom.length;

  /* ── guards ──────────────────────────────────────────────────────────── */

  /**
   * The store's own limits, said in context before anything is built.
   *
   * Projects and pages are counted exactly as `store.ts` counts them — the demo
   * licence allows one project of up to three pages — and a licence lifts the
   * limits through the same two entitlements the editor reads. Nothing here can
   * grant more than the store would.
   */
  const demoBlocked = (pageCount: number): boolean => {
    if (!entitlements.unlimited_projects && !canCreateDemoProject(projects.length)) {
      toast.error("اكتملت مساحة العرض التجريبي", {
        description: "يتضمن العرض مشروعًا واحدًا. اطلب النسخة الكاملة لإنشاء مشاريع إضافية.",
      });
      return true;
    }
    const maxPages = DEMO_LICENSE.entitlements.maxPagesPerProject ?? Infinity;
    if (!entitlements.unlimited_pages && pageCount > maxPages) {
      toast.error("وصلت إلى حد صفحات العرض التجريبي", {
        description: "يتاح حتى 3 صفحات في العرض. افتح النسخة الكاملة لمشاريع أطول.",
      });
      return true;
    }
    return false;
  };

  /** Starter packs outside the demo allowance open the pricing page, as before. */
  const packLocked = (entry: CatalogEntry): boolean =>
    entry.kind === "pack" && !canUseDemoPack(entry.sourceId) && !entitlements.premium_templates;

  /* ── actions ─────────────────────────────────────────────────────────── */

  /** «استخدام القالب» — build a project from the entry and open the editor. */
  const startFromEntry = async (entry: CatalogEntry) => {
    if (packLocked(entry)) {
      window.location.assign("/license");
      return;
    }
    // The page caps are only as good as the project list they are counted from.
    await hydrate();
    const seed = entryProjectSeed(entry, { themeId: theme, orgName });
    if (demoBlocked(seed.pages.length)) return;
    setQuickViewId(null);
    await importProject(seed);
    window.location.assign("/editor");
  };

  /**
   * «تعديل القالب» — open a real working copy in the editor and remember the
   * link, so an edit made there can be written back over the template (custom)
   * or published as a new one (shipped templates). See the draft banner below.
   */
  const editEntry = async (entry: CatalogEntry) => {
    if (packLocked(entry)) {
      window.location.assign("/license");
      return;
    }
    await hydrate();
    const seed = entryProjectSeed(entry, { themeId: theme, orgName });
    if (demoBlocked(seed.pages.length)) return;
    setQuickViewId(null);
    await importProject({ ...seed, name: `${entry.title} — مسودة` });
    const projectId = useEditor.getState().id;
    if (projectId) {
      try {
        saveDraft({
          entryId: entry.id,
          title: entry.title,
          projectId,
          kind: entry.kind === "custom" ? "custom" : "copy",
          startedAt: Date.now(),
        });
      } catch (err) {
        reportError(err, "تعذّر تذكّر مسودة التعديل");
      }
    }
    window.location.assign("/editor");
  };

  /** «تكرار» — the copy is always a custom template, whatever the source was. */
  const duplicateEntry = (entry: CatalogEntry) => {
    // Copying a pack would otherwise hand out its pages without its licence.
    if (packLocked(entry)) {
      window.location.assign("/license");
      return;
    }
    try {
      if (entry.kind === "custom") {
        duplicateCustomTemplate(entry.sourceId);
      } else {
        saveCustomTemplate({
          title: `${entry.title} — نسخة`,
          desc: entry.desc,
          category: entry.category,
          pills: entry.pills.filter((p) => p !== "all" && p !== "custom"),
          tags: entry.tags,
          derivedFrom: entry.id,
          pages: entryTemplatePages(entry, { themeId: theme, orgName }),
        });
      }
      toast.success(`تم تكرار «${entry.title}» في قوالبي الخاصة`);
      setQuickViewId(null);
      setPill("custom");
      setQuery("");
    } catch (err) {
      reportError(err, "تعذّر تكرار القالب");
    }
  };

  const removeEntry = (entry: CatalogEntry) => {
    try {
      deleteCustomTemplate(entry.sourceId);
      toast.success(`تم حذف «${entry.title}»`);
      setConfirmId(null);
      setQuickViewId(null);
      setJustSaved(null);
    } catch (err) {
      reportError(err, "تعذّر حذف القالب");
    }
  };

  /** Publish a template from a project / another entry / a blank document. */
  const createFrom = async (values: TemplateFormValues) => {
    try {
      let pages: Page[] | undefined;
      if (values.source.kind === "project") {
        const project = await getProject(values.source.projectId);
        if (!project?.pages?.length) {
          toast.error("تعذّر قراءة المشروع المحدد");
          return;
        }
        pages = project.pages;
      } else if (values.source.kind === "entry") {
        const sourceId = values.source.entryId;
        const picked = entries.find((e) => e.id === sourceId);
        if (picked) pages = entryTemplatePages(picked, { themeId: theme, orgName });
      } else {
        const blank = entries.find((e) => e.id === "pack:blank");
        if (blank) pages = entryTemplatePages(blank, { themeId: theme, orgName });
      }
      if (!pages?.length) {
        toast.error("لا توجد صفحات لهذا القالب");
        return;
      }
      const saved = saveCustomTemplate({
        title: values.title,
        desc: values.desc,
        category: values.category,
        pills: values.pills,
        tags: values.tags,
        pages,
      });
      toast.success(`تم حفظ «${saved.title}» في قوالبي الخاصة`);
      setForm(null);
      setJustSaved(`custom:${saved.id}`);
      setPill("custom");
      setQuery("");
    } catch (err) {
      reportError(err, "تعذّر حفظ القالب");
    }
  };

  /** Metadata-only edit: name, description, category, tags and catalog filters. */
  const saveMeta = (values: TemplateFormValues) => {
    if (!formEntry?.custom) return;
    try {
      const saved = saveCustomTemplate({
        id: formEntry.custom.id,
        title: values.title,
        desc: values.desc,
        category: values.category,
        pills: values.pills,
        tags: values.tags,
        pages: formEntry.custom.pages,
      });
      toast.success(`تم تحديث بيانات «${saved.title}»`);
      setForm(null);
      setJustSaved(`custom:${saved.id}`);
    } catch (err) {
      reportError(err, "تعذّر حفظ التعديلات");
    }
  };

  /** Write the edited draft project back into the library. */
  const commitDraft = async () => {
    if (!draft) return;
    const project = await getProject(draft.projectId);
    if (!project?.pages?.length) {
      clearDraft();
      toast.error("تعذّر قراءة مسودة القالب — حُذف المشروع أو لم يعد موجودًا");
      return;
    }
    try {
      const target = entries.find((e) => e.id === draft.entryId);
      const saved =
        draft.kind === "custom" && target?.custom
          ? saveCustomTemplate({
              id: target.custom.id,
              title: target.custom.title,
              desc: target.custom.desc,
              category: target.custom.category,
              pills: target.custom.pills,
              tags: target.custom.tags,
              pages: project.pages,
            })
          : saveCustomTemplate({
              title: draft.title,
              desc: `مُشتق من «${draft.title}» بعد التعديل.`,
              category: target?.category || "editorial",
              pills: target?.pills.filter((p) => p !== "all" && p !== "custom") ?? [],
              tags: target?.tags ?? [],
              derivedFrom: draft.entryId,
              pages: project.pages,
            });
      toast.success(
        draft.kind === "custom" && target?.custom
          ? `تم تحديث «${saved.title}» بتعديلاتك`
          : `تم حفظ «${saved.title}» كقالب جديد`,
      );
      setJustSaved(`custom:${saved.id}`);
      clearDraft();
      setPill("custom");
      setQuery("");
    } catch (err) {
      reportError(err, "تعذّر حفظ المسودة");
    }
  };

  const resumeDraft = async () => {
    if (!draft) return;
    await openProject(draft.projectId);
    window.location.assign("/editor");
  };

  /* ── render ──────────────────────────────────────────────────────────── */

  const field =
    "h-11 w-full rounded-xl border border-line bg-paper/60 pr-10 pl-10 text-[13px] font-semibold text-ink outline-none transition focus:border-navy dark:border-white/10 dark:bg-white/5 dark:text-white";

  return (
    <div className="min-h-full bg-paper dark:bg-[#111722]">
      <SiteHeader current="/templates" />

      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 md:py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-extrabold text-ink dark:text-white">القوالب</h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-7 text-muted">
              كل قالب هنا معاينة حقيقية لصفحاته: استخدمه لإنشاء مشروع، أو عاينه سريعًا، أو عدّله وكرّره
              واحفظه في «قوالبي الخاصة» — والتغييرات تظهر في الكتالوج مباشرة.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setForm({ mode: "create" })}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-navy px-4 text-[13px] font-extrabold text-white shadow-sm transition hover:bg-navy-2"
          >
            <Plus className="size-4" />
            إضافة قالب جديد
          </button>
        </div>

        {/* Search + filters */}
        <div className="shadow-card dark:shadow-card-dark mt-6 grid gap-4 rounded-2xl border border-line bg-white p-4 dark:border-white/10 dark:bg-white/5 md:p-5">
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث باسم القالب أو الوسم أو نوع الاستخدام…"
              aria-label="بحث في القوالب"
              className={field}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="مسح البحث"
                className="absolute left-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted transition hover:bg-line-2 hover:text-ink dark:hover:bg-white/10 dark:hover:text-white"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {CATALOG_PILLS.map((option) => {
              const active = pill === option.id;
              const count = counts.get(option.id) ?? 0;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPill(option.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12px] font-extrabold transition-all duration-200",
                    active
                      ? "scale-[1.03] border-navy bg-navy text-white shadow-sm"
                      : "border-line text-muted hover:-translate-y-0.5 hover:border-navy-2 hover:text-ink dark:border-white/10 dark:hover:text-white",
                  )}
                >
                  {option.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                      active
                        ? "bg-white/20 text-white"
                        : "bg-line-2 text-muted dark:bg-white/10 dark:text-white/70",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line/70 pt-4 dark:border-white/10">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-muted">
              <SlidersHorizontal className="size-3.5" /> سمة العرض
            </span>
            {THEME_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id)}
                aria-pressed={theme === id}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold transition",
                  theme === id
                    ? "border-navy bg-navy text-white"
                    : "border-line text-muted hover:border-navy-2 dark:border-white/10",
                )}
              >
                <span className="size-3 rounded-full" style={{ background: THEMES[id].primary }} />
                {THEMES[id].name}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-extrabold text-muted">المقاسات المتاحة</span>
            {SIZE_OPTIONS.map((s) => (
              <span
                key={s.id}
                className="rounded-full border border-line px-3 py-1.5 text-[11px] font-bold text-muted dark:border-white/10"
              >
                {s.name} — {s.w} × {s.h} مم
              </span>
            ))}
          </div>
        </div>

        {/* In-progress edit draft */}
        {draft && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold/40 bg-gold/10 p-4 dark:border-gold/30">
            <div className="flex items-start gap-3">
              <Database className="mt-0.5 size-4 shrink-0 text-green dark:text-gold-2" />
              <div>
                <p className="text-[13px] font-extrabold text-ink dark:text-white">
                  قيد التعديل: «{draft.title}»
                </p>
                <p className="mt-1 text-[12px] leading-6 text-muted">
                  {draft.kind === "custom"
                    ? "احفظ التعديلات لتحديث القالب في الكتالوج، أو تجاهل المسودة."
                    : "احفظ التعديلات كقالب مخصص جديد داخل «قوالبي الخاصة»."}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void resumeDraft()}
                className="inline-flex h-9 items-center rounded-xl border border-line bg-white px-3 text-[12px] font-bold text-ink transition hover:bg-line-2 dark:border-white/10 dark:bg-white/5 dark:text-white"
              >
                متابعة التعديل
              </button>
              <button
                type="button"
                onClick={() => void commitDraft()}
                className="inline-flex h-9 items-center rounded-xl bg-navy px-3 text-[12px] font-extrabold text-white transition hover:bg-navy-2"
              >
                {draft.kind === "custom" ? "تحديث القالب" : "حفظ كقالب جديد"}
              </button>
              <button
                type="button"
                onClick={() => clearDraft()}
                className="inline-flex h-9 items-center rounded-xl border border-line px-3 text-[12px] font-bold text-muted transition hover:bg-line-2 dark:border-white/10 dark:hover:bg-white/5"
              >
                تجاهل
              </button>
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-extrabold text-ink dark:text-white">
              {CATALOG_PILLS.find((p) => p.id === pill)?.label}
            </h2>
            <p className="mt-1 text-[12px] text-muted">
              {filtered.length ? `${filtered.length} قالبًا معروضًا` : "لا نتائج مطابقة"}
              {customCount > 0 && pill !== "custom" ? ` · لديك ${customCount} قالبًا مخصصًا` : ""}
            </p>
          </div>
          {customCount > 0 && pill !== "custom" && (
            <button
              type="button"
              onClick={() => setPill("custom")}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-[12px] font-bold text-ink transition hover:bg-line-2 dark:border-white/10 dark:text-white dark:hover:bg-white/5"
            >
              <Database className="size-3.5" />
              قوالبي الخاصة ({customCount})
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-line p-10 text-center dark:border-white/15">
            <p className="text-[14px] font-bold text-ink dark:text-white">
              {pill === "custom" && customCount === 0 ? "لا توجد قوالب مخصصة بعد" : "لا توجد قوالب مطابقة"}
            </p>
            <p className="mt-1 text-[13px] text-muted">
              {pill === "custom" && customCount === 0
                ? "أنشئ قالبك الأول من مشروع حالي أو من قالب جاهز — يبقى محفوظًا في متصفحك."
                : "جرّب كلمة بحث أخرى أو أزل الفلاتر — أو أنشئ قالبك الأول من مشروعك الحالي."}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setPill("all");
                }}
                className="inline-flex h-10 items-center rounded-xl border border-line px-4 text-[12px] font-bold text-ink transition hover:bg-line-2 dark:border-white/10 dark:text-white dark:hover:bg-white/5"
              >
                إزالة الفلاتر
              </button>
              <button
                type="button"
                onClick={() => setForm({ mode: "create" })}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-navy px-4 text-[12px] font-extrabold text-white transition hover:bg-navy-2"
              >
                <Plus className="size-4" /> إضافة قالب جديد
              </button>
            </div>
          </div>
        ) : (
          <div className={cn("mt-6", CARD_WRAP)}>
            {filtered.map((entry) => (
              <div key={entry.id} className={cn("flex", CARD_W)}>
                <TemplateCard
                  entry={entry}
                  locked={packLocked(entry)}
                  highlight={justSaved === entry.id}
                  actions={{
                    onUse: () => void startFromEntry(entry),
                    onQuickView: () => setQuickViewId(entry.id),
                    onEdit: () => void editEntry(entry),
                    onDuplicate: () => duplicateEntry(entry),
                    onEditMeta: () => setForm({ mode: "edit", entryId: entry.id }),
                    onDelete: () => setConfirmId(entry.id),
                  }}
                />
              </div>
            ))}
          </div>
        )}

        <p className="mt-10 flex items-start gap-2 text-[12px] leading-6 text-muted">
          <Database className="mt-0.5 size-4 shrink-0 text-ok" />
          القوالب المخصصة تُحفظ في متصفحك (localStorage) وتظهر مباشرةً في الكتالوج بلا إعادة بناء، ويفتح أي
          منها في المحرر بزر «استخدام القالب». القوالب الجاهزة تبقى كما هي، وأي تعديل عليها يُحفظ كنسخة خاصة بك.
        </p>

        <a
          href="/editor"
          className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-navy px-4 text-[13px] font-extrabold text-white shadow-sm transition hover:bg-navy-2"
        >
          اذهب إلى المحرر لإدراج القوالب
        </a>
      </main>

      <SiteFooter />

      {/* Floating «إضافة قالب جديد» */}
      <button
        type="button"
        onClick={() => setForm({ mode: "create" })}
        title="إضافة قالب جديد"
        aria-label="إضافة قالب جديد"
        className="fixed bottom-5 left-5 z-[var(--z-bubble)] inline-flex h-12 items-center gap-2 rounded-full bg-navy px-5 text-[13px] font-extrabold text-white shadow-xl shadow-navy/30 transition hover:bg-navy-2"
      >
        <Plus className="size-4" />
        قالب جديد
      </button>

      {quickEntry && (
        <QuickViewDialog
          entry={quickEntry}
          themeId={theme}
          onClose={() => setQuickViewId(null)}
          onUse={() => void startFromEntry(quickEntry)}
          onEdit={() => void editEntry(quickEntry)}
          onDuplicate={() => duplicateEntry(quickEntry)}
          onEditMeta={() => {
            setQuickViewId(null);
            setForm({ mode: "edit", entryId: quickEntry.id });
          }}
          onDelete={() => {
            setQuickViewId(null);
            setConfirmId(quickEntry.id);
          }}
        />
      )}

      {form && (
        <TemplateFormDialog
          mode={form.mode}
          entries={entries}
          projects={projects}
          activeProjectId={activeProjectId}
          initial={
            form.mode === "edit" && formEntry?.custom
              ? {
                  title: formEntry.custom.title,
                  desc: formEntry.custom.desc,
                  category: formEntry.custom.category,
                  tags: formEntry.custom.tags,
                  pills: formEntry.custom.pills,
                }
              : undefined
          }
          onClose={() => setForm(null)}
          onSubmit={(values) => {
            if (form.mode === "create") void createFrom(values);
            else saveMeta(values);
          }}
        />
      )}

      {confirmEntry && (
        <ConfirmDialog
          title={`حذف «${confirmEntry.title}»؟`}
          body="سيُحذف القالب المخصص نهائيًا من الكتالوج. المشاريع التي أنشأتها منه لا تتأثر."
          confirmLabel="حذف القالب"
          onConfirm={() => removeEntry(confirmEntry)}
          onClose={() => setConfirmId(null)}
        />
      )}
    </div>
  );
}
