import { useCallback, useEffect, useRef, useState } from "react";

/** Sidebar resize bounds (px) — shared by the drag handler and the persisted default. */
const PANEL_MIN = { left: 232, right: 264 } as const;
const PANEL_MAX = { left: 460, right: 520 } as const;
import {
  Check,
  Download,
  Focus,
  FolderOpen,
  Grid3x3,
  Home,
  Moon,
  PanelLeft,
  PanelRight,
  Redo2,
  Save,
  Sun,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { useEditor, saveLabel, type SaveState } from "@/lib/editor/store";
import { elementsBounds, pageSize } from "@/lib/editor/model";
import { fitImageBox, prepareImage } from "@/lib/editor/images";
import { LeftPanel } from "./LeftPanel";
import { RightPanel } from "./RightPanel";
import { CanvasStage } from "./CanvasStage";
import { ArrangeBar } from "./ArrangeBar";
import { PageRail } from "./PageRail";
import { ExportDialog } from "./ExportDialog";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import { BrandLogo } from "@/components/site/SiteChrome";
import { WorkspaceOverlays, WorkspaceStatusBar, type MenuPoint } from "./WorkspaceOverlays";

/**
 * The studio shell.
 *
 * Route-level concerns (site chrome, navigation) live in `SiteHeader`; this
 * component owns the editor chrome, the hidden file inputs the panels drive,
 * and the global keyboard map.
 */
export function EditorApp() {
  const hydrate = useEditor((s) => s.hydrate);
  const hydrated = useEditor((s) => s.hydrated);

  const projectInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const fontInput = useRef<HTMLInputElement>(null);
  const imageIntent = useRef<{ type: "image" | "logo" | "replace" | "library"; targetId?: string }>({ type: "image" });

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // The studio is a fixed-height shell; the marketing pages scroll normally.
  useEffect(() => {
    document.body.classList.add("is-editor");
    return () => document.body.classList.remove("is-editor");
  }, []);

  /**
   * Shared by the file picker and canvas drag-and-drop.
   *
   * `at` places a dropped image where the pointer landed instead of the
   * palette's default spot, which is what makes dropping feel direct.
   */
  const ingestImage = async (file: File, at?: { x: number; y: number }) => {
    const api = useEditor.getState();
    const intent = imageIntent.current;
    try {
      const img = await prepareImage(file);
      const kind = intent.type === "logo" ? "logo" : "image";

      if (intent.type === "replace" && intent.targetId) {
        // Swapping the source keeps the author's box, rotation, and effects.
        api.updateElement(intent.targetId, { src: img.src });
      } else if (intent.type === "library") {
        await api.addAsset({
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "عنصر",
          src: img.src,
          w: img.width,
          h: img.height,
        });
        toast.success("تمت إضافة العنصر إلى المكتبة");
      } else {
        const max = kind === "logo" ? { w: 40, h: 40 } : { w: 110, h: 90 };
        const box = fitImageBox(img, max);
        api.addElement(kind, {
          src: img.src,
          name: kind === "logo" ? "شعار" : "صورة",
          w: box.w,
          h: box.h,
          x: at ? at.x - box.w / 2 : undefined,
          y: at ? at.y - box.h / 2 : undefined,
        });
      }

      if (img.resized) {
        toast.message("تم تصغير الصورة للحفظ", {
          description: "حُفظت بأبعاد مناسبة للطباعة لتخفيف حجم المشروع.",
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر إضافة الصورة");
    } finally {
      imageIntent.current = { type: "image" };
    }
  };

  if (!hydrated) {
    return (
      <div className="grid h-full place-items-center bg-navy text-white">
        <div className="text-center">
          <p className="text-[15px] font-extrabold text-gold-2">{BRAND.developer}</p>
          <p className="mt-1 text-[12px] text-white/60">جارٍ تحضير مساحة العمل…</p>
        </div>
      </div>
    );
  }

  const openFile = () => projectInput.current?.click();
  const upload = (kind: "image" | "logo" | "font" | "library") => {
    if (kind === "font") fontInput.current?.click();
    else {
      imageIntent.current = { type: kind };
      imageInput.current?.click();
    }
  };
  const replaceImage = (id: string) => {
    imageIntent.current = { type: "replace", targetId: id };
    imageInput.current?.click();
  };

  return (
    <div className="h-full min-h-0">
      <Toaster position="top-center" richColors dir="rtl" />

      <input
        ref={projectInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            try {
              void useEditor.getState().importProject(JSON.parse(String(reader.result)));
            } catch {
              toast.error("تعذر قراءة الملف — تأكد أنه ملف مشروع بصيغة JSON");
            }
          };
          reader.onerror = () => toast.error("تعذر قراءة الملف");
          reader.readAsText(file);
          e.target.value = "";
        }}
      />

      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void ingestImage(file);
        }}
      />

      <input
        ref={fontInput}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const fontName = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
            const face = new FontFace(fontName, `url(${reader.result})`);
            face
              .load()
              .then((loaded) => {
                document.fonts.add(loaded);
                // Registering with the store is what makes the font selectable;
                // adding it to `document.fonts` alone leaves it invisible to the UI.
                useEditor.getState().registerFont(fontName);
                toast.success(`تم تحميل الخط: ${fontName}`);
              })
              .catch(() => toast.error("تعذر تحميل الخط — تأكد من صيغة الملف"));
          };
          reader.onerror = () => toast.error("تعذر قراءة ملف الخط");
          reader.readAsDataURL(file);
        }}
      />

      <Studio onOpenFile={openFile} onUpload={upload} onReplaceImage={replaceImage} onDropImage={ingestImage} />
    </div>
  );
}

