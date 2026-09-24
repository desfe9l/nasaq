import { useMemo, useRef, useState } from "react";
import {
  FolderPlus,
  FolderTree,
  Image as ImageIcon,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useEditor } from "@/lib/editor/store";
import {
  planLibraryImportBlueprint,
  importKindFor,
  assetLabel,
  extensionOf,
  MAX_IMPORT_BYTES,
  type ImportEntry,
} from "@/lib/editor/library-import";
import { planLibraryImport, type LibraryImportPlan } from "@/lib/editor/library-export";
import type { AssetFolder } from "@/lib/editor/storage";
import { cn } from "@/lib/utils";

/**
 * «أضف مكتبة» — import a whole folder (or any loose file set) as NASAQ shelves.
 *
 * The panel's existing «استيراد مكتبة» only understood an exported
 * `nasaq-library.json`. Real asset folders are not organised that way: they are
 * a pile of PNGs, a nested `شعارات/` tree and the odd SVG, which is why the
 * shelf stayed empty for anyone who had not exported from another machine.
 *
 * This dialog is the translation layer:
 *   1. read the picked files (directory pick keeps `webkitRelativePath`);
 *   2. hand the paths to the pure planner, which derives the shelf tree;
 *   3. convert images to data URLs, split SVGs into reusable vectors, and merge
 *      any `nasaq-library.json` it finds;
 *   4. commit through the store's existing `importLibraryPlan`, so the import
 *      merges, de-duplicates and persists exactly like a library file.
 *
 * Nothing is uploaded: every byte is read with FileReader inside the browser.
 */

type PickedFile = { file: File; path: string };

const ACCEPT = "image/*,.svg,.json,application/json";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

/** Natural pixel size of an image (or SVG) data URL. */
function measure(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        w: Math.max(1, Math.round(img.naturalWidth || 100)),
        h: Math.max(1, Math.round(img.naturalHeight || 100)),
      });
    img.onerror = () => resolve({ w: 100, h: 100 });
    img.src = src;
  });
}

