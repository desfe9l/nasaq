import { useEffect, useRef, useState } from "react";
import { Database, Download, FolderOpen, Grid2X2, HardDriveDownload, List, Plus, Search, ShieldCheck } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { PACKS } from "@/lib/editor/templates";
import { useEditor } from "@/lib/editor/store";
import type { ProjectMeta } from "@/lib/editor/model";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { ProjectCard } from "@/components/site/ProjectCard";
import { cn } from "@/lib/utils";
import { NSQ_ACCEPT, isNsqFileName } from "@/lib/nsq/format";
import { downloadLibraryFile } from "@/lib/editor/library-export";
import { hasSignedInOwner } from "@/lib/editor/storage-owner";
import { CREATE_ROUTE, editorPathFor } from "@/lib/site-routes";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { accountIdentity } from "@/lib/auth/identity";
import { useLicense } from "@/lib/license/client";

type FilterId = "all" | "reports" | "letters" | "favorites";
type ViewId = "grid" | "list";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "reports", label: "التقارير" },
  { id: "letters", label: "الخطابات" },
  { id: "favorites", label: "المفضلة" },
];

/** Category heuristic: name/pack first, so custom titles still classify.
 * Reports and letters partition the shelf; favourites overlay either. */
function matchesFilter(p: ProjectMeta, filter: FilterId): boolean {
  if (filter === "all") return true;
  if (filter === "favorites") return Boolean(p.favorite);
  const isLetter = /خطاب|مراسلة|تعميم/.test(p.name || "") || p.pack === "briefing";
  if (filter === "letters") return isLetter;
  return !isLetter;
}

