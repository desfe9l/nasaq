/*
 * NASAQ Home — the licensed account's starting point before the editor.
 *
 * Hierarchy, top to bottom: what NASAQ is → «إنشاء مستند جديد» → recent work
 * → the licensed templates. Everything here is a view over systems that
 * already exist:
 *   • documents/projects — the editor store's project library (`projects`),
 *     the same IndexedDB rows `/projects` lists and `/editor/<id>` opens;
 *   • templates — the catalog (`useCatalogEntries` → packs, page templates and
 *     the author's own templates) plus the admin-published library;
 *   • creation — `createDocument`, which saves a NEW project (fresh id, fresh
 *     element ids), so a template's source is never modified.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Clock3,
  FilePlus2,
  FileText,
  Files,
  FolderOpen,
  LayoutTemplate,
  Presentation,
  RectangleHorizontal,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
} from "lucide-react";
import { THEMES, type ProjectMeta } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import {
  CREATE_ROUTE,
  WORKSPACE_ROUTE,
  editorPathFor,
  templatePathFor,
} from "@/lib/site-routes";
import { entrySlug } from "@/lib/templates/entry-slug";
import {
  docKind,
  type DocKindId,
  type NewDocumentConfig,
} from "@/lib/editor/new-document";
import { AppInstallNotice } from "@/components/AppInstallNotice";
import { accountIdentity } from "@/lib/auth/identity";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { OPEN_NEW_DOCUMENT_EVENT } from "@/lib/auth/use-workspace-entry";
import { licenseSummary } from "@/lib/license/summary";
import { useLicense, type LicenseState } from "@/lib/license/client";
import { useBrandIdentity } from "@/lib/product/use-brand-identity";
import { applyBrandToSeed } from "@/lib/editor/brand-design";
import { toast } from "sonner";
import { Navigate } from "@tanstack/react-router";
import { canUseDemoPack } from "@/lib/product/product";
import { getPublishedTemplateFn } from "@/lib/admin/functions";
import {
  CATALOG_PILLS,
  entryProjectSeed,
  pagesLabel,
  type CatalogEntry,
} from "@/lib/templates/catalog";
import type { CatalogPillId } from "@/lib/templates/custom-templates";
import { cn } from "@/lib/utils";
import { SiteFooter, SiteHeader } from "./SiteChrome";
import { ProjectCard } from "./ProjectCard";
import { TemplateCard } from "./TemplateCard";
import { QuickViewDialog } from "./TemplateDialogs";
import { PublishedTemplates } from "./PublishedTemplates";
import { NewDocumentDialog } from "./NewDocumentDialog";
import { useCatalogEntries } from "./useCatalog";
import {
  mergePublishedTemplateContext,
  publishedTemplateSeed,
  templateDisplaySlug,
} from "@/lib/templates/published";
import { CARD_W, CARD_WRAP } from "./cards";
import { ProjectFileButton } from "./ProjectFileButton";
import { IMPORT_ROUTE, TEMPLATES_ROUTE } from "@/lib/site-routes";

type FeaturedPill = "featured" | CatalogPillId;

/** How many template cards Home shows per filter before «عرض الكل». */
const HOME_TEMPLATE_LIMIT = 6;

const QUICK_STARTS: {
  kind: DocKindId;
  title: string;
  desc: string;
  icon: typeof FileText;
}[] = [
  { kind: "report", title: "تقرير رسمي", desc: "A4 رأسي", icon: FileText },
  { kind: "letter", title: "خطاب رسمي", desc: "A4 رأسي", icon: Files },
  {
    kind: "presentation",
    title: "عرض تقديمي",
    desc: "16:9",
    icon: Presentation,
  },
  { kind: "sheet", title: "جدول عريض", desc: "A4 أفقي", icon: Table2 },
  {
    kind: "poster",
    title: "ملصق ولوحة",
    desc: "A3 رأسي",
    icon: LayoutTemplate,
  },
];

function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hours = Math.round(diff / 3600000);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.round(hours / 24);
  if (days < 30) return `منذ ${days} يوم`;
  return new Date(ts).toLocaleDateString("ar-SA");
}