export function AddLibraryDialog({ onClose }: { onClose: () => void }) {
  const folders = useEditor((s) => s.assetFolders);
  const assets = useEditor((s) => s.assets);
  const importLibraryPlan = useEditor((s) => s.importLibraryPlan);

  const dirInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [shelfName, setShelfName] = useState("مكتبة مستوردة");
  const [mode, setMode] = useState<"folder" | "files">("folder");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  const entries: ImportEntry[] = useMemo(
    () =>
      picked.map(({ file, path }) => ({
        path,
        mime: file.type,
        size: file.size,
      })),
    [picked],
  );

  const blueprint = useMemo(
    () => planLibraryImportBlueprint(entries, shelfName),
    [entries, shelfName],
  );

  const collect = (list: FileList | null, fromDirectory: boolean) => {
    if (!list || list.length === 0) return;
    const next: PickedFile[] = [];
    for (let i = 0; i < list.length; i += 1) {
      const file = list.item(i);
      if (!file) continue;
      // Chromium exposes `webkitRelativePath` only for directory picks; a flat
      // multi-select leaves it empty, which is exactly the signal the planner
      // uses to decide between "keep the tree" and "one new shelf".
      const path = fromDirectory
        ? (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        : file.name;
      next.push({ file, path });
    }
    setPicked((current) => [...current, ...next]);
  };

  const commit = async () => {
    if (blueprint.entries.length === 0) return;
    setBusy(true);
    try {
      const folderIdByPath = new Map(blueprint.folders.map((f) => [f.path, f.id]));
      const parentIdByPath = new Map(
        blueprint.folders.map((f) => [f.path, f.parentPath ? folderIdByPath.get(f.parentPath) ?? null : null]),
      );

      const plannedFolders: AssetFolder[] = blueprint.folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        createdAt: Date.now(),
        parentId: parentIdByPath.get(folder.path) ?? null,
      }));

      const plannedAssets: LibraryImportPlan["assets"] = [];

      const fileByPath = new Map(picked.map((p) => [p.path, p.file]));
      let done = 0;

      for (const item of blueprint.entries) {
        const file = fileByPath.get(item.entry.path);
        if (!file) continue;
        done += 1;
        setProgress(`جارٍ المعالجة ${done} من ${blueprint.entries.length}`);
        const folderId = item.folderPath ? folderIdByPath.get(item.folderPath) ?? null : null;

        if (item.kind === "library") {
          // A `nasaq-library.json` inside the folder is merged, not imported as
          // an image: its own folders and assets join the same plan.
          try {
            const raw = JSON.parse(await readAsText(file));
            if (raw && raw.kind === "nasaq-library") {
              const nested = planLibraryImport(raw, { folders, assets });
              for (const f of nested.folders) {
                plannedFolders.push({
                  id: f.id,
                  name: f.name,
                  createdAt: f.createdAt,
                  parentId: f.parentId ?? null,
                });
              }
              for (const a of nested.assets) {
                plannedAssets.push({
                  id: a.id,
                  name: a.name,
                  src: a.src,
                  w: a.w,
                  h: a.h,
                  folderId: a.folderId ?? null,
                  addedAt: a.addedAt ?? Date.now(),
                });
              }
              continue;
            }
          } catch {
            /* not a library file — fall through and try it as nothing */
          }
          continue;
        }

        if (item.kind === "svg") {
          const text = await readAsText(file);
          const match = /<svg[\s\S]*<\/svg>/i.exec(text);
          if (!match) continue;
          const src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(match[0])))}`;
          const size = await measure(src);
          plannedAssets.push({
            name: assetLabel(item.entry.path),
            src,
            w: size.w,
            h: size.h,
            folderId,
            addedAt: Date.now(),
          });
          continue;
        }

        const src = await readAsDataUrl(file);
        const size = await measure(src);
        plannedAssets.push({
          name: assetLabel(item.entry.path),
          src,
          w: size.w,
          h: size.h,
          folderId,
          addedAt: Date.now(),
        });
      }

      if (plannedAssets.length === 0) {
        toast.error("لا توجد عناصر قابلة للاستيراد في المجلد المحدد.");
        return;
      }

      const plan: LibraryImportPlan = {
        folders: plannedFolders,
        assets: plannedAssets,
        skipped: 0,
      };
      const { added, failed } = await importLibraryPlan(plan);
      toast.success(
        added
          ? `أُضيفت مكتبة جديدة: ${added} عنصر في ${plannedFolders.length || 1} مجلد${
              failed ? ` — تعذّر ${failed}` : ""
            }`
          : "كل العناصر موجودة مسبقًا في المكتبة",
      );
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "تعذّر استيراد المجلد.",
      );
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const summary = {
    images: blueprint.entries.filter((e) => e.kind === "image").length,
    svg: blueprint.entries.filter((e) => e.kind === "svg").length,
    libraries: blueprint.entries.filter((e) => e.kind === "library").length,
    folders: blueprint.folders.length,
    unsupported: blueprint.unsupported.length,
    oversized: blueprint.oversized.length,
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="أضف مكتبة"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex max-h-[86vh] w-full max-w-xl flex-col overflow-hidden rounded-[14px] border border-line bg-white shadow-2xl dark:border-white/10 dark:bg-[#161c26]">
        <header className="flex items-center justify-between border-b border-line px-4 py-3 dark:border-white/10">
          <div className="flex items-center gap-2">
            <FolderPlus className="size-4 text-navy dark:text-gold-2" aria-hidden />
            <div>
              <h2 className="text-[13px] font-extrabold">أضف مكتبة</h2>
              <p className="text-[10px] text-muted">
                حوّل أي مجلد أو مجموعة ملفات إلى مجلدات بنمط نَسَق
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="إغلاق"
            className="grid size-8 place-items-center rounded-[8px] hover:bg-line-2 dark:hover:bg-white/5"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => dirInput.current?.click()}
              className={cn(
                "flex flex-col items-start gap-1 rounded-[10px] border p-3 text-start transition",
                mode === "folder"
                  ? "border-navy bg-navy/5"
                  : "border-line hover:border-navy/60 dark:border-white/10",
              )}
            >
              <FolderTree className="size-5 text-navy dark:text-gold-2" aria-hidden />
              <span className="text-[12px] font-extrabold">اختيار مجلد كامل</span>
              <span className="text-[10px] leading-4 text-muted">
                يُبنى شجرته كما هي: كل مجلد فرعي يصبح رفًّا داخل المكتبة
              </span>
            </button>
            <button
              type="button"
              onClick={() => filesInput.current?.click()}
              className={cn(
                "flex flex-col items-start gap-1 rounded-[10px] border p-3 text-start transition",
                mode === "files"
                  ? "border-navy bg-navy/5"
                  : "border-line hover:border-navy/60 dark:border-white/10",
              )}
            >
              <ImageIcon className="size-5 text-navy dark:text-gold-2" aria-hidden />
              <span className="text-[12px] font-extrabold">اختيار ملفات</span>
              <span className="text-[10px] leading-4 text-muted">
                أي صيغة مدعومة: PNG · JPG · WebP · SVG · ملف مكتبة JSON
              </span>
            </button>
          </div>

          <input
            ref={dirInput}
            type="file"
            className="hidden"
            multiple
            accept={ACCEPT}
            // Non-standard but universally supported in Chromium/WebKit and the
            // only way to select a folder in a browser; Firefox falls back to a
            // file picker, which still works through the flat path.
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(e) => {
              setMode("folder");
              collect(e.target.files, true);
              e.target.value = "";
            }}
          />
          <input
            ref={filesInput}
            type="file"
            className="hidden"
            multiple
            accept={ACCEPT}
            onChange={(e) => {
              setMode("files");
              collect(e.target.files, false);
              e.target.value = "";
            }}
          />

          {mode === "files" && (
            <label className="mt-3 block">
              <span className="mb-1 block text-[11px] font-extrabold">
                اسم الرف للمجموعة المختارة
              </span>
              <input
                value={shelfName}
                onChange={(e) => setShelfName(e.target.value)}
                className="h-9 w-full rounded-[8px] border border-line bg-transparent px-3 text-[12px] font-bold outline-none focus:border-navy dark:border-white/10"
                placeholder="مكتبة مستوردة"
              />
            </label>
          )}

          {picked.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[11px] font-extrabold">
                  الملفات المختارة ({picked.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setPicked([])}
                  disabled={busy}
                  className="text-[10px] font-bold text-muted hover:text-danger"
                >
                  تفريغ القائمة
                </button>
              </div>
              <p className="mb-2 rounded-[8px] bg-line-2 px-2.5 py-1.5 text-[10px] leading-5 text-muted dark:bg-white/5">
                {summary.folders > 0 && `${summary.folders} مجلد · `}
                {summary.images > 0 && `${summary.images} صورة · `}
                {summary.svg > 0 && `${summary.svg} متجه SVG · `}
                {summary.libraries > 0 && `${summary.libraries} ملف مكتبة`}
                {summary.unsupported > 0 && (
                  <span className="text-danger">
                    {" "}
                    · {summary.unsupported} ملف غير مدعوم
                  </span>
                )}
                {summary.oversized > 0 && (
                  <span className="text-danger">
                    {" "}
                    · {summary.oversized} ملف يتجاوز{" "}
                    {Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} ميغابايت
                  </span>
                )}
              </p>
              <ul className="editor-pane-scroll max-h-52 overflow-y-auto rounded-[8px] border border-line dark:border-white/10">
                {picked.slice(0, 200).map((item) => {
                  const kind = importKindFor({ path: item.path, mime: item.file.type });
                  const ok = kind !== "unsupported" && item.file.size <= MAX_IMPORT_BYTES;
                  return (
                    <li
                      key={`${item.path}-${item.file.size}`}
                      className="flex items-center gap-2 border-b border-line px-2.5 py-1.5 last:border-0 dark:border-white/10"
                    >
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          ok ? "bg-emerald-500" : "bg-red-500",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-[10px] font-bold" dir="ltr">
                        {item.path}
                      </span>
                      <span className="shrink-0 text-[9px] font-bold uppercase text-muted">
                        {extensionOf(item.path) || "—"}
                      </span>
                    </li>
                  );
                })}
                {picked.length > 200 && (
                  <li className="px-2.5 py-1.5 text-[10px] text-muted">
                    … و{picked.length - 200} ملفًا آخر
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 dark:border-white/10">
          <p className="min-w-0 flex-1 truncate text-[10px] text-muted">
            {busy ? progress : "تُحفظ العناصر في متصفحك عبر قاعدة المكتبة المحلية"}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-9 rounded-[8px] border border-line px-3 text-[12px] font-bold dark:border-white/10"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={() => void commit()}
              disabled={busy || blueprint.entries.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-navy px-3 text-[12px] font-extrabold text-white disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="size-4" aria-hidden />
              )}
              {busy ? "جارٍ الاستيراد" : "إضافة إلى المكتبة"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
