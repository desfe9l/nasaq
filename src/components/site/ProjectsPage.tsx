import { useEffect, useRef, useState } from "react";
import { Database, FolderOpen, Grid2X2, List, Plus, Search } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { PACKS } from "@/lib/editor/templates";
import { useEditor } from "@/lib/editor/store";
import type { ProjectMeta } from "@/lib/editor/model";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { ProjectCard } from "@/components/site/ProjectCard";
import { cn } from "@/lib/utils";

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
  const openProject = useEditor((s) => s.openProject);
  const createProject = useEditor((s) => s.createProject);
  const importProject = useEditor((s) => s.importProject);
  const storage = useEditor((s) => s.storage);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name" | "pages">("recent");
  const [filter, setFilter] = useState<FilterId>("all");
  const [view, setView] = useState<ViewId>("grid");
  const [usedBytes, setUsedBytes] = useState<number | null>(null);
  const [quotaBytes, setQuotaBytes] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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

  const open = async (id: string) => {
    await openProject(id);
    window.location.assign("/editor");
  };

  const startNew = async () => {
    const created = await createProject("blank");
    if (created) window.location.assign("/editor");
  };

  /** Pinned first cell: the dashed «create document» tile every view starts with. */
  const createCard = (
    <button
      type="button"
      onClick={() => void startNew()}
      className="group flex min-h-[172px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line bg-white/50 p-6 text-center transition-all duration-200 hover:-translate-y-1 hover:border-navy-2 hover:bg-white hover:shadow-card-hover dark:border-white/15 dark:bg-white/5 dark:hover:border-gold-2/60 dark:hover:shadow-card-dark-hover"
    >
      <span className="grid size-12 place-items-center rounded-full bg-navy/10 text-navy transition group-hover:bg-navy group-hover:text-white dark:bg-white/10 dark:text-gold-2 dark:group-hover:bg-gold-2 dark:group-hover:text-navy">
        <Plus className="size-6" />
      </span>
      <span className="text-[14px] font-extrabold">إنشاء مستند جديد</span>
      <span className="text-[12px] leading-5 text-muted">
        ابدأ بصفحة فارغة وابنِ مستندك من الصفر
      </span>
    </button>
  );

  const emptyState = (
    <div className="mt-6 rounded-xl border border-dashed border-line p-10 text-center dark:border-white/15">
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
              onClick={() => window.location.assign(pack.id === "blank" ? "/demo" : "/purchase")}
              className="rounded-[8px] border border-line px-3 py-2 text-[12px] font-bold dark:border-white/10"
            >
              {pack.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-full bg-paper dark:bg-[#111722]">
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
                className="inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-line bg-white px-3 text-[12px] font-bold tabular-nums text-muted dark:border-white/10 dark:bg-white/5"
              >
                <Database className="size-3.5" aria-hidden />
                {formatMB(usedBytes)}
                {quotaBytes !== null && (
                  <>
                    <span className="text-muted/70">من {formatMB(quotaBytes)}</span>
                    <span className="ms-1 inline-block h-1.5 w-16 overflow-hidden rounded-full bg-line-2 dark:bg-white/10" aria-hidden>
                      <span
                        className="block h-full rounded-full bg-emerald-500"
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
              className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-line px-4 text-[13px] font-bold dark:border-white/10"
            >
              <FolderOpen className="size-4" />
              استيراد JSON
            </button>
          </div>
        </div>

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
                void importProject(JSON.parse(String(reader.result))).then(() => window.location.assign("/editor"));
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
              className="h-11 w-full rounded-[10px] border border-line bg-white pr-9 pl-3 text-[13px] font-semibold dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "recent" | "name" | "pages")}
            aria-label="ترتيب المشاريع"
            className="h-11 rounded-[10px] border border-line bg-white px-3 text-[13px] font-semibold dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            <option value="recent">الأحدث تعديلاً</option>
            <option value="name">الاسم أبجدياً</option>
            <option value="pages">الأكثر صفحات</option>
          </select>
          <div
            role="group"
            aria-label="طريقة العرض"
            className="flex h-11 items-center rounded-[10px] border border-line bg-white p-1 dark:border-white/10 dark:bg-white/5"
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
                  ? "bg-navy text-white"
                  : "text-muted hover:bg-line-2 dark:hover:bg-white/10",
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
                  ? "bg-navy text-white"
                  : "text-muted hover:bg-line-2 dark:hover:bg-white/10",
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
                  ? "border-navy bg-navy text-white"
                  : "border-line bg-white text-muted hover:border-navy-2 hover:text-ink dark:border-white/10 dark:bg-white/5 dark:hover:text-white",
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
                className="shadow-card dark:shadow-card-dark h-[240px] animate-pulse rounded-xl border border-line bg-white dark:border-white/10 dark:bg-white/5"
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
