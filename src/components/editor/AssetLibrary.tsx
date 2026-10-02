import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  ArrowDownAZ,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  Eye,
  FilePlus,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Grid2X2,
  History,
  Image as ImageIcon,
  ImagePlus,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  PenTool,
  X,
} from "lucide-react";
import { useEditor } from "@/lib/editor/store";
import { useIncrementalList } from "@/lib/editor/use-incremental-list";
import type { Asset } from "@/lib/editor/storage";
import { writeLibraryDrag } from "@/lib/editor/library-dnd";
import { startPointerLibraryDrag } from "@/lib/editor/library-pointer-drag";
import {
  downloadLibraryFile,
  planLibraryImport,
} from "@/lib/editor/library-export";
import {
  planLibraryImportBlueprint,
  assetLabel,
  MAX_IMPORT_BYTES,
  folderSegments,
  resolveImportFolderIds,
  type ImportEntry,
} from "@/lib/editor/library-import";
import { extractSvgMarkup } from "@/lib/editor/ui-state";
import { cn } from "@/lib/utils";

type PendingAsset = Asset & { fileName: string };

type PickedFile = { file: File; path: string };
type TypeFilter = "all" | "image" | "svg";

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

async function getFilesFromDrop(
  dataTransfer: DataTransfer,
): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  // Try FileSystem API for folder drops
  const items = Array.from(dataTransfer.items || []);
  const hasEntry = items.some(
    (it) => typeof (it as any).webkitGetAsEntry === "function",
  );
  if (hasEntry) {
    const entries = items
      .map((it) => (it as any).webkitGetAsEntry?.())
      .filter(Boolean) as any[];
    const walk = async (entry: any, prefix: string) => {
      if (entry.isFile) {
        const file: File = await new Promise((res, rej) =>
          entry.file(res, rej),
        );
        const path = prefix ? `${prefix}/${file.name}` : entry.fullPath?.replace(/^\//, "") || file.name;
        out.push({ file, path });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const readAll = async (): Promise<any[]> => {
          const batch: any[] = await new Promise((res, rej) =>
            reader.readEntries(res, rej),
          );
          if (batch.length === 0) return [];
          const next = await readAll();
          return [...batch, ...next];
        };
        const children = await readAll();
        for (const child of children) {
          await walk(child, prefix ? `${prefix}/${entry.name}` : entry.name);
        }
      }
    };
    for (const e of entries) {
      await walk(e, "");
    }
    if (out.length) return out;
  }
  // Fallback: files list (may contain webkitRelativePath)
  const files = Array.from(dataTransfer.files || []);
  for (const file of files) {
    const rel = (file as any).webkitRelativePath as string | undefined;
    out.push({ file, path: rel || file.name });
  }
  return out;
}

