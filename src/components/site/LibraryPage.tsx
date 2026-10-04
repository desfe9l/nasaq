/*
 * «المكتبة» — `/library`.
 *
 * The asset shelf (logos, images, uploaded icons and dividers) has always
 * existed inside the editor; this page gives it an address. It is the honest
 * inventory of what the account keeps in this browser: what is stored, in which
 * folder, how much space it takes, and the two operations that matter outside
 * the editor — a full backup, and removal of an item that should not be there.
 *
 * Editing stays in the editor: «المكتبة» is where a logo is *used*, so the page
 * links into the editor instead of pretending to be a second editor.
 */

import { useEffect, useMemo, useState } from "react";
import { Database, Download, FolderOpen, ImageIcon, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { useEditor } from "@/lib/editor/store";
import { downloadLibraryFile } from "@/lib/editor/library-export";
import { hasSignedInOwner } from "@/lib/editor/storage-owner";
import { accountIdentity } from "@/lib/auth/identity";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { LIBRARY_ROUTE, PROJECTS_ROUTE, WORKSPACE_ROUTE } from "@/lib/site-routes";
import { cn } from "@/lib/utils";

export function LibraryPage() {
  const hydrate = useEditor((s) => s.hydrate);
  const assets = useEditor((s) => s.assets);
  const assetsLoading = useEditor((s) => s.assetsLoading);
  const folders = useEditor((s) => s.assetFolders);
  const customIcons = useEditor((s) => s.customIcons);
  const removeAsset = useEditor((s) => s.removeAsset);
  const removeCustomIcon = useEditor((s) => s.removeCustomIcon);
  const { user } = useCurrentUserState();
  const [query, setQuery] = useState("");
  const [folderId, setFolderId] = useState<string | "all">("all");
  const [usedBytes, setUsedBytes] = useState<number | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  /* Real usage reported by the browser — never an estimate of our own. */
  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        if (typeof estimate.usage === "number") setUsedBytes(estimate.usage);
      })
      .catch(() => undefined);
  }, [assets.length]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (folderId !== "all" && (asset.folderId ?? null) !== (folderId === "root" ? null : folderId)) {
        return false;
      }
      if (!needle) return true;
      return asset.name.toLowerCase().includes(needle);
    });
  }, [assets, query, folderId]);

  const folderName = (id: string | null | undefined) =>
    id ? folders.find((folder) => folder.id === id)?.name ?? "مجلد محذوف" : "بدون مجلد";

  const backup = () => {
    const name = downloadLibraryFile({ folders, assets });
    toast.success(`تم تنزيل نسخة من مكتبتك — ${name}`);
  };

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader current={LIBRARY_ROUTE} />

      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:py-14">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-extrabold tracking-[0.2em] text-muted">
              NASAQ · LIBRARY
            </p>
            <h1 className="mt-1.5 text-[27px] font-extrabold text-ink">المكتبة</h1>
            <p className="mt-2 max-w-2xl text-[13.5px] leading-7 text-muted">
              الشعارات والصور والعناصر المحفوظة في{" "}
              {hasSignedInOwner()
                ? `مكتبة ${accountIdentity(user).label}`
                : "مكتبة الزائر على هذا المتصفح"}
              . استخدمها من داخل المحرر، وخذ نسخة احتياطية متى شئت.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={WORKSPACE_ROUTE}
              className="inline-flex h-10 items-center rounded-[10px] border border-line bg-surface px-3.5 text-[12.5px] font-bold text-ink transition hover:border-brand"
            >
              مساحة العمل
            </a>
            <a
              href={PROJECTS_ROUTE}
              className="inline-flex h-10 items-center rounded-[10px] border border-line bg-surface px-3.5 text-[12.5px] font-bold text-ink transition hover:border-brand"
            >
              المشاريع
            </a>
            <button
              type="button"
              onClick={backup}
              disabled={!assets.length && !folders.length}
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-navy px-4 text-[12.5px] font-extrabold text-on-brand transition hover:bg-navy-2 disabled:opacity-50"
            >
              <Download className="size-4" aria-hidden />
              نسخة احتياطية
            </button>
          </div>
        </header>

        {/* Inventory strip — the honest numbers, in one row. */}
        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="عناصر" value={String(assets.length)} />
          <Stat label="مجلدات" value={String(folders.length)} />
          <Stat label="أيقونات وفواصل" value={String(customIcons.length)} />
          <Stat
            label="المساحة المستخدمة"
            value={usedBytes === null ? "—" : formatBytes(usedBytes)}
          />
        </section>

        {/* Toolbar: search + folder filter. */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <Search className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث باسم العنصر"
              aria-label="بحث في المكتبة"
              className="h-11 w-full rounded-[10px] border border-line bg-surface pr-9 pl-3 text-[13px] font-semibold outline-none focus:border-brand"
            />
          </label>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="تصفية المجلدات">
            <FilterChip active={folderId === "all"} onClick={() => setFolderId("all")}>
              الكل
            </FilterChip>
            <FilterChip active={folderId === "root"} onClick={() => setFolderId("root")}>
              بدون مجلد
            </FilterChip>
            {folders.map((folder) => (
              <FilterChip
                key={folder.id}
                active={folderId === folder.id}
                onClick={() => setFolderId(folder.id)}
              >
                {folder.name}
              </FilterChip>
            ))}
          </div>
        </div>

        {assetsLoading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[180px] animate-pulse rounded-xl border border-line bg-surface" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-line p-12 text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-line-2 text-muted">
              <ImageIcon className="size-6" aria-hidden />
            </div>
            <p className="mt-4 text-[14px] font-bold text-ink">
              {assets.length ? "لا عناصر مطابقة" : "المكتبة فارغة"}
            </p>
            <p className="mt-1 text-[13px] text-muted">
              تُضاف العناصر من المحرر (شعارات، صور، أيقونات) وتظهر هنا مباشرة.
            </p>
            <a
              href={PROJECTS_ROUTE}
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-[10px] bg-navy px-4 text-[12.5px] font-extrabold text-on-brand"
            >
              <FolderOpen className="size-4" aria-hidden />
              افتح مشروعًا لتعديل مكتبتك
            </a>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {filtered.map((asset) => (
              <article
                key={asset.id}
                className="group overflow-hidden rounded-xl border border-line bg-surface shadow-card"
              >
                <div className="grid h-[150px] place-items-center bg-surface-2 p-3">
                  <img
                    src={asset.src}
                    alt={asset.name}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <div className="p-3">
                  <p className="truncate text-[12.5px] font-extrabold text-ink" title={asset.name}>
                    {asset.name}
                  </p>
                  <p className="mt-0.5 text-[10.5px] font-bold text-muted">
                    {folderName(asset.folderId)} ·{" "}
                    <span dir="ltr" className="tabular-nums">
                      {Math.round(asset.w)} × {Math.round(asset.h)}
                    </span>
                  </p>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-muted">
                      <Database className="size-3" aria-hidden />
                      {new Date(asset.addedAt).toLocaleDateString("ar-SA")}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void removeAsset(asset.id);
                        toast.success("أُزيل العنصر من المكتبة");
                      }}
                      aria-label={`حذف ${asset.name}`}
                      title="حذف من المكتبة"
                      className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:border-danger/50 hover:text-error"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {customIcons.length > 0 && (
          <section className="mt-10">
            <h2 className="text-[16px] font-extrabold text-ink">الأيقونات والفواصل</h2>
            <p className="mt-1 text-[12px] text-muted">
              عناصر SVG مضافة، تُدرج مباشرة في صفحات المحرر.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {customIcons.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface p-2.5"
                >
                  <span
                    className="size-8 shrink-0 text-ink [&>svg]:size-8"
                    aria-hidden
                    dangerouslySetInnerHTML={{ __html: item.svg }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-ink">
                    {item.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeCustomIcon(item.id)}
                    aria-label={`حذف ${item.name}`}
                    className="grid size-7 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:border-danger/50 hover:text-error"
                  >
                    <Trash2 className="size-3" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <p className="text-[10px] font-bold text-muted">{label}</p>
      <p className="mt-1 text-[17px] font-extrabold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-[12px] font-bold transition",
        active
          ? "border-brand bg-navy text-on-brand"
          : "border-line bg-surface text-muted hover:border-brand hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
