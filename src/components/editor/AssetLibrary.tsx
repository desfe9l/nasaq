import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ArrowRight, Check, Download, Eye, Folder, FolderOpen, FolderPlus, Grid2X2, ImagePlus, List, MoreHorizontal, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { useEditor } from "@/lib/editor/store";
import type { Asset } from "@/lib/editor/storage";
import { downloadLibraryFile, planLibraryImport } from "@/lib/editor/library-export";
import { cn } from "@/lib/utils";

type PendingAsset = Asset & { fileName: string };

export function AssetLibrary() {
  const assets = useEditor((s) => s.assets);
  const assetsLoading = useEditor((s) => s.assetsLoading);
  const addElement = useEditor((s) => s.addElement);
  const removeAsset = useEditor((s) => s.removeAsset);
  const renameAsset = useEditor((s) => s.renameAsset);
  const addAsset = useEditor((s) => s.addAsset); // تأكد أن هذه الدالة موجودة في الـ store لحفظ الصور، أو يتم تمريرها عبر الـ props
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
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const libraryImportRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [pending, setPending] = useState<PendingAsset[]>([]);
  const [preview, setPreview] = useState<Asset | PendingAsset | null>(null);
  const [savingPending, setSavingPending] = useState(false);
  const [folderDialog, setFolderDialog] = useState<"create" | "rename" | "delete" | null>(null);
  /**
   * Element pending deletion. Deleting an asset is destructive and one click
   * away in a dense toolbar, so it goes through the same confirmation pattern
   * as folders instead of firing straight from the button.
   */
  const [assetToDelete, setAssetToDelete] = useState<Asset | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "compact">("grid");
  /**
   * Left-click menu on one asset: the card opens a small command menu instead
   * of burying every action in hover micro-buttons. `pickFolder` flips the
   * same panel into the folder picker so «إضافة إلى مجلد» stays one click deep.
   */
  const [menu, setMenu] = useState<{ asset: Asset; x: number; y: number } | null>(null);
  const [pickFolder, setPickFolder] = useState(false);

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

  // Escape closes the menu from anywhere — focus may be on the card button or
  // nowhere in particular, so a window-level listener is the reliable channel.
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

  /** Single-asset download: same bytes the canvas uses, under its own name. */
  const downloadAsset = (asset: Asset) => {
    const a = document.createElement("a");
    a.href = asset.src;
    a.download = asset.name || "asset";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const visibleAssets = assets.filter((asset) => (asset.folderId || null) === folderId);
  const currentFolder = folders.find((folder) => folder.id === folderId);

  const place = (asset: Asset) => {
    const max = { w: 90, h: 90 };
    const scale = Math.min(max.w / asset.w, max.h / asset.h, 1);
    addElement("image", {
      src: asset.src,
      name: asset.name,
      w: Math.max(12, Math.round(asset.w * scale)),
      h: Math.max(12, Math.round(asset.h * scale)),
    });
  };

  const startRename = (asset: Asset) => {
    setEditingId(asset.id);
    setDraftName(asset.name);
  };

  const commitRename = () => {
    if (editingId) void renameAsset(editingId, draftName);
    setEditingId(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const next: PendingAsset[] = [];
    for (const file of Array.from(files)) {
      const src = await readImage(file);
      if (!src) continue;
      const dimensions = await imageDimensions(src);
      next.push({
        id: `pending-${file.name}-${file.lastModified}`,
        fileName: file.name,
        name: file.name.replace(/\.[^/.]+$/, "").slice(0, 40) || "عنصر",
        src,
        w: dimensions.w,
        h: dimensions.h,
        addedAt: Date.now(),
      });
    }
    setPending(next);
    e.target.value = "";
  };

  const savePending = async () => {
    if (savingPending || pending.length === 0) return;
    setSavingPending(true);
    try {
      for (const item of pending) {
        await addAsset({ name: item.name, src: item.src, w: item.w, h: item.h });
      }
      setPending([]);
    } finally {
      setSavingPending(false);
    }
  };

  /*
   * Library export / import: one JSON file carries the whole shelf between
   * devices. Import merges (fresh ids, exact duplicates skipped) so nothing
   * already saved is lost or rewritten.
   */
  const exportLibrary = () => {
    const name = downloadLibraryFile({ folders, assets });
    toast.success(`تم تنزيل المكتبة — ${name}`);
  };

  const importLibrary = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      const plan = planLibraryImport(raw, { folders, assets });
      for (const folder of plan.folders) {
        await createAssetFolder(folder.name);
      }
      for (const asset of plan.assets) {
        await addAsset({ name: asset.name, src: asset.src, w: asset.w, h: asset.h, folderId: asset.folderId });
      }
      toast.success(
        plan.assets.length
          ? `أُضيف ${plan.assets.length} عنصر${plan.skipped ? ` — تخطّي ${plan.skipped} مكرر` : ""}`
          : plan.skipped
            ? "كل العناصر موجودة مسبقًا — لا شيء جديد"
            : "الملف فارغ — لا عناصر لاستيرادها",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر قراءة ملف المكتبة.");
    }
  };

  return (
    <section className="asset-library grid gap-2">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-[12px] font-extrabold tracking-wide">مكتبة العناصر</h3>
          <p className="mt-0.5 text-[10px] text-muted">معاينة قبل الحفظ، ثم إدراج وتعديل مباشر</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={exportLibrary} aria-label="تصدير المكتبة" title="تصدير المكتبة (ملف واحد بكل المجلدات والعناصر)" className="grid size-7 place-items-center rounded-[6px] border border-line dark:border-white/10"><Download className="size-3.5" /></button>
          <button type="button" onClick={() => libraryImportRef.current?.click()} aria-label="استيراد مكتبة" title="استيراد مكتبة من ملف (يُدمج مع الحالي)" className="grid size-7 place-items-center rounded-[6px] border border-line dark:border-white/10"><Upload className="size-3.5" /></button>
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
          <button type="button" onClick={() => setViewMode("grid")} aria-label="عرض شبكي" aria-pressed={viewMode === "grid"} className={cn("grid size-7 place-items-center rounded-[6px] border", viewMode === "grid" ? "border-navy bg-navy/10" : "border-line dark:border-white/10")}><Grid2X2 className="size-3.5" /></button>
          <button type="button" onClick={() => setViewMode("compact")} aria-label="عرض مضغوط" aria-pressed={viewMode === "compact"} className={cn("grid size-7 place-items-center rounded-[6px] border", viewMode === "compact" ? "border-navy bg-navy/10" : "border-line dark:border-white/10")}><List className="size-3.5" /></button>
          <span className="rounded-full bg-line-2 px-2 py-1 text-[10px] font-bold tabular-nums text-muted dark:bg-white/10">{visibleAssets.length}</span>
        </div>
      </header>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        <button type="button" onClick={() => setAssetFolder(null)} className={cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] border px-2 text-[10px] font-bold", !folderId ? "border-navy bg-navy/10" : "border-line dark:border-white/10")}>
          <Folder className="size-3" /> الكل
        </button>
        {folders.map((folder) => (
          <button key={folder.id} type="button" onClick={() => setAssetFolder(folder.id)} className={cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] border px-2 text-[10px] font-bold", folderId === folder.id ? "border-navy bg-navy/10" : "border-line dark:border-white/10")}>
            <Folder className="size-3" /> {folder.name}
          </button>
        ))}
        <button type="button" onClick={() => { setFolderDraft(""); setFolderDialog("create"); }} className="grid size-7 shrink-0 place-items-center rounded-[6px] border border-line dark:border-white/10" title="مجلد جديد" aria-label="مجلد جديد"><FolderPlus className="size-3.5" /></button>
        {currentFolder && <>
          <button type="button" onClick={() => { setFolderDraft(currentFolder.name); setFolderDialog("rename"); }} className="grid size-7 shrink-0 place-items-center rounded-[6px] border border-line dark:border-white/10" title="إعادة تسمية المجلد" aria-label="إعادة تسمية المجلد"><Pencil className="size-3" /></button>
          <button type="button" onClick={() => setFolderDialog("delete")} className="grid size-7 shrink-0 place-items-center rounded-[6px] border border-line text-red-600 dark:border-white/10" title="حذف المجلد" aria-label="حذف المجلد"><Trash2 className="size-3" /></button>
        </>}
      </div>

      {selectedAssetIds.length > 0 && <div className="flex items-center gap-2 rounded-[7px] border border-gold/50 bg-gold/5 p-1.5 text-[10px]">
        <span className="font-bold">{selectedAssetIds.length} محدد</span>
        <select aria-label="نقل العناصر إلى مجلد" defaultValue="" onChange={(e) => { if (e.target.value !== "") void moveAssetsToFolder(selectedAssetIds, e.target.value === "root" ? null : e.target.value); }} className="h-7 min-w-0 flex-1 rounded border border-line bg-transparent px-1 text-[10px] dark:border-white/10">
          <option value="">نقل إلى…</option><option value="root">المكتبة الرئيسية</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
        <button type="button" onClick={clearAssetSelection} className="text-muted">إلغاء</button>
      </div>}

      {pending.length > 0 && (
        <div className="rounded-[8px] border border-gold/60 bg-gold/2 p-2 dark:bg-gold/10">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-extrabold">معاينة قبل الحفظ</p>
              <p className="text-[9px] text-muted">{pending.length} ملف جاهز للمراجعة</p>
            </div>
            <button type="button" onClick={() => setPending([])} className="grid size-6 place-items-center rounded-[6px] text-muted" title="إلغاء الملفات" aria-label="إلغاء الملفات">
              <X className="size-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {pending.map((item) => (
              <button key={item.id} type="button" onClick={() => setPreview(item)} className="overflow-hidden rounded-[6px] border border-line bg-white p-1 text-start dark:border-white/10 dark:bg-white/5" title={`معاينة ${item.name}`}>
                <div className="grid h-14 place-items-center bg-line-2/50 dark:bg-white/5"><img src={item.src} alt={item.name} className="max-h-12 max-w-full object-contain" /></div>
                <span className="mt-1 block truncate text-[9px]">{item.name}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void savePending()} disabled={savingPending} className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[6px] bg-navy text-[10px] font-extrabold text-white disabled:opacity-50">
            <Check className="size-3.5" /> {savingPending ? "جارٍ الحفظ…" : "حفظ الملفات في المكتبة"}
          </button>
        </div>
      )}

      {assetsLoading ? (
        <p className="text-[10px] text-muted">جارٍ تحميل المكتبة…</p>
      ) : visibleAssets.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-line p-3 text-center dark:border-white/10">
          <p className="text-[10px] leading-5 text-muted">
            احفظ أي صورة أو شعار أو شكل ترفعه ليظهر هنا وتستخدمه في أي مشروع لاحقاً.
          </p>
        </div>
      ) : (
        <div className={cn("grid gap-2", viewMode === "grid" ? "grid-cols-[repeat(auto-fill,minmax(118px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(92px,1fr))]")}>
          {visibleAssets.map((asset) => (
            <div key={asset.id} className={cn("group relative rounded-[8px] border bg-white/60 p-1.5 dark:bg-white/5", selectedAssetIds.includes(asset.id) ? "border-navy bg-navy/5 ring-1 ring-navy/30" : "border-line dark:border-white/10")}>
              <button type="button" onClick={(e) => { e.stopPropagation(); toggleAssetSelect(asset.id); }} aria-label={`تحديد ${asset.name}`} className={cn("absolute right-2 top-2 z-10 grid size-5 place-items-center rounded-full border bg-white/90 dark:bg-[#161c26]/90", selectedAssetIds.includes(asset.id) ? "border-navy bg-navy text-white" : "border-line dark:border-white/20")}>
                {selectedAssetIds.includes(asset.id) && <Check className="size-3" />}
              </button>
              {/* Menu affordance: same command list the card click opens. */}
              <button type="button" onClick={(e) => openMenu(e, asset)} aria-label={`خيارات ${asset.name}`} aria-haspopup="menu" className="absolute left-2 top-2 z-10 grid size-5 place-items-center rounded-full border border-line bg-white/90 text-muted dark:border-white/20 dark:bg-[#161c26]/90" title="الخيارات">
                <MoreHorizontal className="size-3" />
              </button>
              {editingId === asset.id ? (
                <div className="flex h-20 flex-col gap-1 rounded-[6px] border border-navy-2 p-1 dark:border-gold/60">
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="h-5 w-full rounded-[4px] border border-line px-1 text-[9px] dark:border-white/10 dark:bg-white/5"
                  />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={commitRename}
                      className="grid h-5 flex-1 place-items-center rounded-[4px] bg-navy text-white"
                      title="حفظ الاسم"
                    >
                      <Check className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="grid h-5 flex-1 place-items-center rounded-[4px] border border-line dark:border-white/10"
                      title="إلغاء"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={(e) => openMenu(e, asset)}
                    aria-haspopup="menu"
                    aria-expanded={menu?.asset.id === asset.id}
                    title={`خيارات "${asset.name}" — إدراج، مجلد، معاينة، تسمية، حذف`}
                    className={cn(
                      "grid w-full place-items-center overflow-hidden rounded-[6px]",
                      viewMode === "grid" ? "h-20" : "h-14",
                      "border border-line bg-white transition hover:border-navy-2 dark:border-white/10 dark:bg-white/5",
                    )}
                  >
                    <img
                      src={asset.src}
                      alt={asset.name}
                      className={cn("max-w-full object-contain", viewMode === "grid" ? "max-h-[4.5rem]" : "max-h-[3.25rem]")}
                    />
                  </button>
                  <span className="mt-1 block truncate text-center text-[9px] text-muted">
                    {asset.name}
                  </span>
                  <div className="mt-1 flex items-center justify-center gap-1">
                    <button type="button" onClick={(e) => { e.stopPropagation(); place(asset); }} title="إدراج في الصفحة" aria-label="إدراج في الصفحة" className="grid size-6 place-items-center rounded-[5px] bg-navy text-white"><Plus className="size-3" /></button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        multiple
        accept="image/*"
        className="hidden"
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold dark:border-white/10"
      >
        <ImagePlus className="size-3.5" /> حفظ عنصر جديد في المكتبة
      </button>

      {menu && createPortal(
        /* Left-click command menu for one library asset. The backdrop closes
           without acting (same contract as the folder dialog), Escape works
           from anywhere, and «إضافة إلى مجلد…» flips this same panel into the
           folder picker instead of nesting a second floating window.
           Rendered through a portal at <body>: from inside the sidebar's
           stacking context the backdrop would paint under the neighbouring
           properties panel and outside clicks on that side would never close
           the menu. */
        <div
          className="fixed inset-0 z-50"
          onPointerDown={closeMenu}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); closeMenu(); } }}
          tabIndex={-1}
        >
          <div
            role="menu"
            aria-label={`خيارات ${menu.asset.name}`}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute min-w-[200px] rounded-[10px] border border-line bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-[#161c26]"
            style={{
              left: Math.max(8, Math.min(menu.x, window.innerWidth - 216)),
              top: Math.max(8, Math.min(menu.y, window.innerHeight - 330)),
            }}
          >
            {pickFolder ? (
              <>
                <MenuRow icon={ArrowRight} label="رجوع" onClick={() => setPickFolder(false)} />
                <div className="my-1 border-t border-line dark:border-white/10" />
                <MenuRow
                  icon={FolderOpen}
                  label="المكتبة الرئيسية"
                  disabled={!menu.asset.folderId}
                  onClick={() => {
                    void moveAssetsToFolder([menu.asset.id], null);
                    toast.success(`نُقل «${menu.asset.name}» إلى المكتبة الرئيسية`);
                    closeMenu();
                  }}
                />
                {folders.map((folder) => (
                  <MenuRow
                    key={folder.id}
                    icon={Folder}
                    label={folder.name}
                    disabled={menu.asset.folderId === folder.id}
                    onClick={() => {
                      void moveAssetsToFolder([menu.asset.id], folder.id);
                      toast.success(`أُضيف «${menu.asset.name}» إلى مجلد «${folder.name}»`);
                      closeMenu();
                    }}
                  />
                ))}
                {!folders.length && (
                  <p className="px-2.5 py-1.5 text-[10px] leading-5 text-muted">
                    لا توجد مجلدات بعد — أنشئ مجلدًا من شريط المجلدات أعلى المكتبة.
                  </p>
                )}
              </>
            ) : (
              <>
                <MenuRow
                  icon={Plus}
                  label="إدراج على الصفحة"
                  onClick={() => { place(menu.asset); closeMenu(); }}
                />
                <MenuRow
                  icon={FolderOpen}
                  label="إضافة إلى مجلد…"
                  onClick={() => setPickFolder(true)}
                />
                <MenuRow icon={Eye} label="معاينة" onClick={() => { setPreview(menu.asset); closeMenu(); }} />
                <MenuRow icon={Pencil} label="إعادة تسمية" onClick={() => { startRename(menu.asset); closeMenu(); }} />
                <MenuRow icon={Download} label="تنزيل الصورة" onClick={() => { downloadAsset(menu.asset); closeMenu(); }} />
                <MenuRow
                  icon={Check}
                  label={selectedAssetIds.includes(menu.asset.id) ? "إلغاء التحديد" : "تحديد للنقل"}
                  onClick={() => { toggleAssetSelect(menu.asset.id); closeMenu(); }}
                />
                <div className="my-1 border-t border-line dark:border-white/10" />
                <MenuRow
                  icon={Trash2}
                  label="حذف من المكتبة…"
                  danger
                  onClick={() => { setAssetToDelete(menu.asset); closeMenu(); }}
                />
              </>
            )}
          </div>
        </div>,
        document.body,
      )}

      {preview && createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy/55 p-4" role="dialog" aria-modal="true" aria-label={`معاينة ${preview.name}`} onClick={() => setPreview(null)}>
          <div className="w-full max-w-sm rounded-[10px] bg-white p-3 shadow-xl dark:bg-[#161c26]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div><p className="text-[12px] font-extrabold">معاينة العنصر</p><p className="max-w-[15rem] truncate text-[10px] text-muted">{preview.name}</p></div>
              <button type="button" onClick={() => setPreview(null)} className="grid size-7 place-items-center rounded-[6px] border border-line dark:border-white/10" title="إغلاق المعاينة" aria-label="إغلاق المعاينة"><X className="size-4" /></button>
            </div>
            <div className="grid min-h-48 place-items-center rounded-[8px] border border-line bg-line-2/50 p-4 dark:border-white/10 dark:bg-white/5"><img src={preview.src} alt={preview.name} className="max-h-64 max-w-full object-contain" /></div>
            <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-muted"><span>{preview.w} × {preview.h} px</span><button type="button" onClick={() => { place(preview); setPreview(null); }} className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-navy px-3 font-extrabold text-white"><Plus className="size-3.5" /> إدراج وتحديد</button></div>
          </div>
        </div>,
        document.body,
      )}

      {folderDialog && createPortal(
        /*
         * Destructive-action confirmation. The backdrop has no click handler —
         * a stray click outside the card can never confirm anything — and
         * Escape closes from anywhere inside the dialog, whatever holds focus.
         * The initial focus sits on "إلغاء", so a hasty Enter cancels instead
         * of confirming the delete. Portal: same stacking-context reason as
         * the asset menu above.
         */
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-navy/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={folderDialog === "create" ? "إنشاء مجلد" : folderDialog === "rename" ? "إعادة تسمية مجلد" : "حذف المجلد نهائيًا"}
          onKeyDown={(event) => { if (event.key === "Escape") setFolderDialog(null); }}
        >
          {folderDialog === "delete" ? (
            <div className="grid w-full max-w-xs gap-3 rounded-[10px] bg-white p-4 shadow-xl dark:bg-[#161c26]">
              <strong className="text-[13px]">حذف المجلد نهائيًا؟</strong>
              <p className="text-[11px] leading-6 text-muted">سيتم حذف هذا المجلد ومحتوياته نهائيًا، ولا يمكن التراجع عن هذا الإجراء.</p>
              <div className="flex justify-end gap-2"><button type="button" autoFocus onClick={() => setFolderDialog(null)} className="h-8 rounded-[6px] border border-line px-3 text-[11px] dark:border-white/10">إلغاء</button><button type="button" onClick={() => { if (currentFolder) void deleteAssetFolder(currentFolder.id); setFolderDialog(null); }} className="h-8 rounded-[6px] bg-red-600 px-3 text-[11px] font-bold text-white">حذف نهائيًا</button></div>
            </div>
          ) : (
          <form className="grid w-full max-w-xs gap-3 rounded-[10px] bg-white p-4 shadow-xl dark:bg-[#161c26]" onSubmit={(event) => { event.preventDefault(); if (folderDialog === "create") void createAssetFolder(folderDraft); else if (currentFolder) void renameAssetFolder(currentFolder.id, folderDraft); setFolderDialog(null); }}>
            <strong className="text-[12px]">{folderDialog === "create" ? "مجلد جديد" : "إعادة تسمية المجلد"}</strong>
            <input autoFocus value={folderDraft} onChange={(event) => setFolderDraft(event.target.value)} aria-label="اسم المجلد" className="h-9 rounded-[7px] border border-line px-2 text-[12px] dark:border-white/10 dark:bg-white/5" />
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setFolderDialog(null)} className="h-8 rounded-[6px] border border-line px-3 text-[11px] dark:border-white/10">إلغاء</button><button type="submit" className="h-8 rounded-[6px] bg-navy px-3 text-[11px] font-bold text-white">حفظ</button></div>
          </form>
          )}
        </div>,
        document.body,
      )}

      {assetToDelete && createPortal(
        /* Same destructive-action contract as the folder dialog: no confirm on
           backdrop click, Escape cancels, and focus starts on «إلغاء». */
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-navy/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="تأكيد حذف العنصر"
          onKeyDown={(event) => { if (event.key === "Escape") setAssetToDelete(null); }}
        >
          <div className="grid w-full max-w-xs gap-3 rounded-[10px] bg-white p-4 shadow-xl dark:bg-[#161c26]">
            <strong className="text-[13px]">هل أنت متأكد من الحذف؟</strong>
            <p className="text-[11px] leading-6 text-muted">
              سيتم حذف «{assetToDelete.name}» من المكتبة نهائيًا. العناصر التي أُدرجت في الصفحات لا تتأثر.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setAssetToDelete(null)}
                className="h-8 rounded-[6px] border border-line px-3 text-[11px] dark:border-white/10"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = assetToDelete;
                  setAssetToDelete(null);
                  void removeAsset(target.id);
                }}
                className="h-8 rounded-[6px] bg-red-600 px-3 text-[11px] font-bold text-white"
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

function readImage(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function imageDimensions(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ w: image.naturalWidth || 100, h: image.naturalHeight || 100 });
    image.onerror = () => resolve({ w: 100, h: 100 });
    image.src = src;
  });
}

/** One command row inside the asset menu — shared styling for both views. */
function MenuRow({ icon: Icon, label, danger, disabled, onClick }: {
  icon: typeof Plus;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-right text-[11px] font-bold transition hover:bg-line-2 disabled:opacity-35 disabled:hover:bg-transparent dark:hover:bg-white/10",
        danger && "text-red-600 dark:text-red-400",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}
