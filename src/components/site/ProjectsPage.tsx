import { useEffect, useRef, useState } from "react";
import { FolderOpen, Search } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { PACKS } from "@/lib/editor/templates";
import { useEditor } from "@/lib/editor/store";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { ProjectCard } from "@/components/site/ProjectCard";

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
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void hydrate().then(() => refreshProjects());
  }, [hydrate, refreshProjects]);

  const filtered = projects
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

  return (
    <div className="min-h-full bg-paper dark:bg-[#111722]">
      <SiteHeader current="/projects" />

      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 md:py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-extrabold">مشاريعي</h1>
            <p className="mt-1 text-[13px] leading-6 text-muted">
              {BRAND.nameAr} — {BRAND.platform}. كل مشروع يحتوي صفحات متعددة، وتُحفظ الملفات{" "}
              {storage.mode === "indexeddb" ? "في IndexedDB داخل متصفحك" : "في LocalStorage"}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void startNew()}
              className="inline-flex h-11 items-center rounded-[10px] bg-navy px-4 text-[13px] font-extrabold text-white"
            >
              مشروع جديد
            </button>
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
        </div>

        {projectsLoading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="shadow-card dark:shadow-card-dark h-[172px] animate-pulse rounded-xl border border-line bg-white dark:border-white/10 dark:bg-white/5"
              />
            ))}
          </div>
        ) : filtered.length ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-3">
            {filtered.map((p) => (
              <ProjectCard key={p.id} project={p} onOpen={open} />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-dashed border-line p-10 text-center dark:border-white/15">
            <p className="text-[14px] font-bold">
              {projects.length ? "لا نتائج مطابقة للبحث" : "لا توجد مشاريع بعد"}
            </p>
            <p className="mt-1 text-[13px] text-muted">
              {projects.length
                ? "جرّب كلمة بحث أخرى أو غيّر الترتيب."
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
        )}
      </main>

      <SiteFooter />
    </div>
  );
}