function formatMB(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ProjectsPage() {
  const hydrate = useEditor((s) => s.hydrate);
  const projects = useEditor((s) => s.projects);
  const projectsLoading = useEditor((s) => s.projectsLoading);
  const refreshProjects = useEditor((s) => s.refreshProjects);
  const importProject = useEditor((s) => s.importProject);
  const storage = useEditor((s) => s.storage);
  const assets = useEditor((s) => s.assets);
  const assetFolders = useEditor((s) => s.assetFolders);
  const setEntitlements = useEditor((s) => s.setEntitlements);
  const { user } = useCurrentUserState();
  const { entitlements } = useLicense(
    user?.id,
    user?.primaryEmail,
  );
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name" | "pages">("recent");
  const [filter, setFilter] = useState<FilterId>("all");
  const [view, setView] = useState<ViewId>("grid");
  const [usedBytes, setUsedBytes] = useState<number | null>(null);
  const [quotaBytes, setQuotaBytes] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEntitlements(entitlements);
  }, [entitlements, setEntitlements]);

  useEffect(() => {
    void hydrate().then(() => refreshProjects());
  }, [hydrate, refreshProjects]);

  // IndexedDB storage meter — real usage reported by the browser, not a guess.
  useEffect(() => {
    let cancelled = false;
    navigator.storage
      ?.estimate?.()
      .then((est) => {
        if (cancelled) return;
        if (typeof est.usage === "number") setUsedBytes(est.usage);
        if (typeof est.quota === "number" && est.quota > 0) setQuotaBytes(est.quota);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projects.length]);

  const filtered = projects
    .filter((p) => matchesFilter(p, filter))
    .filter((p) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return p.name.toLowerCase().includes(needle) || p.orgName.toLowerCase().includes(needle);
    })
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "ar");
      if (sort === "pages") return b.pages - a.pages;
      return b.updatedAt - a.updatedAt;
    });

  /*
   * A project card's Open/Edit action enters the editor at that exact saved
   * document. The editor route resolves the full record before mounting the
   * canvas; it never opens the generic editor entry or substitutes another
   * project. New documents still go through the creation screen below.
   */
  const open = (id: string) => {
    window.location.assign(editorPathFor(id));
  };

  const startNew = () => {
    window.location.assign(CREATE_ROUTE);
  };
  /** Pinned first cell: the dashed «create document» tile every view starts with. */
  const createCard = (
    <button
      type="button"
      onClick={() => void startNew()}
      className="group flex min-h-[172px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line bg-surface/50 p-6 text-center transition-all duration-200 hover:-translate-y-1 hover:border-brand hover:bg-surface hover:shadow-card-hover"
    >
      <span className="grid size-12 place-items-center rounded-full bg-navy/10 text-brand transition group-hover:bg-navy-2 group-hover:text-on-brand">
        <Plus className="size-6" />
      </span>
      <span className="text-[14px] font-extrabold">إنشاء مستند جديد</span>
      <span className="text-[12px] leading-5 text-muted">
        ابدأ بصفحة فارغة وابنِ مستندك من الصفر
      </span>
    </button>
  );

  const emptyState = (
    <div className="mt-6 rounded-xl border border-dashed border-line p-10 text-center">
      <p className="text-[14px] font-bold">
        {projects.length ? "لا نتائج مطابقة للتصفية" : "لا توجد مشاريع بعد"}
      </p>
      <p className="mt-1 text-[13px] text-muted">
        {projects.length
          ? "جرّب كلمة بحث أخرى أو غيّر التصفية أو الترتيب."
          : "ابدأ من قالب جاهز — كل قالب ينشئ نسخة مستقلة داخل مشروعك."}
      </p>
      {!projects.length && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {PACKS.slice(0, 3).map((pack) => (
            <button
              key={pack.id}
              type="button"
              onClick={() => {
                if (pack.id !== "blank") {
                  window.location.assign("/purchase");
                  return;
                }
                // A signed-in account starts a real document in the editor;
                // only a visitor with no session is sent to the demo page.
                void startNew();
              }}
              className="rounded-[8px] border border-line px-3 py-2 text-[12px] font-bold"
            >
              {pack.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader current="/projects" />

      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 md:py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-extrabold">مشاريعي</h1>
            <p className="mt-1 text-[13px] leading-6 text-muted">
              {BRAND.nameAr} — {BRAND.platformEn}. كل مشروع يحتوي صفحات متعددة، وتُحفظ الملفات{" "}
              {storage.mode === "indexeddb" ? "في IndexedDB داخل متصفحك" : "في LocalStorage"}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Storage meter — honest local usage, no server involved. */}
            {usedBytes !== null && (
              <span
                title="حجم البيانات المحفوظة محليًا في متصفحك"
                className="inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 text-[12px] font-bold tabular-nums text-muted"
              >
                <Database className="size-3.5" aria-hidden />
                {formatMB(usedBytes)}
                {quotaBytes !== null && (
                  <>
                    <span className="text-muted/70">من {formatMB(quotaBytes)}</span>
                    <span className="ms-1 inline-block h-1.5 w-16 overflow-hidden rounded-full bg-line-2" aria-hidden>
                      <span
                        className="block h-full rounded-full bg-ok"
                        style={{ width: `${Math.min(100, Math.max(2, (usedBytes / quotaBytes) * 100))}%` }}
                      />
                    </span>
                  </>
                )}
              </span>
            )}
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-line px-4 text-[13px] font-bold"
            >
              <FolderOpen className="size-4" />
              فتح ملف نَسَق
            </button>
          </div>
        </div>

        {/*
         * «مساحتي» — the personal library, stated plainly.
         *
         * Projects and assets in this browser are scoped to the current owner
         * (`storage-owner.ts`): a visitor sees the visitor shelf, an account
         * sees its own. The card says which one is open, how much is in it, and
         * offers the one operation that makes a local-only library safe — a
         * backup file the author keeps.
         */}
        <section
          aria-label="مساحتي — المكتبة الشخصية"
          className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-4"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand-hover">
            {hasSignedInOwner() ? (
              <ShieldCheck className="size-5" aria-hidden />
            ) : (
              <HardDriveDownload className="size-5" aria-hidden />
            )}
          </span>
          <div className="min-w-[220px] flex-1">
            <strong className="block text-[14px] font-extrabold text-ink">
              {hasSignedInOwner()
                ? "مكتبتك الشخصية مرتبطة بحسابك"
                : "مكتبة الزائر — داخل هذا المتصفح فقط"}
            </strong>
            <p className="mt-1 text-[12px] leading-6 text-muted">
              {hasSignedInOwner()
                ? `${accountIdentity(user).label} — تُعرض مشاريعك ومكتبتك فقط، ولا تظهر مشاريع حساب آخر على هذا المتصفح.`
                : "أنشئ حسابًا لتُربط المشاريع والمكتبة بحسابك؛ قبل ذلك تبقى هذه المكتبة المحلية للزائر على هذا المتصفح."}
            </p>
          </div>
          <dl className="flex flex-wrap items-center gap-4 text-[12px]">
            <div className="text-center">
              <dt className="text-muted">مشاريع</dt>
              <dd className="text-[16px] font-extrabold tabular-nums text-ink">{projects.length}</dd>
            </div>
            <div className="text-center">
              <dt className="text-muted">صفحات</dt>
              <dd className="text-[16px] font-extrabold tabular-nums text-ink">
                {projects.reduce((sum, project) => sum + (project.pages || 0), 0)}
              </dd>
            </div>
            <div className="text-center">
              <dt className="text-muted">عناصر محفوظة</dt>
              <dd className="text-[16px] font-extrabold tabular-nums text-ink">{assets.length}</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={() => {
              const name = downloadLibraryFile({ folders: assetFolders, assets });
              void import("sonner").then(({ toast }) =>
                toast.success(`تم تنزيل نسخة من مكتبتك — ${name}`),
              );
            }}
            disabled={!assets.length && !assetFolders.length}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-line px-4 text-[13px] font-bold disabled:opacity-50"
            title="نسخة احتياطية من مكتبة العناصر والمجلدات كملف JSON"
          >
            <Download className="size-4" aria-hidden />
            نسخة احتياطية للمكتبة
          </button>
        </section>

        <input
          ref={fileInput}
          type="file"
          accept={NSQ_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (isNsqFileName(file.name)) {
              // Validated and preserved first, then opened by the editor
              // (which asks a visitor to sign in without losing the file).
              e.target.value = "";
              void import("@/lib/nsq/intake").then((m) => m.receiveAndContinueInEditor(file));
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              try {
                void importProject(JSON.parse(String(reader.result))).then(() => {
                  const id = useEditor.getState().id;
                  if (id) window.location.assign(editorPathFor(id));
                });
              } catch {
                void import("sonner").then(({ toast }) =>
                  toast.error("تعذر قراءة الملف — تأكد أنه ملف مشروع بصيغة JSON"),
                );
              }
            };
            reader.onerror = () =>
              void import("sonner").then(({ toast }) => toast.error("تعذر قراءة الملف"));
            reader.readAsText(file);
            e.target.value = "";
          }}
        />

        {/* Toolbar: search + sort on one row, filter chips + view toggle below. */}
        <div className="mt-6 flex flex-wrap gap-2">
          <label className="relative min-w-[220px] flex-1">
            <Search className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث باسم المشروع أو الجهة"
              aria-label="بحث في المشاريع"
              className="h-11 w-full rounded-[10px] border border-line bg-surface pr-9 pl-3 text-[13px] font-semibold"
            />
          </label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "recent" | "name" | "pages")}
            aria-label="ترتيب المشاريع"
            className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-semibold"
          >
            <option value="recent">الأحدث تعديلاً</option>
            <option value="name">الاسم أبجدياً</option>
            <option value="pages">الأكثر صفحات</option>
          </select>
          <div
            role="group"
            aria-label="طريقة العرض"
            className="flex h-11 items-center rounded-[10px] border border-line bg-surface p-1"
          >
            <button
              type="button"
              onClick={() => setView("grid")}
              aria-pressed={view === "grid"}
              aria-label="عرض شبكي"
              title="عرض شبكي"
              className={cn(
                "grid size-9 place-items-center rounded-[7px] transition",
                view === "grid"
                  ? "bg-navy text-on-brand"
                  : "text-muted hover:bg-line-2",
              )}
            >
              <Grid2X2 className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
              aria-label="عرض قائمة مضغوط"
              title="قائمة مضغوطة"
              className={cn(
                "grid size-9 place-items-center rounded-[7px] transition",
                view === "list"
                  ? "bg-navy text-on-brand"
                  : "text-muted hover:bg-line-2",
              )}
            >
              <List className="size-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="تصفية المشاريع">
          {FILTERS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilter(chip.id)}
              aria-pressed={filter === chip.id}
              className={cn(
                "rounded-full border px-4 py-1.5 text-[12px] font-bold transition",
                filter === chip.id
                  ? "border-brand bg-navy text-on-brand"
                  : "border-line bg-surface text-muted hover:border-brand hover:text-ink",
              )}
            >
              {chip.label}
              {chip.id === "favorites" && projects.some((p) => p.favorite)
                ? ` ⭐ ${projects.filter((p) => p.favorite).length}`
                : ""}
            </button>
          ))}
        </div>

        {projectsLoading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="shadow-card h-[240px] animate-pulse rounded-xl border border-line bg-surface"
              />
            ))}
          </div>
        ) : (
          <>
            {/* The dashed «new document» tile is always the first grid cell. */}
            {view === "grid" ? (
              <div className="mt-6 grid gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-3">
                {createCard}
                {filtered.map((p) => (
                  <ProjectCard key={p.id} project={p} onOpen={open} />
                ))}
              </div>
            ) : (
              <div className="mt-6 grid gap-3">
                {createCard}
                {filtered.map((p) => (
                  <ProjectCard key={p.id} project={p} onOpen={open} variant="list" />
                ))}
              </div>
            )}
            {!filtered.length && emptyState}
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