function Studio({
  onOpenFile,
  onUpload,
  onReplaceImage,
  onDropImage,
}: {
  onOpenFile: () => void;
  onUpload: (kind: "image" | "logo" | "font" | "library") => void;
  onReplaceImage: (id: string) => void;
  onDropImage: (file: File, at?: { x: number; y: number }) => Promise<void>;
}) {
  const name = useEditor((s) => s.name);
  const setName = useEditor((s) => s.setName);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const dark = useEditor((s) => s.dark);
  const toggle = useEditor((s) => s.toggle);
  const showGrid = useEditor((s) => s.showGrid);
  const previewAll = useEditor((s) => s.previewAll);
  const focusMode = useEditor((s) => s.focusMode);
  const selectedElements = useEditor((s) => s.selectedElements);
  const saveState = useEditor((s) => s.saveState);
  const savedAt = useEditor((s) => s.savedAt);
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const addPage = useEditor((s) => s.addPage);
  const leftOpen = useEditor((s) => s.leftOpen);
  const rightOpen = useEditor((s) => s.rightOpen);
  const leftCollapsed = useEditor((s) => s.leftCollapsed);
  const rightCollapsed = useEditor((s) => s.rightCollapsed);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const copySelected = useEditor((s) => s.copySelected);
  const pasteClipboard = useEditor((s) => s.pasteClipboard);
  const select = useEditor((s) => s.select);
  const updateElement = useEditor((s) => s.updateElement);
  const commit = useEditor((s) => s.commit);
  const selectedId = useEditor((s) => s.selectedId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const saveNow = useEditor((s) => s.saveNow);
  const group = useEditor((s) => s.group);
  const ungroup = useEditor((s) => s.ungroup);
  const selectAll = useEditor((s) => s.selectAll);
  const enterGroup = useEditor((s) => s.enterGroup);
  const enteredGroupId = useEditor((s) => s.enteredGroupId);
  const [contextMenu, setContextMenu] = useState<MenuPoint | null>(null);
  const [panelWidths, setPanelWidths] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("diwan-editor-panel-widths") || "{}");
      return {
        left: Math.min(PANEL_MAX.left, Math.max(PANEL_MIN.left, Number(raw.left) || 280)),
        right: Math.min(PANEL_MAX.right, Math.max(PANEL_MIN.right, Number(raw.right) || 320)),
      };
    } catch {
      return { left: 280, right: 320 };
    }
  });
  const [isDesktop, setIsDesktop] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 1024px)").matches);

  useEffect(() => {
    localStorage.setItem("diwan-editor-panel-widths", JSON.stringify(panelWidths));
  }, [panelWidths]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const activePage = pages.find((p) => p.id === activePageId) || pages[0];
  const activeSize = pageSize(activePage);

  const fitToScreen = useCallback(() => {
    const el = document.querySelector(".studio-grid");
    if (!el) return setZoom(0.82);
    const rect = el.getBoundingClientRect();
    const pagePxW = activeSize.w * 3.7795;
    const pagePxH = activeSize.h * 3.7795;
    // Add some padding around the page for better visibility
    const padding = 20; // pixels
    const next = Math.min((rect.width - padding * 2) / pagePxW, (rect.height - padding * 2) / pagePxH);
    setZoom(Math.max(0.2, Math.min(2, next)));
  }, [activeSize.h, activeSize.w, setZoom]);

  // A 20 s heartbeat keeps "آخر حفظ منذ …" honest without a per-second store write.
  useEffect(() => {
    const id = setInterval(() => {
      useEditor.setState({ clockTick: Date.now() });
    }, 20000);
    return () => clearInterval(id);
  }, []);

  // Flush pending work when the tab is hidden or closed mid-edit.
  useEffect(() => {
    const flush = () => {
      if (useEditor.getState().saveState === "dirty") void saveNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [saveNow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (meta && key === "z") {
        // While the caret is in a field or the in-place text editor, the browser's
        // own undo stack owns Cmd/Ctrl+Z — hijacking it would revert whole project
        // states when the author meant to undo a few characters.
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && key === "y") {
        if (typing) return;
        e.preventDefault();
        redo();
        return;
      }
      if (meta && key === "s") {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (meta && key === "e") {
        e.preventDefault();
        toggle("exportOpen");
        return;
      }
      if (meta && key === "d") {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (meta && key === "c") {
        if (typing) return;
        e.preventDefault();
        copySelected();
        return;
      }
      if (meta && key === "x") {
        if (typing) return;
        e.preventDefault();
        copySelected();
        deleteSelected();
        return;
      }
      if (meta && key === "v") {
        if (typing) return;
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if (meta && key === "a") {
        if (typing) return;
        e.preventDefault();
        selectAll();
        return;
      }
      if (meta && key === "g") {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) ungroup();
        else group();
        return;
      }
      if (!meta && key === "v") return;
      if (!meta && key === "t") {
        e.preventDefault();
        useEditor.getState().setLeftTab("elements");
        return;
      }
      if (!meta && key === "1" && e.shiftKey) {
        e.preventDefault();
        fitToScreen();
        return;
      }
      if (meta && (key === "+" || key === "=")) {
        e.preventDefault();
        setZoom(useEditor.getState().zoom + 0.08);
        return;
      }
      if (meta && key === "-") {
        e.preventDefault();
        setZoom(useEditor.getState().zoom - 0.08);
        return;
      }
      if (meta && key === "0") {
        e.preventDefault();
        fitToScreen();
        return;
      }
      if (typing) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (e.key === "Escape") {
        // Escape steps out of a group first, then clears the selection — so it
        // backs out of the nesting one level at a time instead of jumping to
        // nothing and losing the author's place.
        if (enteredGroupId) enterGroup(null);
        else select(null);
        return;
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && selectedIds.length) {
        e.preventDefault();
        const state = useEditor.getState();
        const selected = state.selectedElements();
        const step = e.shiftKey ? 5 : e.altKey ? 0.5 : 1;
        const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
        const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
        // Move the whole selection, not just the primary element, so a nudge
        // after a marquee behaves the way the author expects.
        for (const id of selectedIds) {
          const el = selected.find((x) => x.id === id);
          if (!el || el.locked) continue;
          updateElement(id, { x: el.x + dx, y: el.y + dy }, true);
        }
        commit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    undo,
    redo,
    saveNow,
    toggle,
    duplicateSelected,
    deleteSelected,
    copySelected,
    pasteClipboard,
    select,
    selectedId,
    selectedIds,
    updateElement,
    commit,
    activePage,
    fitToScreen,
    setZoom,
    group,
    ungroup,
    selectAll,
    enterGroup,
    enteredGroupId,
  ]);

  const label = saveLabel(saveState, savedAt, Date.now());

  /*
   * Live sidebar resizing.
   *
   * Pointer-events based, so mouse and touch share one code path (`touch-action:
   * none` on the handle keeps iOS Safari from turning the drag into a scroll).
   * The left panel sits on the viewport's right edge in this RTL app and its
   * inner edge faces the canvas: dragging that inner edge must GROW the panel.
   * The old sign convention had that inverted, which is why the handles only
   * ever seemed decorative.
   */
  const resizePanel = (side: "left" | "right", startClientX: number, startWidth: number) => {
    document.body.classList.add("is-resizing-panel");
    const move = (event: PointerEvent) => {
      // Left panel: inner edge is on its LEFT side of the grid (DOM-LTR), so
      // width grows as the pointer moves left in screen space. Right panel:
      // inner edge faces the other way, so width grows as the pointer moves
      // right. Both follow the dragged edge.
      const delta = side === "left" ? startClientX - event.clientX : event.clientX - startClientX;
      const width = Math.min(PANEL_MAX[side], Math.max(PANEL_MIN[side], startWidth + delta));
      setPanelWidths((current) => (current[side] === width ? current : { ...current, [side]: width }));
    };
    const finish = () => {
      document.body.classList.remove("is-resizing-panel");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const fitToSelection = () => {
    const bounds = elementsBounds(selectedElements());
    if (!bounds) return fitToScreen();
    const el = document.querySelector(".studio-grid");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Add some padding around the selection for better visibility
    const padding = 20; // pixels
    const next = Math.min((rect.width - padding * 2) / (bounds.w * 3.7795), (rect.height - padding * 2) / (bounds.h * 3.7795));
    setZoom(Math.max(0.2, Math.min(2, next)));
    requestAnimationFrame(() => {
      const target = document.querySelector(`[data-el-id="${CSS.escape(selectedElements()[0]?.id || "")}"]`);
      target?.scrollIntoView({ block: "center", inline: "center" });
    });
  };

  return (
    /*
     * Editor shell.
     *
     * Rows are `auto` (header) + `minmax(0,1fr)` (workspace), so the header may
     * wrap on a narrow tablet without stealing height from the canvas.
     */
    <div className={cn("editor-ui editor-shell grid grid-rows-[auto_minmax(0,1fr)]", dark ? "editor-dark" : "editor-light", focusMode && "editor-focus")}>
      <header className="editor-toolbar z-20 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-3 py-1.5 pt-[max(0.375rem,var(--safe-top))] pr-[max(0.75rem,var(--safe-right))] pl-[max(0.75rem,var(--safe-left))]">
        <div className="flex shrink-0 items-center gap-2">
          <a
            href="/"
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line px-2.5 text-[12px] font-extrabold dark:border-white/10"
            title="العودة إلى الصفحة الرئيسية"
          >
            <Home className="size-4" />
            <span className="hidden sm:inline">الرئيسية</span>
          </a>
          <div className="hidden md:block"><BrandLogo compact /></div>
        </div>

        {/* Scrolls rather than clipping when the viewport cannot hold every control. */}
        <div className="editor-pane-scroll order-last flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto md:order-none md:justify-center">
          <IconButton onClick={undo} disabled={past.length <= 1} title="تراجع (⌘Z)">
            <Undo2 className="size-4" />
          </IconButton>
          <IconButton onClick={redo} disabled={!future.length} title="إعادة (⌘⇧Z)">
            <Redo2 className="size-4" />
          </IconButton>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="اسم المشروع"
            className="mx-1 hidden h-9 max-w-[240px] min-w-0 rounded-[8px] border border-line px-3 text-center text-[13px] font-bold outline-none focus:border-navy-2 lg:block dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
          <IconButton onClick={() => toggle("showGrid")} active={showGrid} title="الشبكة">
            <Grid3x3 className="size-4" />
          </IconButton>
          <IconButton onClick={() => setZoom(zoom - 0.08)} title="تصغير">
            <ZoomOut className="size-4" />
          </IconButton>
          <span className="w-11 shrink-0 text-center text-[12px] font-bold tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <IconButton onClick={() => setZoom(zoom + 0.08)} title="تكبير">
            <ZoomIn className="size-4" />
          </IconButton>
          {/*
           * Fit/100% matter most on tablets, where the canvas is the only thing
           * on screen and a fixed 82% can leave the page off-centre or oversized.
           */}
          <button
            type="button"
            onClick={fitToScreen}
            title="ملاءمة العرض"
            className="hidden h-9 shrink-0 items-center rounded-[8px] border border-line px-2 text-[11px] font-extrabold md:inline-flex dark:border-white/10"
          >
            ملاءمة
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="hidden h-9 shrink-0 items-center rounded-[8px] border border-line px-2 text-[11px] font-extrabold md:inline-flex dark:border-white/10"
          >
            100%
          </button>
          <IconButton onClick={fitToSelection} disabled={!selectedElements().length} title="ملاءمة التحديد">
            <Focus className="size-4" />
          </IconButton>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5">
          <SaveBadge state={saveState} label={label} onClick={() => void saveNow()} />
          <button
            type="button"
            onClick={selectAll}
            disabled={!activePage?.elements.some((el) => !el.locked && !el.hidden)}
            title="تحديد كل عناصر الصفحة (⌘A)"
            className="hidden h-9 rounded-[8px] border border-line px-2.5 text-[12px] font-bold disabled:opacity-40 lg:inline-flex lg:items-center dark:border-white/10"
          >
            تحديد الكل
          </button>
          <button
            type="button"
            onClick={() => toggle("previewAll")}
            aria-pressed={previewAll}
            className={cn(
              "hidden h-9 rounded-[8px] border px-2.5 text-[12px] font-bold xl:inline-flex xl:items-center",
              previewAll ? "border-navy bg-navy text-white" : "border-line dark:border-white/10",
            )}
          >
            كل الصفحات
          </button>
          <IconButton onClick={() => toggle("dark")} title={dark ? "الوضع النهاري" : "الوضع الليلي"}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </IconButton>
          {/* Panel toggles stay live even in focus mode: full screen must never
              mean losing the tools — one tap exits focus and brings the panel
              back (collapsed→open), so the exit is always one press away. */}
          <IconButton
            onClick={() => {
              if (focusMode) {
                useEditor.setState({ focusMode: false, leftCollapsed: false });
                return;
              }
              toggle("leftCollapsed");
            }}
            active={!leftCollapsed && !focusMode}
            title={leftCollapsed && !focusMode ? "إظهار أدوات العناصر" : "طي أدوات العناصر"}
          >
            <PanelLeft className="size-4" />
          </IconButton>
          <IconButton
            onClick={() => {
              if (focusMode) {
                useEditor.setState({ focusMode: false, rightCollapsed: false });
                return;
              }
              toggle("rightCollapsed");
            }}
            active={!rightCollapsed && !focusMode}
            title={rightCollapsed && !focusMode ? "إظهار الخصائص والطبقات" : "طي الخصائص والطبقات"}
          >
            <PanelRight className="size-4" />
          </IconButton>
          <IconButton onClick={() => toggle("focusMode")} active={focusMode} title={focusMode ? "الخروج من وضع التركيز" : "وضع التركيز"}>
            <Focus className="size-4" />
          </IconButton>
          <IconButton onClick={onOpenFile} title="استيراد مشروع من ملف JSON">
            <FolderOpen className="size-4" />
          </IconButton>
          <button
            type="button"
            onClick={() => toggle("exportOpen")}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-navy px-3 text-[12px] font-extrabold text-white"
          >
            <Download className="size-4" />
            تصدير
          </button>
        </div>
      </header>

      {/*
       * Workspace.
       *
       * `lg:grid-rows-[minmax(0,1fr)]` is what keeps the panes on screen: without
       * a bounded row the implicit row sizes to the tallest panel's content, and
       * the overflow is then clipped by `lg:overflow-hidden` — which is exactly
       * how the lower properties controls became unreachable. The wrappers are
       * `h-full min-h-0 overflow-hidden` so each panel's inner `flex-1
       * overflow-auto` region is the thing that scrolls.
       */}
      <div
        onContextMenu={(event) => {
          event.preventDefault();
          const target = (event.target as HTMLElement).closest<HTMLElement>("[data-el-id]");
          const targetId = target?.dataset.elId || null;
          if (targetId && !selectedIds.includes(targetId)) select(targetId);
          setContextMenu({ x: event.clientX, y: event.clientY, targetId });
        }}
        className={cn(
        "editor-focus-workspace relative grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden",
        focusMode || (leftCollapsed && rightCollapsed) ? "lg:grid-cols-[minmax(0,1fr)]" : leftCollapsed ? "lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_336px]" : rightCollapsed ? "lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[292px_minmax(0,1fr)]" : "lg:grid-cols-[280px_minmax(0,1fr)_320px] xl:grid-cols-[292px_minmax(0,1fr)_336px]",
        )}
        style={{
          gridTemplateColumns: focusMode || (leftCollapsed && rightCollapsed)
            ? isDesktop ? "minmax(0, 1fr)" : undefined
            : !isDesktop
              ? undefined
              : leftCollapsed
                ? `minmax(0, 1fr) ${panelWidths.right}px`
                : rightCollapsed
                  ? `${panelWidths.left}px minmax(0, 1fr)`
                  : `${panelWidths.left}px minmax(0, 1fr) ${panelWidths.right}px`,
        }}
      >
        <div
          className={cn(
            "editor-sidebar h-full min-h-0 overflow-hidden",
            "max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:w-[292px] max-lg:shadow-2xl",
            !leftOpen && "max-lg:hidden",
            leftCollapsed && "hidden",
          )}
        >
          <LeftPanel onUpload={onUpload} />
          {!leftCollapsed && !focusMode && <PanelResizeHandle side="left" onStart={(event) => resizePanel("left", event.clientX, panelWidths.left)} />}
        </div>

        <div className="editor-canvas-workspace relative grid min-h-0 grid-rows-[minmax(0,1fr)_auto_auto_auto] overflow-hidden">
          <CanvasStage onDropImage={onDropImage} />
          <ArrangeBar />
          <PageRail />
          <WorkspaceStatusBar />
        </div>

        <div
          className={cn(
            "editor-sidebar editor-properties h-full min-h-0 overflow-hidden",
            "max-lg:absolute max-lg:z-30 max-lg:shadow-2xl",
            // Landscape tablets keep the panel beside the canvas.
            "max-lg:landscape:inset-y-0 max-lg:landscape:left-0 max-lg:landscape:w-[320px]",
            // Portrait tablets get a bottom sheet, so the canvas keeps full width.
            "max-lg:portrait:inset-x-0 max-lg:portrait:bottom-0 max-lg:portrait:h-[52%] max-lg:portrait:w-full max-lg:portrait:rounded-t-2xl max-lg:portrait:border-t max-lg:portrait:border-line",
            !rightOpen && "max-lg:hidden",
            rightCollapsed && "hidden",
          )}
        >
          <RightPanel onReplaceImage={onReplaceImage} />
          {!rightCollapsed && !focusMode && <PanelResizeHandle side="right" onStart={(event) => resizePanel("right", event.clientX, panelWidths.right)} />}
        </div>
      </div>

      {/*
       * Small-screen chrome.
         *
         * One control at a time: the launcher only shows while both drawers are
         * shut, and a single close chip takes over once one is open. Keeping the
         * launcher visible over an open drawer would cover the very controls it
         * was used to reveal.
         */}
        {!(leftOpen || rightOpen) && (
          <div className="pointer-events-none absolute bottom-[152px] left-1/2 z-40 flex -translate-x-1/2 gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => toggle("leftOpen")}
              className="pointer-events-auto h-10 rounded-full bg-navy px-4 text-[12px] font-extrabold text-white shadow-lg shadow-navy/25"
            >
              عناصر
            </button>
            <button
              type="button"
              onClick={() => addPage()}
              className="pointer-events-auto h-10 rounded-full bg-navy px-4 text-[12px] font-extrabold text-white shadow-lg shadow-navy/25"
            >
              صفحة
            </button>
            <button
              type="button"
              onClick={() => toggle("rightOpen")}
              className="pointer-events-auto h-10 rounded-full bg-navy px-4 text-[12px] font-extrabold text-white shadow-lg shadow-navy/25"
            >
              خصائص
            </button>
          </div>
        )}

        {/* Top-centred, so it clears a side drawer on landscape and a bottom sheet on portrait. */}
        {(leftOpen || rightOpen) && (
          <button
            type="button"
            onClick={() => {
              if (useEditor.getState().leftOpen) toggle("leftOpen");
              if (useEditor.getState().rightOpen) toggle("rightOpen");
            }}
            className="absolute left-1/2 top-2 z-40 -translate-x-1/2 rounded-full border border-line bg-white/95 px-4 py-1.5 text-[12px] font-extrabold shadow-lg backdrop-blur-sm lg:hidden dark:border-white/15 dark:bg-[#161c26]/95"
          >
            إغلاق اللوحة
          </button>
        )}

      <WorkspaceOverlays menu={contextMenu} onCloseMenu={() => setContextMenu(null)} fitToScreen={fitToScreen} />
      <ExportDialog />
    </div>
  );
}

function IconButton({
  onClick,
  disabled,
  active,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        "icon-btn grid size-9 shrink-0 place-items-center rounded-[8px] border disabled:opacity-40",
        active ? "border-navy bg-navy text-white" : "border-line dark:border-white/10",
      )}
    >
      {children}
    </button>
  );
}

function SaveBadge({ state, label, onClick }: { state: SaveState; label: string; onClick: () => void }) {
  const tone =
    state === "error"
      ? "border-red-200 bg-red-50 text-danger dark:border-red-500/30 dark:bg-red-500/10"
      : state === "dirty" || state === "saving"
        ? "border-line text-muted dark:border-white/10"
        : "border-ok/30 bg-ok/5 text-ok";
  return (
    <button
      type="button"
      onClick={onClick}
      title="حفظ الآن (⌘S)"
      className={cn(
        "hidden h-9 items-center gap-1.5 rounded-[8px] border px-2.5 text-[11px] font-bold xl:inline-flex",
        tone,
      )}
    >
      {state === "saved" ? <Check className="size-3.5" /> : <Save className="size-3.5" />}
      {label}
    </button>
  );
}

function PanelResizeHandle({ side, onStart }: { side: "left" | "right"; onStart: (event: React.PointerEvent<HTMLDivElement>) => void }) {
  /*
   * A 16px-wide hit strip with a visible 4px grip pill at the canvas edge.
   * `touch-action: none` is what makes the drag work on an iPad; without it
   * Safari turns the gesture into a panel scroll and the handle feels dead.
   */
  return (
    <div
      className={cn("editor-panel-resize-handle", `editor-panel-resize-${side}`)}
      onPointerDown={onStart}
      role="separator"
      aria-orientation="vertical"
      aria-label={`تغيير عرض اللوحة ${side === "left" ? "اليسرى" : "اليمنى"} — اسحب المقبض`}
      title="اسحب لتغيير عرض اللوحة"
    >
      <span className="editor-panel-resize-grip" aria-hidden />
    </div>
  );
}