export function AssetLibrary({
  children,
  createFolderRequest = 0,
}: {
  /**
   * Optional extra content rendered after the library grid. The Library tab
   * itself is files & folders only (the element tools live in their own tab),
   * but the slot stays so callers can still append same-workspace content.
   */
  children?: React.ReactNode;
  /** Monotonic request from the Add menu; handled when this tab mounts. */
  createFolderRequest?: number;
} = {}) {
  const assets = useEditor((s) => s.assets);
  const assetsLoading = useEditor((s) => s.assetsLoading);
  const addElement = useEditor((s) => s.addElement);
  const removeAsset = useEditor((s) => s.removeAsset);
  const removeAssets = useEditor((s) => s.removeAssets);
  const renameAsset = useEditor((s) => s.renameAsset);
  const addAsset = useEditor((s) => s.addAsset);
  const selectAssets = useEditor((s) => s.selectAssets);
  const folders = useEditor((s) => s.assetFolders);
  const folderId = useEditor((s) => s.assetFolderId);
  const selectedAssetIds = useEditor((s) => s.selectedAssetIds);
  const setAssetFolder = useEditor((s) => s.setAssetFolder);
  const toggleAssetSelect = useEditor((s) => s.toggleAssetSelect);
  const clearAssetSelection = useEditor((s) => s.clearAssetSelection);
  const createAssetFolder = useEditor((s) => s.createAssetFolder);
  const renameAssetFolder = useEditor((s) => s.renameAssetFolder);
  const deleteAssetFolder = useEditor((s) => s.deleteAssetFolder);
  const moveAssetsToFolder = useEditor((s) => s.moveAssetsToFolder);
  const importLibraryPlan = useEditor((s) => s.importLibraryPlan);
  const addCustomIcon = useEditor((s) => s.addCustomIcon);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const anyFileInputRef = useRef<HTMLInputElement>(null);
  const libraryImportRef = useRef<HTMLInputElement>(null);
  const categoriesRef = useRef<HTMLDivElement>(null);

  /*
   * A plain mouse wheel only scrolls vertically; over the folder row it moves
   * the row sideways instead (smoothly), so every category is reachable on a
   * desktop without a trackpad. Needs a non-passive listener to stop the panel
   * from scrolling at the same time; at either end the panel scrolls as usual.
   */
  useEffect(() => {
    const row = categoriesRef.current;
    if (!row) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const max = row.scrollWidth - row.clientWidth;
      if (max <= 1) return;
      // RTL rows scroll toward negative scrollLeft; "forward" is leftwards.
      const rtl = getComputedStyle(row).direction === "rtl";
      const progress = rtl ? -row.scrollLeft : row.scrollLeft;
      if ((event.deltaY < 0 && progress <= 0) || (event.deltaY > 0 && progress >= max - 1)) return;
      event.preventDefault();
      row.scrollBy({ left: rtl ? -event.deltaY : event.deltaY, behavior: "smooth" });
    };
    row.addEventListener("wheel", onWheel, { passive: false });
    return () => row.removeEventListener("wheel", onWheel);
  }, []);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [pending, setPending] = useState<PendingAsset[]>([]);
  const [preview, setPreview] = useState<Asset | PendingAsset | null>(null);
  const [savingPending, setSavingPending] = useState(false);
  const [folderDialog, setFolderDialog] = useState<"create" | "rename" | "delete" | null>(null);
  const [assetToDelete, setAssetToDelete] = useState<Asset | null>(null);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [folderDraft, setFolderDraft] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "compact">("grid");
  /*
   * The control bar collapses to ONE icon row: authors with big shelves kept
   * losing the assets themselves to the filters above them. The choice is
   * remembered, so a collapsed library stays collapsed.
   */
  const [barCollapsed, setBarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("nasaq.library.bar.v1") === "1";
    } catch {
      return false;
    }
  });
  const toggleBarCollapsed = () =>
    setBarCollapsed((value) => {
      try {
        window.localStorage.setItem("nasaq.library.bar.v1", value ? "0" : "1");
      } catch {
        /* the session keeps the choice in memory */
      }
      return !value;
    });
  const [menu, setMenu] = useState<{ asset: Asset; x: number; y: number } | null>(null);
  const [pickFolder, setPickFolder] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  /** Ordering of the shelf: newest first is the default an author expects. */
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "name">("recent");
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const lastFolderRequestRef = useRef(0);

  useEffect(() => {
    if (createFolderRequest <= lastFolderRequestRef.current) return;
    lastFolderRequestRef.current = createFolderRequest;
    setFolderDraft("");
    setFolderDialog("create");
  }, [createFolderRequest]);

  const rangeAnchorRef = useRef<string | null>(null);

  const openMenu = (e: React.MouseEvent, asset: Asset) => {
    if (editingId === asset.id) return;
    e.stopPropagation();
    setPickFolder(false);
    setMenu({ asset, x: e.clientX, y: e.clientY });
  };
  const closeMenu = () => {
    setMenu(null);
    setPickFolder(false);
  };

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const downloadAsset = (asset: Asset) => {
    const a = document.createElement("a");
    a.href = asset.src;
    a.download = asset.name || "asset";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Filtered + ordered assets
  const filteredAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = assets.filter((asset) => {
      // folder filter
      if (folderId !== null && (asset.folderId ?? null) !== folderId) return false;
      // type filter
      if (typeFilter !== "all") {
        const isSvg = asset.src.startsWith("data:image/svg") || asset.name.toLowerCase().endsWith(".svg");
        if (typeFilter === "image" && isSvg) return false;
        if (typeFilter === "svg" && !isSvg) return false;
      }
      // search
      if (q) {
        const name = asset.name.toLowerCase();
        if (!name.includes(q)) return false;
      }
      return true;
    });
    const ordered = matched.slice();
    if (sortBy === "name")
      ordered.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar"));
    else if (sortBy === "oldest")
      ordered.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
    else ordered.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    return ordered;
  }, [assets, folderId, query, typeFilter, sortBy]);

  /** True when anything is narrowing the shelf (drives the count + reset chip). */
  const isFiltered = Boolean(query.trim()) || typeFilter !== "all" || folderId !== null;

  /*
   * Incremental rendering: a shelf of hundreds of assets used to mount every
   * card (and decode every image) the moment the library opened. The grid now
   * renders a growing window and pulls more rows in as the sentinel approaches
   * the viewport, so opening the library never blocks the canvas.
   */
  const {
    slice: visibleAssets,
    sentinelRef: assetSentinelRef,
    remaining: assetsRemaining,
  } = useIncrementalList(filteredAssets, 48);

  const currentFolder = folders.find((folder) => folder.id === folderId);
  const fullFolderName = (folder: (typeof folders)[number]) => {
    const names = [folder.name];
    const seen = new Set([folder.id]);
    let parentId = folder.parentId ?? null;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = folders.find((candidate) => candidate.id === parentId);
      if (!parent) break;
      names.push(parent.name);
      parentId = parent.parentId ?? null;
    }
    return names.reverse().join(" / ");
  };

  const placedBox = (asset: Asset) => {
    const max = { w: 90, h: 90 };
    const scale = Math.min(max.w / asset.w, max.h / asset.h, 1);
    return {
      w: Math.max(12, Math.round(asset.w * scale)),
      h: Math.max(12, Math.round(asset.h * scale)),
    };
  };

  const place = (asset: Asset) => {
    // SVG remains vector editable
    const isSvg = asset.src.startsWith("data:image/svg") || asset.src.includes("<svg");
    if (isSvg) {
      try {
        let markup = "";
        if (asset.src.startsWith("data:image/svg+xml;base64,")) {
          const b64 = asset.src.split(",")[1];
          markup = decodeURIComponent(escape(atob(b64)));
        } else if (asset.src.startsWith("data:image/svg+xml")) {
          // utf8 encoded
          const part = asset.src.split(",")[1] || "";
          markup = decodeURIComponent(part);
        } else if (asset.src.includes("<svg")) {
          markup = asset.src;
        }
        const clean = extractSvgMarkup(markup);
        if (clean) {
          const { w, h } = placedBox(asset);
          // Insert as vector svg element
          (addElement as any)("svg", {
            content: clean,
            name: asset.name,
            w: w * 1.2,
            h: h * 1.2,
          });
          toast.success(`تمت إضافة «${asset.name}» كعنصر Vector قابل للتحرير`);
          return;
        }
      } catch {
        // fall through to image
      }
    }
    const { w, h } = placedBox(asset);
    addElement("image", { src: asset.src, name: asset.name, w, h });
  };

  const dragPayloadFor = (asset: Asset) => {
    const isSvg = asset.src.startsWith("data:image/svg");
    if (isSvg) {
      try {
        const b64 = asset.src.split(",")[1];
        const markup = b64 ? decodeURIComponent(escape(atob(b64))) : "";
        const clean = extractSvgMarkup(markup);
        if (clean) {
          return {
            items: [
              {
                type: "svg" as const,
                over: { content: clean, name: asset.name, ...placedBox(asset) },
              },
            ],
          };
        }
      } catch {
        /* malformed SVG data URL — fall back to the image payload */
      }
    }
    return {
      items: [
        {
          type: "image" as const,
          over: { src: asset.src, name: asset.name, ...placedBox(asset) },
        },
      ],
    };
  };

  const startRename = (asset: Asset) => {
    setEditingId(asset.id);
    setDraftName(asset.name);
  };

  const onCardActivate = (asset: Asset, event: React.MouseEvent) => {
    if (editingId === asset.id) return;
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      event.preventDefault();
      const ids = visibleAssets.map((item) => item.id);
      const anchorId = rangeAnchorRef.current ?? selectedAssetIds[0] ?? ids[0];
      const from = ids.indexOf(anchorId);
      const to = ids.indexOf(asset.id);
      if (from < 0 || to < 0) {
        toggleAssetSelect(asset.id);
        return;
      }
      const [start, end] = from <= to ? [from, to] : [to, from];
      const range = ids.slice(start, end + 1);
      const merged = event.metaKey || event.ctrlKey ? [...new Set([...selectedAssetIds, ...range])] : range;
      selectAssets(merged);
      if (!rangeAnchorRef.current) rangeAnchorRef.current = anchorId;
      return;
    }
    rangeAnchorRef.current = asset.id;
    place(asset);
  };

  const selectAllVisible = () => {
    selectAssets(visibleAssets.map((item) => item.id));
  };

  const commitRename = () => {
    if (editingId) void renameAsset(editingId, draftName);
    setEditingId(null);
  };

  // ---- File handling helpers ----
  const processPickedFiles = useCallback(
    async (picked: PickedFile[], targetFolderId: string | null = folderId) => {
      if (!picked.length) return;
      setImporting(true);
      try {
        // Build blueprint for folder structure preservation
        const entries: ImportEntry[] = picked.map(({ file, path }) => ({
          path,
          mime: file.type,
          size: file.size,
        }));
        const rootName = currentFolder?.name || "مكتبة مستوردة";
        const blueprint = planLibraryImportBlueprint(entries, rootName);

        const flatPick = picked.every(({ path }) => folderSegments(path).length === 0);
        const folderIdByPath = await resolveImportFolderIds(
          blueprint.folders,
          {
            getFolders: () => useEditor.getState().assetFolders,
            createFolder: createAssetFolder,
          },
          { flatPick, targetFolderId },
        );

        // For deduplication: track existing names per folder
        const existingAssets = useEditor.getState().assets;
        const existingKey = new Set(
          existingAssets.map((a) => `${(a.folderId ?? "root").toLowerCase()}::${a.name.toLowerCase()}`),
        );

        let added = 0;
        let skipped = 0;

        for (const item of blueprint.entries) {
          const pickedFile = picked.find((p) => p.path === item.entry.path);
          if (!pickedFile) continue;
          const file = pickedFile.file;
          if (file.size > MAX_IMPORT_BYTES) {
            toast.error(`الملف كبير جداً: ${file.name}`);
            continue;
          }
          const folderIdForAsset = item.folderPath
            ? folderIdByPath.get(item.folderPath) ?? targetFolderId
            : targetFolderId;

          const label = assetLabel(item.entry.path);
          const dupKey = `${(folderIdForAsset ?? "root").toLowerCase()}::${label.toLowerCase()}`;
          if (existingKey.has(dupKey)) {
            skipped++;
            continue;
          }

          if (item.kind === "svg") {
            const text = await readAsText(file);
            const markup = extractSvgMarkup(text);
            if (!markup) {
              toast.error(`SVG غير صالح: ${file.name}`);
              continue;
            }
            // Save as vector icon for true vector editing + asset for grid
            try {
              await addCustomIcon({
                name: label.slice(0, 40),
                svg: markup,
                kind: "icon",
              });
            } catch {
              /* icon store unavailable — the asset below still lands in the grid */
            }
            const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(markup)))}`;
            const size = await measure(dataUrl);
            const saved = await addAsset({
              name: label.slice(0, 40),
              src: dataUrl,
              w: size.w,
              h: size.h,
              folderId: folderIdForAsset,
            });
            if (saved) {
              added++;
              existingKey.add(dupKey);
            }
          } else if (item.kind === "image") {
            const src = await readAsDataUrl(file);
            if (!src) continue;
            const size = await measure(src);
            const saved = await addAsset({
              name: label.slice(0, 40),
              src,
              w: size.w,
              h: size.h,
              folderId: folderIdForAsset,
            });
            if (saved) {
              added++;
              existingKey.add(dupKey);
            }
          } else if (item.kind === "library") {
            try {
              const raw = JSON.parse(await readAsText(file));
              const plan = planLibraryImport(raw, {
                folders: useEditor.getState().assetFolders,
                assets: useEditor.getState().assets,
              });
              const res = await importLibraryPlan(plan);
              added += res.added;
            } catch {
              /* not a valid library file — counted as skipped by the summary below */
            }
          }
        }

        if (added > 0) {
          // Reveal imported assets even when the author started inside a folder.
          setAssetFolder(null);
          toast.success(`تمت إضافة ${added} عنصر${skipped ? ` — تخطي ${skipped} مكرر` : ""} — ظهرت فوراً في المكتبة`);
        } else if (skipped > 0) {
          toast.message("كل الملفات موجودة مسبقاً — تم منع التكرار");
        }
      } finally {
        setImporting(false);
      }
    },
    [folderId, currentFolder, createAssetFolder, addAsset, addCustomIcon, importLibraryPlan, setAssetFolder],
  );

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>, fromFolder: boolean) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const picked: PickedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files.item(i);
      if (!file) continue;
      const path = fromFolder
        ? (file as any).webkitRelativePath || file.name
        : file.name;
      picked.push({ file, path });
    }
    e.target.value = "";
    await processPickedFiles(picked);
  };

  const handleAnyFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const picked: PickedFile[] = Array.from(files).map((file) => ({
      file,
      path: (file as any).webkitRelativePath || file.name,
    }));
    e.target.value = "";
    await processPickedFiles(picked);
  };

  const savePending = async () => {
    if (savingPending || pending.length === 0) return;
    setSavingPending(true);
    try {
      for (const item of pending) {
        await addAsset({
          name: item.name,
          src: item.src,
          w: item.w,
          h: item.h,
        });
      }
      setPending([]);
    } finally {
      setSavingPending(false);
    }
  };

  const exportLibrary = () => {
    const name = downloadLibraryFile({ folders, assets });
    toast.success(`تم تنزيل المكتبة — ${name}`);
  };

  const importLibrary = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      const plan = planLibraryImport(raw, { folders, assets });
      const { added, failed } = await importLibraryPlan(plan);
      if (failed && !added) {
        toast.error("تعذّر حفظ العناصر — قد تكون مساحة التخزين ممتلئة.");
      } else {
        toast.success(
          added
            ? `أُضيف ${added} عنصر${plan.skipped ? ` — تخطّي ${plan.skipped} مكرر` : ""}${failed ? ` — تعذّر ${failed}` : ""}`
            : plan.skipped
              ? "كل العناصر موجودة مسبقًا — لا شيء جديد"
              : "الملف فارغ — لا عناصر لاستيرادها",
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر قراءة ملف المكتبة.");
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const picked = await getFilesFromDrop(e.dataTransfer);
    if (picked.length === 0) return;
    await processPickedFiles(picked);
  };

  return (
    <section
      className={cn(
 "asset-library grid gap-2 rounded-[10px] border border-transparent p-1 transition",
        dragOver && "border-navy bg-navy/5 border-dashed",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="asset-library-controls grid gap-2">
      <header className="asset-library-header flex items-center justify-between gap-2">
        <h3 className="min-w-0 text-[12px] font-extrabold tracking-wide">المكتبة</h3>
        <div className="asset-library-tools flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={exportLibrary}
            aria-label="تصدير المكتبة"
            title="تصدير المكتبة"
            className="asset-lib-icon-btn grid size-7 place-items-center rounded-[6px] border border-line"
          >
            <Download className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => libraryImportRef.current?.click()}
            aria-label="استيراد مكتبة"
            title="استيراد مكتبة من ملف"
            className="asset-lib-icon-btn grid size-7 place-items-center rounded-[6px] border border-line"
          >
            <Upload className="size-3.5" />
          </button>
          <input
            ref={libraryImportRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importLibrary(file);
            }}
          />
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            aria-label="عرض شبكي"
            title="عرض شبكي"
            aria-pressed={viewMode === "grid"}
            className={cn(
 "asset-lib-icon-btn grid size-7 place-items-center rounded-[6px] border",
              viewMode === "grid" ? "border-navy bg-navy/10" : "border-line",
            )}
          >
            <Grid2X2 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("compact")}
            aria-label="عرض مضغوط"
            title="عرض مضغوط"
            aria-pressed={viewMode === "compact"}
            className={cn(
 "asset-lib-icon-btn grid size-7 place-items-center rounded-[6px] border",
              viewMode === "compact" ? "border-navy bg-navy/10" : "border-line",
            )}
          >
            <List className="size-3.5" />
          </button>
        </div>
      </header>

      {/*
       * Search + filters + add, as ONE icon row that collapses away.
       *
       * The old bar stacked a search field, two chip rows and three labelled
       * buttons above the shelf — on a narrow window the controls ate the
       * assets themselves. Everything except folder NAMES is now an icon with
       * a tooltip, and the whole bar folds to a single row (remembered).
       */}
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={toggleBarCollapsed}
            aria-pressed={barCollapsed}
            aria-label={barCollapsed ? "إظهار بحث المكتبة" : "طي أدوات المكتبة"}
            title={
              barCollapsed
                ? "إظهار البحث في المكتبة"
                : "طي البحث — صف أيقونات واحد يكفي"
            }
            className={cn(
              "asset-lib-icon-btn grid size-8 shrink-0 place-items-center rounded-[6px] border",
              barCollapsed ? "border-navy bg-navy/10" : "border-line",
            )}
          >
            {barCollapsed ? (
              <ChevronsUpDown className="size-3.5" />
            ) : (
              <ChevronsDownUp className="size-3.5" />
            )}
          </button>
          {(
            [
              ["all", "كل العناصر", LayoutGrid],
              ["image", "صور", ImageIcon],
              ["svg", "SVG متجه", PenTool],
            ] as [TypeFilter, string, typeof LayoutGrid][]
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTypeFilter(id)}
              aria-pressed={typeFilter === id}
              aria-label={`تصفية: ${label}`}
              title={`تصفية: ${label}`}
              className={cn(
                "asset-lib-icon-btn grid size-8 shrink-0 place-items-center rounded-[6px] border",
                typeFilter === id
                  ? "border-navy bg-navy/10 text-brand"
                  : "border-line",
              )}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          {(
            [
              ["recent", "ترتيب: الأحدث", History],
              ["oldest", "ترتيب: الأقدم", CalendarClock],
              ["name", "ترتيب: الاسم", ArrowDownAZ],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSortBy(id)}
              aria-pressed={sortBy === id}
              aria-label={label}
              title={label}
              className={cn(
                "asset-lib-icon-btn grid size-8 shrink-0 place-items-center rounded-[6px] border",
                sortBy === id ? "border-navy bg-navy/10 text-brand" : "border-line",
              )}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
          {isFiltered && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setTypeFilter("all");
                setAssetFolder(null);
              }}
              aria-label="مسح كل عوامل التصفية"
              title="مسح كل عوامل التصفية"
              className="asset-lib-icon-btn grid size-8 shrink-0 place-items-center rounded-[6px] border border-line text-error"
            >
              <X className="size-3.5" />
            </button>
          )}
          <span className="ms-auto rounded-full bg-line-2 px-2 py-1 text-[10px] font-bold tabular-nums text-muted">
            {visibleAssets.length} / {assets.length}
          </span>
        </div>

        {!barCollapsed && (
          <label className="relative">
            <Search className="pointer-events-none absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث في المكتبة…"
              aria-label="بحث في المكتبة"
              className="asset-library-search h-9 w-full rounded-[8px] border border-line bg-surface pe-8 ps-3 text-[12px] font-bold outline-none focus:border-navy"
            />
          </label>
        )}

        {/* Add actions — icon buttons; the labels live in their tooltips. */}
        <div className="asset-library-add-actions flex items-center gap-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            aria-label="إضافة صورة"
            title="إضافة صورة"
            className="asset-lib-icon-btn grid size-8 shrink-0 place-items-center rounded-[6px] border border-line disabled:opacity-50"
          >
            <ImagePlus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => anyFileInputRef.current?.click()}
            disabled={importing}
            aria-label="إضافة ملف"
            title="إضافة ملف"
            className="asset-lib-icon-btn grid size-8 shrink-0 place-items-center rounded-[6px] border border-line disabled:opacity-50"
          >
            <FilePlus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            disabled={importing}
            aria-label="إضافة مجلد"
            title="إضافة مجلد"
            className="asset-lib-icon-btn grid size-8 shrink-0 place-items-center rounded-[6px] border border-line disabled:opacity-50"
          >
            <FolderInput className="size-3.5" />
          </button>
        </div>
      </div>

      {/*
       * Folder categories (الكل، غير مصنف، شعارات الداخلية…). One row that
       * scrolls horizontally — touch swipe, trackpad, or the mouse wheel — so
       * any number of folders fits without growing the sticky header.
       */}
      <div className="asset-library-categories-wrap">
        <div ref={categoriesRef} className="asset-library-categories" role="group" aria-label="مجلدات المكتبة">
        <button
          type="button"
          onClick={() => setAssetFolder(null)}
          aria-pressed={!folderId}
          className={cn(
 "asset-library-chip inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] border px-2 text-[10px] font-bold",
            !folderId ? "border-navy bg-navy/10" : "border-line",
          )}
        >
          <Folder className="size-3" /> الكل
        </button>
        {folders.map((folder) => (
          <button
            key={folder.id}
            type="button"
            onClick={() => setAssetFolder(folder.id)}
            aria-label={`مجلد ${fullFolderName(folder)}`}
            aria-pressed={folderId === folder.id}
            title={fullFolderName(folder)}
            className={cn(
 "asset-library-chip asset-library-folder-chip inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] border px-2 text-[10px] font-bold",
              folderId === folder.id ? "border-navy bg-navy/10" : "border-line",
            )}
          >
            <Folder className="size-3 shrink-0" />
            <span className="asset-library-folder-label">{fullFolderName(folder)}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setFolderDraft("");
            setFolderDialog("create");
          }}
          className="asset-lib-icon-btn grid size-7 shrink-0 place-items-center rounded-[6px] border border-line"
          title="مجلد جديد"
          aria-label="مجلد جديد"
        >
          <FolderPlus className="size-3.5" />
        </button>
        {currentFolder && (
          <>
            <button
              type="button"
              onClick={() => {
                setFolderDraft(currentFolder.name);
                setFolderDialog("rename");
              }}
              className="asset-lib-icon-btn grid size-7 shrink-0 place-items-center rounded-[6px] border border-line"
              title="إعادة تسمية المجلد"
              aria-label="إعادة تسمية المجلد"
            >
              <Pencil className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => setFolderDialog("delete")}
              className="asset-lib-icon-btn grid size-7 shrink-0 place-items-center rounded-[6px] border border-line text-error"
              title="حذف المجلد"
              aria-label="حذف المجلد"
            >
              <Trash2 className="size-3" />
            </button>
          </>
        )}
        </div>
      </div>

      </div>

      <input ref={fileInputRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => void handleFileInput(e, false)} />
      <input ref={anyFileInputRef} type="file" multiple accept="image/*,.svg,application/json,.json" className="hidden" onChange={handleAnyFileInput} />
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        multiple
        accept="image/*,.svg,.json"
        {...({ webkitdirectory: "", directory: "" } as any)}
        onChange={(e) => void handleFileInput(e, true)}
      />

      {dragOver && (
        <div className="rounded-[8px] border-2 border-dashed border-navy bg-navy/5 p-3 text-center text-[11px] font-bold text-brand">
          أفلت الملفات هنا — يُستخرج الاسم والتصنيف تلقائياً ويُحفظ بنية المجلدات
        </div>
      )}

      {importing && (
        <p className="text-[10px] font-bold text-muted">جارٍ الاستيراد… تُحفظ الملفات فوراً وتظهر في المكتبة</p>
      )}

      {selectedAssetIds.length > 0 && (
        <div className="flex items-center gap-2 rounded-[7px] border border-brand/50 bg-ok/10 p-1.5 text-[10px]">
          <span className="inline-flex items-center gap-1 rounded-full bg-ok px-2 py-0.5 font-extrabold text-white tabular-nums">
            {selectedAssetIds.length} محدد
          </span>
          <select
            aria-label="نقل العناصر إلى مجلد"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value !== "") void moveAssetsToFolder(selectedAssetIds, e.target.value === "root" ? null : e.target.value);
            }}
            className="h-7 min-w-0 flex-1 rounded border border-brand/70 bg-transparent px-1 text-[10px]"
          >
            <option value="">نقل إلى…</option>
            <option value="root">المكتبة الرئيسية</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {fullFolderName(folder)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setBatchDeleting(true)}
            className="inline-flex h-7 items-center gap-1 rounded-[6px] bg-danger px-2 font-extrabold text-white"
          >
            <Trash2 className="size-3" /> حذف
          </button>
          <button type="button" onClick={clearAssetSelection} className="px-1 font-bold text-muted">
            إلغاء
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <div className="rounded-[8px] border border-gold/60 bg-gold/2 p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-extrabold">معاينة قبل الحفظ</p>
              <p className="text-[9px] text-muted">{pending.length} ملف جاهز للمراجعة</p>
            </div>
            <button type="button" onClick={() => setPending([])} className="grid size-6 place-items-center rounded-[6px] text-muted">
              <X className="size-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {pending.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPreview(item)}
                className="overflow-hidden rounded-[6px] border border-line bg-surface p-1 text-start"
              >
                <div className="grid h-14 place-items-center bg-line-2/50">
                  <img src={item.src} alt={item.name} className="max-h-12 max-w-full object-contain" />
                </div>
                <span className="mt-1 block truncate text-[9px]">{item.name}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void savePending()}
            disabled={savingPending}
            className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[6px] bg-navy text-[10px] font-extrabold text-white disabled:opacity-50"
          >
            <Check className="size-3.5" /> {savingPending ? "جارٍ الحفظ…" : "حفظ الملفات في المكتبة"}
          </button>
        </div>
      )}

      {assetsLoading ? (
        <p className="text-[10px] text-muted">جارٍ تحميل المكتبة…</p>
      ) : visibleAssets.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-line p-3 text-center">
          <p className="text-[10px] leading-5 text-muted">
            {query || typeFilter !== "all" || folderId
              ? "لا نتائج مطابقة — جرّب بحثاً آخر أو تصفية مختلفة"
              : "احفظ أي صورة أو شعار أو شكل ترفعه ليظهر هنا وتستخدمه في أي مشروع لاحقاً. اسحب ملفات أو مجلد كامل وستُحفظ فوراً."}
          </p>
        </div>
      ) : (
        <div className={cn("asset-media-grid", viewMode === "compact" && "is-compact")}>
          {visibleAssets.map((asset) => (
            <div
              key={asset.id}
              draggable={editingId !== asset.id}
              onDragStart={(event) => {
                writeLibraryDrag(event.dataTransfer, dragPayloadFor(asset));
              }}
              onPointerDown={(event) => {
                if (editingId === asset.id) return;
                if (event.pointerType === "touch" || event.pointerType === "pen") {
                  startPointerLibraryDrag(event, dragPayloadFor(asset), asset.name);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu(event, asset);
              }}
              onClick={(event) => {
                if (editingId === asset.id) return;
                onCardActivate(asset, event);
              }}
              className={cn(
 "asset-card group relative rounded-[8px] border bg-surface-2 p-1.5 transition",
                editingId !== asset.id && "cursor-pointer",
                selectedAssetIds.includes(asset.id)
                  ? "is-selected border-brand bg-ok/10 ring-2 ring-brand/40"
                  : "border-line hover:border-brand",
              )}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  rangeAnchorRef.current = asset.id;
                  toggleAssetSelect(asset.id);
                }}
                aria-label={`تحديد ${asset.name}`}
                aria-pressed={selectedAssetIds.includes(asset.id)}
                className={cn(
 "asset-card-check absolute right-1 top-1 z-[2] grid size-5 place-items-center rounded-full border bg-surface-2",
                  selectedAssetIds.includes(asset.id) ? "border-brand bg-ok text-white" : "border-line",
                )}
              >
                {selectedAssetIds.includes(asset.id) && <Check className="size-3" />}
              </button>
              {editingId === asset.id ? (
                <div className="asset-card-edit flex h-20 flex-col gap-1 rounded-[6px] border border-navy-2 p-1">
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="h-5 w-full rounded-[4px] border border-line px-1 text-[9px] bg-surface-2"
                  />
                  <div className="flex gap-1">
                    <button type="button" onClick={commitRename} className="grid h-5 flex-1 place-items-center rounded-[4px] bg-navy text-white">
                      <Check className="size-3" />
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="grid h-5 flex-1 place-items-center rounded-[4px] border border-line">
                      <X className="size-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    title={`إدراج "${asset.name}" في مساحة العمل — اسحبه على اللوحة لوضع مخصص`}
                    className={cn(
 "library-hit grid w-full place-items-center overflow-hidden rounded-[6px]",
                      viewMode === "grid" ? "h-20" : "h-14",
 "border border-line bg-surface transition",
                    )}
                  >
                    <img src={asset.src} alt={asset.name} className={cn("max-w-full object-contain", viewMode === "grid" ? "max-h-[4.5rem]" : "max-h-[3.25rem]")} />
                  </button>
                  <span className="asset-card-name mt-1 block truncate text-center text-[9px] font-bold text-muted" title={asset.name}>
                    {asset.name}
                  </span>
                  <div className="asset-card-actions mt-1 flex items-center justify-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => openMenu(e, asset)}
                      aria-label={`خيارات ${asset.name}`}
                      title="خيارات العنصر"
                      className="grid size-7 place-items-center rounded-[5px] border border-line text-muted"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        place(asset);
                      }}
                      title="إدراج في الصفحة"
                      aria-label={`إدراج ${asset.name} في الصفحة`}
                      className="grid size-7 place-items-center rounded-[5px] bg-navy text-white"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {assetsRemaining > 0 && (
            <div
              ref={assetSentinelRef}
              className="col-span-full grid h-10 place-items-center text-[10px] font-bold text-muted"
            >
              جارٍ تحميل {assetsRemaining} عنصر إضافي…
            </div>
          )}
        </div>
      )}

      {children}

      {menu &&
        createPortal(
          <div className="fixed inset-0 z-[var(--z-dialog)]" onPointerDown={closeMenu} tabIndex={-1}>
            <div
              role="menu"
              aria-label={`خيارات ${menu.asset.name}`}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute min-w-[200px] rounded-[10px] border border-line bg-surface p-1.5 shadow-xl"
              style={{
                left: Math.max(8, Math.min(menu.x, window.innerWidth - 216)),
                top: Math.max(8, Math.min(menu.y, window.innerHeight - 330)),
              }}
            >
              {pickFolder ? (
                <>
                  <MenuRow icon={ArrowRight} label="رجوع" onClick={() => setPickFolder(false)} />
                  <div className="my-1 border-t border-line" />
                  <MenuRow
                    icon={FolderOpen}
                    label="المكتبة الرئيسية"
                    disabled={!selectedAssetIds.includes(menu.asset.id) && !menu.asset.folderId}
                    onClick={() => {
                      const targets = selectedAssetIds.includes(menu.asset.id) ? selectedAssetIds : [menu.asset.id];
                      void moveAssetsToFolder(targets, null);
                      toast.success(`نُقلت إلى الرئيسية`);
                      closeMenu();
                    }}
                  />
                  {folders.map((folder) => (
                    <MenuRow
                      key={folder.id}
                      icon={Folder}
                      label={fullFolderName(folder)}
                      disabled={!selectedAssetIds.includes(menu.asset.id) && menu.asset.folderId === folder.id}
                      onClick={() => {
                        const targets = selectedAssetIds.includes(menu.asset.id) ? selectedAssetIds : [menu.asset.id];
                        void moveAssetsToFolder(targets, folder.id);
                        toast.success(`أُضيف إلى «${folder.name}»`);
                        closeMenu();
                      }}
                    />
                  ))}
                </>
              ) : (
                <>
                  <MenuRow icon={Plus} label="إدراج على الصفحة" onClick={() => { place(menu.asset); closeMenu(); }} />
                  <MenuRow
                    icon={Check}
                    label={selectedAssetIds.includes(menu.asset.id) ? "❌ إلغاء التحديد" : "🎯 تحديد"}
                    onClick={() => {
                      rangeAnchorRef.current = menu.asset.id;
                      toggleAssetSelect(menu.asset.id);
                      closeMenu();
                    }}
                  />
                  <MenuRow icon={Grid2X2} label="🔳 تحديد الكل" onClick={() => { selectAllVisible(); closeMenu(); }} />
                  <MenuRow icon={FolderOpen} label="📁 نقل إلى مجلد…" onClick={() => setPickFolder(true)} />
                  <MenuRow icon={Eye} label="معاينة" onClick={() => { setPreview(menu.asset); closeMenu(); }} />
                  <MenuRow icon={Pencil} label="إعادة تسمية" onClick={() => { startRename(menu.asset); closeMenu(); }} />
                  <MenuRow icon={Download} label="تنزيل الصورة" onClick={() => { downloadAsset(menu.asset); closeMenu(); }} />
                  <div className="my-1 border-t border-line" />
                  <MenuRow icon={Trash2} label="🗑️ حذف…" danger onClick={() => { setAssetToDelete(menu.asset); closeMenu(); }} />
                </>
              )}
            </div>
          </div>,
          document.body,
        )}

      {preview &&
        createPortal(
          <div className="fixed inset-0 z-[var(--z-dialog)] grid place-items-center bg-navy/55 p-4" role="dialog" aria-modal="true" onClick={() => setPreview(null)}>
            <div className="w-full max-w-sm rounded-[10px] bg-surface p-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-[12px] font-extrabold">معاينة العنصر</p>
                  <p className="max-w-[15rem] truncate text-[10px] text-muted">{preview.name}</p>
                </div>
                <button type="button" onClick={() => setPreview(null)} className="grid size-7 place-items-center rounded-[6px] border border-line">
                  <X className="size-4" />
                </button>
              </div>
              <div className="grid min-h-48 place-items-center rounded-[8px] border border-line bg-line-2/50 p-4">
                <img src={preview.src} alt={preview.name} className="max-h-64 max-w-full object-contain" />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-muted">
                <span>
                  {preview.w} × {preview.h} px
                </span>
                <button
                  type="button"
                  onClick={() => {
                    place(preview);
                    setPreview(null);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-navy px-3 font-extrabold text-white"
                >
                  <Plus className="size-3.5" /> إدراج وتحديد
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {folderDialog &&
        createPortal(
          <div className="fixed inset-0 z-[var(--z-dialog)] grid place-items-center bg-navy/45 p-4" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === "Escape") setFolderDialog(null); }}>
            {folderDialog === "delete" ? (
              <div className="grid w-full max-w-xs gap-3 rounded-[10px] bg-surface p-4 shadow-xl">
                <strong className="text-[13px]">حذف المجلد نهائيًا؟</strong>
                <p className="text-[11px] leading-6 text-muted">سيتم حذف هذا المجلد ومحتوياته نهائيًا، ولا يمكن التراجع.</p>
                <div className="flex justify-end gap-2">
                  <button type="button" autoFocus onClick={() => setFolderDialog(null)} className="h-8 rounded-[6px] border border-line px-3 text-[11px]">
                    إلغاء
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (currentFolder) void deleteAssetFolder(currentFolder.id);
                      setFolderDialog(null);
                    }}
                    className="h-8 rounded-[6px] bg-danger px-3 text-[11px] font-bold text-white"
                  >
                    حذف نهائيًا
                  </button>
                </div>
              </div>
            ) : (
              <form
                className="grid w-full max-w-xs gap-3 rounded-[10px] bg-surface p-4 shadow-xl"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (folderDialog === "create") void createAssetFolder(folderDraft);
                  else if (currentFolder) void renameAssetFolder(currentFolder.id, folderDraft);
                  setFolderDialog(null);
                }}
              >
                <strong className="text-[12px]">{folderDialog === "create" ? "مجلد جديد" : "إعادة تسمية المجلد"}</strong>
                <input autoFocus value={folderDraft} onChange={(e) => setFolderDraft(e.target.value)} aria-label="اسم المجلد" className="h-9 rounded-[7px] border border-line px-2 text-[12px] bg-surface-2" />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setFolderDialog(null)} className="h-8 rounded-[6px] border border-line px-3 text-[11px]">
                    إلغاء
                  </button>
                  <button type="submit" className="h-8 rounded-[6px] bg-navy px-3 text-[11px] font-bold text-white">
                    حفظ
                  </button>
                </div>
              </form>
            )}
          </div>,
          document.body,
        )}

      {batchDeleting &&
        createPortal(
          <div className="fixed inset-0 z-[var(--z-dialog)] grid place-items-center bg-navy/45 p-4" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === "Escape") setBatchDeleting(false); }}>
            <div className="grid w-full max-w-xs gap-3 rounded-[10px] bg-surface p-4 shadow-xl">
              <strong className="text-[13px]">حذف {selectedAssetIds.length} عنصرًا؟</strong>
              <p className="text-[11px] leading-6 text-muted">ستُحذف العناصر المحددة نهائيًا من المكتبة. المجلدات تبقى كما هي.</p>
              <div className="flex justify-end gap-2">
                <button type="button" autoFocus onClick={() => setBatchDeleting(false)} className="h-8 rounded-[6px] border border-line px-3 text-[11px]">
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const ids = [...selectedAssetIds];
                    setBatchDeleting(false);
                    void removeAssets(ids).then(() => {
                      toast.success(`تم حذف ${ids.length} عنصرًا`);
                    });
                  }}
                  className="h-8 rounded-[6px] bg-danger px-3 text-[11px] font-bold text-white"
                >
                  حذف نهائيًا
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {assetToDelete &&
        createPortal(
          <div className="fixed inset-0 z-[var(--z-dialog)] grid place-items-center bg-navy/45 p-4" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === "Escape") setAssetToDelete(null); }}>
            <div className="grid w-full max-w-xs gap-3 rounded-[10px] bg-surface p-4 shadow-xl">
              <strong className="text-[13px]">هل أنت متأكد من الحذف؟</strong>
              <p className="text-[11px] leading-6 text-muted">سيتم حذف «{assetToDelete.name}» من المكتبة نهائيًا.</p>
              <div className="flex justify-end gap-2">
                <button type="button" autoFocus onClick={() => setAssetToDelete(null)} className="h-8 rounded-[6px] border border-line px-3 text-[11px]">
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = assetToDelete;
                    setAssetToDelete(null);
                    void removeAsset(target.id);
                  }}
                  className="h-8 rounded-[6px] bg-danger px-3 text-[11px] font-bold text-white"
                >
                  حذف
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}

function MenuRow({ icon: Icon, label, danger, disabled, onClick }: { icon: any; label: string; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
 "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-right text-[11px] font-bold transition hover:bg-line-2 disabled:opacity-35 disabled:hover:bg-transparent",
        danger && "text-error",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}