function SectionHeading({
  id,
  eyebrow,
  title,
  desc,
  action,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  desc?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-[11px] font-bold tracking-[0.14em] text-brand">
          {eyebrow}
        </p>
        <h2
          id={id}
          className="mt-1.5 text-[20px] font-extrabold text-ink"
        >
          {title}
        </h2>
        {desc && (
          <p className="mt-1 max-w-2xl text-[13px] leading-6 text-muted">
            {desc}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

/** The most recent document, as a wide «continue» card. */
function ContinueCard({
  project,
  onOpen,
}: {
  project: ProjectMeta;
  onOpen: (id: string) => void;
}) {
  const theme = THEMES[project.theme] || THEMES.official;
  return (
    <div className="shadow-card group grid overflow-hidden rounded-2xl border border-line bg-surface transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover sm:grid-cols-[180px_minmax(0,1fr)]">
      <button
        type="button"
        onClick={() => onOpen(project.id)}
        aria-label={`متابعة ${project.name}`}
        className="grid place-items-center border-b border-line/70 bg-paper/70 p-4 sm:border-b-0 sm:border-l"
      >
        <span className="block aspect-[210/297] h-[150px] overflow-hidden rounded-[5px] border border-line bg-surface shadow-md transition group-hover:scale-[1.02]">
          {project.thumbnail ? (
            <img
              src={project.thumbnail}
              alt=""
              aria-hidden
              className="h-full w-full object-contain object-top"
            />
          ) : (
            <span className="flex h-full w-full flex-col">
              <span
                className="block h-5 shrink-0"
                style={{ background: theme.primary }}
              />
              <span
                className="block h-[3px] shrink-0"
                style={{ background: theme.accent }}
              />
              <span className="mx-2.5 mt-3 block h-1.5 rounded bg-navy/15" />
              <span className="mx-2.5 mt-2 block h-1 w-2/3 rounded bg-navy/10" />
            </span>
          )}
        </span>
      </button>
      <div className="flex min-w-0 flex-col justify-between gap-4 p-5 sm:p-6">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-navy/10 px-2.5 py-1 text-[10px] font-extrabold text-brand">
            <Clock3 className="size-3" /> آخر ما عملت عليه
          </span>
          <h3 className="mt-3 line-clamp-2 break-words text-[18px] font-extrabold leading-7 text-ink">
            {project.name}
          </h3>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-semibold text-muted">
            {project.orgName && (
              <>
                <span className="truncate">{project.orgName}</span>
                <span aria-hidden>·</span>
              </>
            )}
            <span>{pagesLabel(project.pages)}</span>
            <span aria-hidden>·</span>
            <span>عُدِّل {relativeTime(project.updatedAt)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(project.id)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-navy px-4 text-[13px] font-extrabold text-on-brand shadow-sm transition hover:bg-navy-2"
          >
            <FolderOpen className="size-4" />
            متابعة التحرير
          </button>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-muted">
            <span
              className="size-2.5 rounded-full"
              style={{ background: theme.primary }}
              aria-hidden
            />
            {theme.name}
          </span>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceHomePage({ license }: { license: LicenseState }) {
  const { user } = useCurrentUserState();
  const hydrate = useEditor((s) => s.hydrate);
  const hydrated = useEditor((s) => s.hydrated);
  const projects = useEditor((s) => s.projects);
  const projectsLoading = useEditor((s) => s.projectsLoading);
  const createDocument = useEditor((s) => s.createDocument);
  const setEntitlements = useEditor((s) => s.setEntitlements);
  const storeOrg = useEditor((s) => s.orgName);
  const entitlements = license.entitlements;
  const brand = useBrandIdentity();
  /*
   * استوديو الاستيراد (/import) is a template-manager entitlement. The card
   * only appears for accounts that hold it — a visitor without the right sees
   * no dead-end link, exactly like every other entitlement-scoped surface.
   */
  const [canImport, setCanImport] = useState(false);
  useEffect(() => {
    let alive = true;
    void import("@/lib/admin/functions")
      .then(({ adminTemplatesAccessFn }) => adminTemplatesAccessFn())
      .then((access) => alive && setCanImport(access.ok))
      .catch(() => alive && setCanImport(false));
    return () => {
      alive = false;
    };
  }, []);

  const [newDoc, setNewDoc] = useState<Partial<NewDocumentConfig> | null>(null);
  const [pill, setPill] = useState<FeaturedPill>("featured");
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const [projectQuery, setProjectQuery] = useState("");
  const busy = useRef(false);

  // The store enforces the same server-derived ceilings the editor applies.
  useEffect(() => {
    setEntitlements(entitlements);
  }, [entitlements, setEntitlements]);

  useEffect(() => {
    void hydrate().then(() => useEditor.getState().refreshProjects());
  }, [hydrate]);

  // «مستند جديد» from the site header (in place) or from elsewhere (?new=1).
  useEffect(() => {
    const open = () => setNewDoc({});
    window.addEventListener(OPEN_NEW_DOCUMENT_EVENT, open);
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      open();
      params.delete("new");
      const rest = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${rest ? `?${rest}` : ""}`,
      );
    }
    return () => window.removeEventListener(OPEN_NEW_DOCUMENT_EVENT, open);
  }, []);

  const recent = useMemo(
    () => {
      const query = projectQuery.trim().toLocaleLowerCase("ar");
      return [...projects]
        .filter((project) =>
          !query ||
          `${project.name} ${project.orgName || ""}`
            .toLocaleLowerCase("ar")
            .includes(query),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    [projects, projectQuery],
  );
  const [latest, ...others] = recent;

  /* ── templates ─────────────────────────────────────────────────────── */

  const entries = useCatalogEntries("official", storeOrg);
  const packLocked = useCallback(
    (entry: CatalogEntry) =>
      entry.managedTemplate
        ? entry.managedTemplate.tier === "licensed" && !entitlements.premium_templates
        : entry.kind === "pack" && !canUseDemoPack(entry.sourceId) && !entitlements.premium_templates,
    [entitlements.premium_templates],
  );

  const featured = useMemo(() => {
    const custom = entries.filter((e) => e.kind === "custom").slice(0, 2);
    const packs = entries.filter(
      (e) => e.kind === "pack" && e.sourceId !== "blank",
    );
    // Single-page templates top the row up so the featured shelf is full.
    const pages = entries.filter((e) => e.kind === "page");
    return [...custom, ...packs, ...pages].slice(0, HOME_TEMPLATE_LIMIT);
  }, [entries]);

  const pills = useMemo(
    () =>
      CATALOG_PILLS.filter((p) => p.id !== "all")
        .map((p) => ({
          ...p,
          count: entries.filter((e) => e.pills.includes(p.id)).length,
        }))
        .filter((p) => p.count > 0),
    [entries],
  );

  const shown = useMemo(() => {
    if (pill === "featured") return featured;
    return entries.filter((e) => e.pills.includes(pill));
  }, [entries, featured, pill]);

  const quickEntry = quickViewId
    ? (entries.find((e) => e.id === quickViewId) ?? null)
    : null;

  /* ── actions ───────────────────────────────────────────────────────── */

  /** Open the selected saved document directly at its durable editor URL. */
  const open = (id: string) => {
    window.location.assign(editorPathFor(id));
  };

  /** «استخدام القالب» — a NEW editable document; the template stays as it is. */
  const startFromTemplate = async (entry: CatalogEntry) => {
    if (busy.current) return;
    if (!entry.managedTemplate && packLocked(entry)) {
      window.location.assign("/license");
      return;
    }
    busy.current = true;
    try {
      await hydrate();
      let seed: ReturnType<typeof entryProjectSeed>;
      if (entry.managedTemplate) {
        const result = await getPublishedTemplateFn({
          data: { id: templateDisplaySlug(entry.managedTemplate) },
        });
        if (!result.ok) {
          if ("locked" in result && result.locked) {
            window.location.assign("/license");
          } else {
            toast.error(result.error || "القالب غير متاح");
          }
          return;
        }
        const managed = publishedTemplateSeed(result.template);
        const context = entryProjectSeed(entry, {
          themeId: "official",
          orgName: storeOrg,
        });
        seed = applyBrandToSeed(mergePublishedTemplateContext(managed, context), brand.kit);
      } else {
        seed = applyBrandToSeed(
          entryProjectSeed(entry, {
            themeId: "official",
            orgName: storeOrg,
          }),
          brand.kit,
        );
      }
      const created = await createDocument(
        {
          version: 2,
          ...seed,
        },
        { autoName: true },
      );
      const newId = useEditor.getState().id;
      if (created && newId) window.location.assign(editorPathFor(newId));
    } catch (error) {
      // A failed fetch or an unreadable template payload must never leave the
      // click without an answer.
      console.error(error);
      toast.error("تعذر فتح القالب", {
        description: "تحقق من الاتصال ثم أعد المحاولة.",
      });
    } finally {
      busy.current = false;
    }
  };

  const summary = licenseSummary(license);
  const { label: accountName, hasProfileName } = accountIdentity(user);
  const greetingName = hasProfileName ? accountName.split(/\s+/)[0] : "";
  const templateCount = entries.length;

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader current={WORKSPACE_ROUTE} />

      <main className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-8 sm:px-6 md:gap-12 md:py-12">
        {/* ── 1. NASAQ introduction ─────────────────────────────────────── */}
        <section
          aria-labelledby="home-intro"
          className="shadow-card relative overflow-hidden rounded-3xl border border-line bg-surface"
        >
          {/* Institutional pattern: a quiet grid of rules, not an illustration. */}
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 hidden h-full w-[46%] text-brand/[0.07] md:block"
            viewBox="0 0 400 300"
            preserveAspectRatio="xMinYMid slice"
          >
            {Array.from({ length: 9 }, (_, i) => (
              <line
                key={`h${i}`}
                x1="0"
                x2="400"
                y1={i * 36 + 6}
                y2={i * 36 + 6}
                stroke="currentColor"
                strokeWidth="1"
              />
            ))}
            {Array.from({ length: 12 }, (_, i) => (
              <line
                key={`v${i}`}
                y1="0"
                y2="300"
                x1={i * 36 + 6}
                x2={i * 36 + 6}
                stroke="currentColor"
                strokeWidth="1"
              />
            ))}
            <rect
              x="42"
              y="42"
              width="108"
              height="144"
              rx="4"
              fill="currentColor"
            />
            <rect
              x="186"
              y="78"
              width="144"
              height="72"
              rx="4"
              fill="currentColor"
            />
          </svg>
          <span
            aria-hidden
            className="absolute inset-y-0 right-0 w-1.5 bg-gradient-to-b from-navy via-navy-2 to-gold"
          />

          <div className="relative grid gap-6 p-6 sm:p-8 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:items-center md:p-10">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/15 bg-navy/5 px-3 py-1 text-[11px] font-bold text-brand">
                  <Sparkles className="size-3.5" /> مساحة عمل نَسَق
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-brand bg-ok/10 px-3 py-1 text-[11px] font-extrabold text-success">
                  <ShieldCheck className="size-3.5" /> {summary.label}
                  {summary.detail && (
                    <span className="font-bold opacity-80">
                      · {summary.detail}
                    </span>
                  )}
                </span>
              </div>
              <h1
                id="home-intro"
                className="mt-4 text-[26px] font-extrabold leading-[1.3] text-ink sm:text-[32px]"
              >
                {greetingName ? `مرحبًا ${greetingName}، ` : "مرحبًا بك، "}
                <span className="text-brand">
                  لنُنجز مستندك التالي
                </span>
              </h1>
              <p className="mt-3 max-w-xl text-[14px] leading-7 text-muted">
                نَسَق منصة مؤسسية لإعداد التقارير الرسمية والخطابات والعروض
                التنفيذية ولوحات المؤشرات — بهوية بصرية موحّدة، وخطوط عربية
                رسمية، وتصدير جاهز للطباعة بدقة 300 DPI. تُحفظ مستنداتك تلقائيًا
                في متصفحك.
              </p>
            </div>

            <dl className="grid grid-cols-3 gap-2.5 md:grid-cols-1 lg:grid-cols-3">
              {[
                {
                  icon: Files,
                  label: "مستنداتك",
                  value:
                    projectsLoading && !hydrated
                      ? "…"
                      : String(projects.length),
                },
                {
                  icon: LayoutTemplate,
                  label: "قوالب مرخّصة",
                  value: String(templateCount),
                },
                {
                  icon: Clock3,
                  label: "آخر تعديل",
                  value: latest ? relativeTime(latest.updatedAt) : "—",
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-line/80 bg-surface/80 p-3.5 backdrop-blur-[2px]"
                >
                  <dt className="flex items-center gap-1.5 text-[11px] font-bold text-muted">
                    <stat.icon className="size-3.5" aria-hidden />
                    {stat.label}
                  </dt>
                  <dd className="mt-1.5 truncate text-[18px] font-extrabold tabular-nums text-ink">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── 2. Create New Document ────────────────────────────────────── */}
        <section aria-labelledby="home-create" className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionHeading
              id="home-create"
              eyebrow="ابدأ من هنا"
              title="إنشاء مستند جديد"
              desc="إعدادات افتراضية جاهزة للبدء فورًا، مع تحكم كامل في النوع والمقاس والاتجاه وعدد الصفحات قبل الدخول إلى المحرر."
            />
            {/* Install NASAQ as a desktop app, straight from the workspace. */}
            <AppInstallNotice variant="button" />
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)]">
            <button
              type="button"
              onClick={() => setNewDoc({})}
              data-testid="home-new-document"
              className="group relative flex min-h-[168px] flex-col justify-between overflow-hidden rounded-2xl bg-navy p-5 text-right text-on-brand shadow-lg shadow-navy/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-navy-2 hover:shadow-xl dark:shadow-black/30"
            >
              <span
                aria-hidden
                className="absolute -bottom-10 -left-10 size-40 rounded-full border-[18px] border-white/[0.06]"
              />
              <span className="grid size-11 place-items-center rounded-xl bg-surface/15 transition group-hover:bg-surface/25">
                <FilePlus2 className="size-5" />
              </span>
              <span className="relative">
                <span className="block text-[18px] font-extrabold">
                  مستند جديد
                </span>
                <span className="mt-1 block text-[12px] font-semibold text-white/75">
                  افتراضيًا: A4 رأسي · صفحة واحدة · السمة الرسمية
                </span>
              </span>
              <span className="absolute left-5 top-5 inline-flex items-center gap-1 text-[11px] font-extrabold text-white/80 transition group-hover:-translate-x-0.5">
                ابدأ <ArrowLeft className="size-3.5" />
              </span>
            </button>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {QUICK_STARTS.map((q) => (
                <button
                  key={q.kind}
                  type="button"
                  onClick={() => {
                    const kind = docKind(q.kind);
                    setNewDoc({
                      kind: kind.id,
                      size: kind.size,
                      orientation: kind.orientation,
                    });
                  }}
                  className="shadow-card group flex flex-col items-start gap-2 rounded-2xl border border-line bg-surface p-4 text-right transition-all duration-200 hover:-translate-y-0.5 hover:border-brand hover:shadow-card-hover"
                >
                  <span className="grid size-9 place-items-center rounded-lg bg-navy/10 text-brand transition group-hover:bg-navy-2 group-hover:text-on-brand">
                    <q.icon className="size-4" />
                  </span>
                  <span className="text-[13px] font-extrabold text-ink">
                    {q.title}
                  </span>
                  <span className="text-[11px] font-bold text-muted">
                    {q.desc}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setNewDoc({ start: "template" })}
                className="shadow-card group flex flex-col items-start gap-2 rounded-2xl border border-dashed border-gold/60 bg-gold/[0.07] p-4 text-right transition-all duration-200 hover:-translate-y-0.5 hover:border-gold/60 hover:shadow-card-hover"
              >
                <span className="grid size-9 place-items-center rounded-lg bg-gold/25 text-ink">
                  <RectangleHorizontal className="size-4" />
                </span>
                <span className="text-[13px] font-extrabold text-ink">
                  من حزمة جاهزة
                </span>
                <span className="text-[11px] font-bold text-muted">
                  تقارير وعروض متعددة الصفحات
                </span>
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-line bg-surface-2 px-4 py-3">
            <ProjectFileButton />
            {canImport && (
              <a
                href={IMPORT_ROUTE}
                className="shadow-card group inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-right transition-all duration-200 hover:-translate-y-0.5 hover:border-gold/60 hover:shadow-card-hover"
              >
                <span className="grid size-8 place-items-center rounded-lg bg-gold/20 text-ink">
                  <LayoutTemplate className="size-4" aria-hidden />
                </span>
                <span>
                  <span className="block text-[12px] font-extrabold text-ink">
                    استيراد قالب — PSD وWord وPowerPoint وPDF
                  </span>
                  <span className="block text-[10.5px] font-bold text-muted">
                    تحويل إلى مستند قابل للتحرير مع فحص وإصلاح تلقائي للعناصر
                  </span>
                </span>
              </a>
            )}
            <span className="text-[11px] font-semibold text-muted">
              لديك مشروع محفوظ؟ افتح ملف نَسَق ‎.nsq‎ أو نسخة احتياطية لمتابعة العمل.
            </span>
          </div>
        </section>

        {/* ── 3. Recent documents / projects ────────────────────────────── */}
        <section aria-labelledby="home-recent" className="grid gap-4">
          <SectionHeading
            id="home-recent"
            eyebrow="متابعة العمل"
            title="المستندات والمشاريع الأخيرة"
            action={
              <div className="flex flex-wrap items-center justify-end gap-2">
                {projects.length > 2 && (
                  <label className="relative">
                    <Search className="pointer-events-none absolute end-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
                    <input
                      value={projectQuery}
                      onChange={(event) => setProjectQuery(event.target.value)}
                      placeholder="ابحث في مشاريعك…"
                      aria-label="البحث في المشاريع"
                      className="h-10 w-[min(220px,70vw)] rounded-xl border border-line bg-surface pe-8 ps-3 text-[12px] font-bold outline-none transition focus:border-navy"
                    />
                  </label>
                )}
                <a
                  href="/projects"
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[12px] font-extrabold text-ink transition hover:bg-line-2"
                >
                  <FolderOpen className="size-4" />
                  كل المستندات{projects.length ? ` (${projects.length})` : ""}
                </a>
              </div>
            }
          />

          {!hydrated || projectsLoading ? (
            <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <div className="shadow-card h-[200px] animate-pulse rounded-2xl border border-line bg-surface" />
              <div className="shadow-card h-[200px] animate-pulse rounded-2xl border border-line bg-surface" />
            </div>
          ) : !latest && projectQuery ? (
            <div className="grid place-items-center rounded-2xl border border-dashed border-line bg-surface-2 px-6 py-12 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-navy/10 text-brand">
                <Search className="size-5" />
              </span>
              <p className="mt-3 text-[15px] font-extrabold text-ink">
                لا توجد نتائج مطابقة
              </p>
              <p className="mt-1 max-w-md text-[13px] leading-6 text-muted">
                جرّب البحث باسم المشروع أو الجهة، أو امسح البحث لعرض أحدث أعمالك.
              </p>
              <button
                type="button"
                onClick={() => setProjectQuery("")}
                className="mt-5 inline-flex h-10 items-center rounded-xl border border-line px-4 text-[12px] font-bold text-ink transition hover:bg-line-2"
              >
                عرض كل المشاريع
              </button>
            </div>
          ) : !latest ? (
            <div className="grid place-items-center rounded-2xl border border-dashed border-line bg-surface-2 px-6 py-12 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-navy/10 text-brand">
                <Files className="size-5" />
              </span>
              <p className="mt-3 text-[15px] font-extrabold text-ink">
                لا توجد مستندات بعد
              </p>
              <p className="mt-1 max-w-md text-[13px] leading-6 text-muted">
                أنشئ مستندك الأول بالإعدادات الافتراضية، أو ابدأ من قالب مرخّص —
                سيظهر هنا كل ما تعمل عليه لتتابعه بنقرة واحدة.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setNewDoc({})}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-navy px-4 text-[12px] font-extrabold text-on-brand transition hover:bg-navy-2"
                >
                  <FilePlus2 className="size-4" /> إنشاء مستند جديد
                </button>
                <a
                  href="#home-templates"
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-[12px] font-bold text-ink transition hover:bg-line-2"
                >
                  <LayoutTemplate className="size-4" /> تصفح القوالب
                </a>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              <ContinueCard project={latest} onOpen={(id) => void open(id)} />
              {others.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {others.slice(0, 3).map((p) => (
                    <ProjectCard key={p.id} project={p} onOpen={open} compact />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── 4. Licensed templates ─────────────────────────────────────── */}
        <section
          id="home-templates"
          aria-labelledby="home-templates-title"
          className="grid scroll-mt-24 gap-4"
        >
          <SectionHeading
            id="home-templates-title"
            eyebrow="مكتبة القوالب"
            title="القوالب المرخّصة"
            desc="قوالب مؤسسية جاهزة ضمن ترخيصك — «استخدام القالب» ينشئ مستندًا جديدًا قابلًا للتحرير ويبقى القالب الأصلي كما هو."
            action={
              <a
                href={TEMPLATES_ROUTE}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[12px] font-extrabold text-ink transition hover:bg-line-2"
              >
                <LayoutTemplate className="size-4" />
                مكتبة القوالب الكاملة
              </a>
            }
          />

          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="تصنيفات القوالب"
          >
            {[
              {
                id: "featured" as FeaturedPill,
                label: "مختارة لك",
                count: featured.length,
              },
              ...pills,
            ].map((option) => {
              const active = pill === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPill(option.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12px] font-extrabold transition",
                    active
                      ? "border-brand bg-navy text-on-brand shadow-sm"
                      : "border-line bg-surface text-muted hover:border-brand hover:text-ink",
                  )}
                >
                  {option.id === "featured" && (
                    <Sparkles className="size-3.5" aria-hidden />
                  )}
                  {option.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                      active
                        ? "bg-white/20 text-white"
                        : "bg-line-2 text-muted",
                    )}
                  >
                    {option.count}
                  </span>
                </button>
              );
            })}
          </div>

          {shown.length === 0 ? (
            <div className="grid place-items-center rounded-2xl border border-dashed border-line bg-surface-2 px-6 py-12 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-gold/20 text-ink">
                <LayoutTemplate className="size-5" />
              </span>
              <p className="mt-3 text-[15px] font-extrabold text-ink">
                لا توجد قوالب متاحة هنا بعد
              </p>
              <p className="mt-1 max-w-md text-[13px] leading-6 text-muted">
                جرّب تصنيفًا آخر، أو افتح مكتبة القوالب الكاملة لإضافة قالب خاص
                من أحد مستنداتك.
              </p>
              <a
                href={TEMPLATES_ROUTE}
                className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-[12px] font-bold text-ink transition hover:bg-line-2"
              >
                مكتبة القوالب
              </a>
            </div>
          ) : (
            <>
              <div className={CARD_WRAP}>
                {shown.slice(0, HOME_TEMPLATE_LIMIT).map((entry) => (
                  <div key={entry.id} className={cn("flex", CARD_W)}>
                    <TemplateCard
                      entry={entry}
                      href={templatePathFor(entrySlug(entry))}
                      locked={packLocked(entry)}
                      available={!packLocked(entry)}
                      actions={{
                        onUse: () => void startFromTemplate(entry),
                        onQuickView: () => setQuickViewId(entry.id),
                      }}
                    />
                  </div>
                ))}
              </div>
              {shown.length > HOME_TEMPLATE_LIMIT && (
                <div className="flex justify-center">
                  <a
                    href={TEMPLATES_ROUTE}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[12px] font-extrabold text-ink transition hover:bg-line-2"
                  >
                    عرض كل القوالب ({shown.length})
                    <ArrowLeft className="size-4" />
                  </a>
                </div>
              )}
            </>
          )}

          <PublishedTemplates />
        </section>
      </main>

      <SiteFooter />

      {newDoc && (
        <NewDocumentDialog
          initial={newDoc}
          onClose={() => setNewDoc(null)}
          onCreated={() => {
            /* The dialog created the document; its own address opens it. */
            const id = useEditor.getState().id;
            window.location.assign(id ? editorPathFor(id) : CREATE_ROUTE);
          }}
        />
      )}

      {quickEntry && (
        <QuickViewDialog
          entry={quickEntry}
          themeId="official"
          onClose={() => setQuickViewId(null)}
          onUse={() => {
            setQuickViewId(null);
            void startFromTemplate(quickEntry);
          }}
        />
      )}
    </div>
  );
}

/**
 * `/home` gate: the Home is the licensed account's starting point.
 *
 * Waits for the server-resolved licence (never a flash of the wrong page); a
 * licensed or administrator account gets its Home, every other signed-in
 * account keeps the door it already had — straight into the editor, with the
 * restrictions the editor applies from the same entitlements.
 */
export function LicensedWorkspaceHome() {
  const { user } = useCurrentUserState();
  const license = useLicense(user?.id, user?.primaryEmail ?? null);
  if (license.isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper text-[13px] font-bold text-muted">
        جارٍ تجهيز مساحة العمل…
      </div>
    );
  }
  const licensed =
    !license.isSuspended && (license.hasLicense || license.isAdmin);
  if (!licensed) return <Navigate to={CREATE_ROUTE} replace />;
  return <WorkspaceHomePage license={license} />;
}
