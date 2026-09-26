import { TouchPropertiesSheet } from "./TouchPropertiesSheet";
import { isTouchPropertiesViewport } from "@/lib/editor/ui-state";
import { useCallback, useEffect, useRef, useState } from "react";

/** Sidebar resize bounds (px) — shared by the drag handler and the persisted default. */
const PANEL_MIN = { left: 232, right: 264 } as const;
const PANEL_MAX = { left: 460, right: 520 } as const;

/**
 * «أدوات التقرير» lives inside the right panel's accordion, whose open/closed
 * state belongs to `RightPanel`. The pinned toolbar button therefore announces
 * intent with an event rather than reaching into another component's state —
 * the panel opens itself, so the two can never disagree about what is showing.
 */
export const OPEN_REPORT_TOOLS_EVENT = "nasaq:open-report-tools";
import {
  BookOpen,
  Check,
  ClipboardList,
  Download,
  FolderPlus,
  Heading1,
  Focus,
  Eye,
  EyeOff,
  GalleryHorizontalEnd,
  FolderOpen,
  Grid3x3,
  Home,
  Library,
  Moon,
  PanelLeft,
  PanelRight,
  PenLine,
  Redo2,
  Save,
  Sun,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  Scan,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import {
  useEditor,
  saveLabel,
  PAGES_PANEL_MIN,
  type SaveState,
} from "@/lib/editor/store";
import { elementsBounds, pageSize } from "@/lib/editor/model";
import { fitImageBox, prepareImage } from "@/lib/editor/images";
import { zoomAnchoredAt } from "@/lib/editor/viewport";
import { LeftPanel } from "./LeftPanel";
import { RightPanel } from "./RightPanel";
import { CanvasStage } from "./CanvasStage";
import { ArrangeBar } from "./ArrangeBar";
import { PageRail } from "./PageRail";
import { ExportDialog } from "./ExportDialog";
import { cn } from "@/lib/utils";
import { EditorWorkspaceSkeleton } from "@/components/ui/Skeleton";
import { WorkspaceOverlays, WorkspaceStatusBar } from "./WorkspaceOverlays";
import { ToolbarMenus } from "./ToolbarMenus";
import { OVERLAY_BREAKPOINT, isOverlayViewport } from "@/lib/editor/ui-state";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useLicense } from "@/lib/license/client";
import { AddLibraryDialog } from "./AddLibraryDialog";
import { HeadingGeneratorDialog } from "./HeadingGeneratorDialog";
import { OnboardingTour, hasSeenTour } from "./OnboardingTour";

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
  const setEntitlements = useEditor((s) => s.setEntitlements);
  const { user } = useCurrentUserState();
  const { entitlements } = useLicense(user?.id, user?.primaryEmail);

  const projectInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const fontInput = useRef<HTMLInputElement>(null);
  const svgInput = useRef<HTMLInputElement>(null);
  const imageIntent = useRef<{
    type: "image" | "logo" | "replace" | "library";
    targetId?: string;
  }>({ type: "image" });
  /** Which kind of reusable vector the next file pick will register. */
  const customAssetIntent = useRef<"icon" | "divider">("icon");
  const customAssetInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Keep editor-side limits in sync with the same server-derived entitlements
  // used by the license and export surfaces.
  useEffect(() => {
    setEntitlements(entitlements);
  }, [entitlements, setEntitlements]);

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
    return <EditorWorkspaceSkeleton />;
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

  /**
   * إضافة SVG من الجهاز: read the chosen .svg file as text, sanity-check it
   * holds an actual <svg>, and place it as a real vector element. The markup
   * is stored raw here — the canvas sanitises on render and export (svg.ts).
   */
  const uploadSvg = () => {
    svgInput.current?.click();
  };

  /**
   * «+ إضافة رمز/فاصل جديد» in the smart library.
   *
   * Reads the file as markup and registers it with the store (persisted), so
   * the vector becomes a reusable library item — distinct from «إضافة SVG من
   * الجهاز», which places a one-off drawing on the page.
   */
  const importCustomAsset = (kind: "icon" | "divider") => {
    customAssetIntent.current = kind;
    customAssetInput.current?.click();
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
              void useEditor
                .getState()
                .importProject(JSON.parse(String(reader.result)));
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

      {/* إضافة SVG من الجهاز — file lives on the page as real vector markup. */}
      <input
        ref={svgInput}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const markup = String(reader.result || "");
            if (!markup.includes("<svg")) {
              toast.error("الملف ليس رسم SVG صالحًا");
              return;
            }
            useEditor.getState().addElement("svg", {
              content: markup,
              name: file.name.replace(/\.svg$/i, "").slice(0, 30) || "رسم SVG",
            });
            toast.success("أُضيف الرسم إلى الصفحة");
          };
          reader.readAsText(file);
        }}
      />

      {/* مكتبة ذكية: SVG icons/dividers the author wants to reuse. */}
      <input
        ref={customAssetInput}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            void useEditor
              .getState()
              .addCustomIcon({
                name: file.name.replace(/\.svg$/i, "").slice(0, 40),
                svg: String(reader.result || ""),
                kind: customAssetIntent.current,
              })
              .then((item) => {
                if (item) toast.success(`تمت إضافة «${item.name}» إلى المكتبة`);
              });
          };
          reader.onerror = () => toast.error("تعذر قراءة الملف");
          reader.readAsText(file);
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
            const fontName = file.name
              .replace(/\.[^.]+$/, "")
              .replace(/[-_]/g, " ");
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

      <Studio
        onOpenFile={openFile}
        onUpload={upload}
        onReplaceImage={replaceImage}
        onDropImage={ingestImage}
        onUploadSvg={uploadSvg}
        onAddCustomAsset={importCustomAsset}
      />
    </div>
  );
}

function Studio({
  onOpenFile,
  onUpload,
  onReplaceImage,
  onDropImage,
  onUploadSvg,
  onAddCustomAsset,
}: {
  onOpenFile: () => void;
  onUpload: (kind: "image" | "logo" | "font" | "library") => void;
  onReplaceImage: (id: string) => void;
  onDropImage: (file: File, at?: { x: number; y: number }) => Promise<void>;
  onUploadSvg: () => void;
  onAddCustomAsset: (kind: "icon" | "divider") => void;
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
  const toggleSidebar = useEditor((s) => s.toggleSidebar);
  const closeFloatingPanels = useEditor((s) => s.closeFloatingPanels);
  const pagesPanelHeight = useEditor((s) => s.pagesPanelHeight);
  const setPagesPanelHeight = useEditor((s) => s.setPagesPanelHeight);
  const contextMenu = useEditor((s) => s.contextMenu);
  const bubbleEnabled = useEditor((s) => s.bubbleEnabled);
  const toggleBubble = useEditor((s) => s.toggleBubble);
  const leftTab = useEditor((s) => s.leftTab);
  const openLibrary = useEditor((s) => s.openLibrary);
  const openContextMenu = useEditor((s) => s.openContextMenu);
  const closeContextMenu = useEditor((s) => s.closeContextMenu);
  const bring = useEditor((s) => s.bring);
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
  const [panelWidths, setPanelWidths] = useState(() => {
    try {
      const raw = JSON.parse(
        localStorage.getItem("diwan-editor-panel-widths") || "{}",
      );
      return {
        left: Math.min(
          PANEL_MAX.left,
          Math.max(PANEL_MIN.left, Number(raw.left) || 280),
        ),
        right: Math.min(
          PANEL_MAX.right,
          Math.max(PANEL_MIN.right, Number(raw.right) || 320),
        ),
      };
    } catch {
      return { left: 280, right: 320 };
    }
  });
  /*
   * Docked panels vs. slide-overs. The width comes from `OVERLAY_BREAKPOINT`
   * (the store's single source of truth) rather than a hardcoded number here:
   * a second copy of this rule is exactly how the shell and the auto-open logic
   * drift apart, and 1100 is where two panels plus a usable A4 artboard stop
   * fitting side by side.
   */
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window === "undefined" || !isOverlayViewport(),
  );
  const [touchProperties, setTouchProperties] = useState(isTouchPropertiesViewport);
  const rightDockCollapsed = rightCollapsed || touchProperties;
  useEffect(() => {
    const media = window.matchMedia("(any-pointer: coarse)");
    const update = () => setTouchProperties(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  /** First load is what arms the auto-fit below. */
  const hydrated = useEditor((s) => s.hydrated);
  /** «أضف مكتبة» and «مولد عناوين الفقرات» are modal, so they own no store state. */
  const [addLibraryOpen, setAddLibraryOpen] = useState(false);
  const [headingGeneratorOpen, setHeadingGeneratorOpen] = useState(false);
  /**
   * First-visit walkthrough. Read once, on mount, so the tour never reappears
   * mid-session after the author dismisses it.
   */
  const [tourOpen, setTourOpen] = useState(
    () => typeof window !== "undefined" && !hasSeenTour(),
  );
  /** Only the very first fit may be skipped when the saved zoom already fits. */
  const firstFitRef = useRef(true);

  /** True when the library tab is the visible one in the components panel. */
  const libraryVisible = isDesktop
    ? leftTab === "library" && !leftCollapsed && !focusMode
    : leftOpen && leftTab === "library";
  useEffect(() => {
    localStorage.setItem(
      "diwan-editor-panel-widths",
      JSON.stringify(panelWidths),
    );
  }, [panelWidths]);

  useEffect(() => {
    const media = window.matchMedia(`(min-width: ${OVERLAY_BREAKPOINT}px)`);
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  /*
   * Re-fit the artboard whenever the SHELL changes shape.
   *
   * Crossing the tablet boundary does not just move the panels — it changes how
   * much room the canvas has (docked columns disappear, drawers float over the
   * artwork). Keeping the old zoom would leave the A4 page wider than the stage
   * and hand the author a horizontal scrollbar the moment they turn their iPad
   * sideways, which is exactly what the tablet mode is supposed to prevent.
   *
   * The fit runs after the layout has settled (a short timeout) because the
   * stage's measured width is what it is only once the panels have actually
   * docked or undocked. It deliberately depends on nothing else: the author's
   * zoom inside a given mode is theirs, and only a mode change or the first load
   * refits. `fitRef` carries the latest callback, so the effect does not re-run
   * (and re-fit) just because the active page changed underneath it.
   */
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      /*
       * First load respects a zoom the author saved — unless that zoom does not
       * fit, which is precisely the case that produces a horizontal scrollbar on
       * a tablet. Later runs are layout changes, where re-fitting is the point.
       */
      if (firstFitRef.current) {
        firstFitRef.current = false;
        const stage = document.querySelector<HTMLElement>(
          ".editor-canvas-stage",
        );
        const activeId = useEditor.getState().activePageId;
        const page = stage?.querySelector<HTMLElement>(
          `[data-page-id="${CSS.escape(activeId ?? "")}"]`,
        );
        const fits =
          !!stage &&
          !!page &&
          page.getBoundingClientRect().width <= stage.clientWidth - 8 &&
          stage.scrollWidth <= stage.clientWidth + 4;
        if (fits) return;
      }
      fitRef.current();
    }, 60);
    return () => clearTimeout(timer);
  }, [isDesktop, hydrated]);

  /*
   * Publish the header's REAL height as `--editor-header-h`.
   *
   * Phase 1 sizes the panel bodies with `calc(100vh - header)`. The header is
   * one row at every width now, but it is still measured rather than
   * hard-coded: on a coarse pointer the icon buttons grow to 44px, and the
   * safe-area insets add to the padding, so the real height is never 52px on
   * every device. Measuring it is what keeps the last property row reachable.
   */
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = headerRef.current;
    if (!node) return;
    const apply = () => {
      const height = Math.round(node.getBoundingClientRect().height);
      document.documentElement.style.setProperty(
        "--editor-header-h",
        `${height}px`,
      );
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, []);

  /** True while a floating drawer is open (tablet/phone only). */
  const drawerOpen = !isDesktop && (leftOpen || (!touchProperties && rightOpen));

  /*
   * Pages panel height — drag handle on its top border.
   *
   * Pointer-based so mouse, pen and touch share one path, with `touch-action:
   * none` on the handle (set in CSS) so Safari does not turn the gesture into a
   * page scroll. The delta is inverted because the handle sits ABOVE the panel:
   * dragging up must make the panel taller.
   */
  const startPagesResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic event: window listeners still drive the drag */
    }
    const startY = event.clientY;
    const startHeight = pagesPanelHeight;
    document.body.classList.add("is-resizing-rail");
    const move = (ev: PointerEvent) =>
      setPagesPanelHeight(startHeight + (startY - ev.clientY));
    const finish = () => {
      document.body.classList.remove("is-resizing-rail");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  /** Keyboard path for the same control (arrow keys, 16px per press). */
  const nudgePagesHeight = (delta: number) =>
    setPagesPanelHeight(pagesPanelHeight + delta);

  const activePage = pages.find((p) => p.id === activePageId) || pages[0];
  const activeSize = pageSize(activePage);

  /** Latest `fitToScreen`, for the layout effect that must not re-subscribe. */
  const fitRef = useRef<() => void>(() => {});

  /**
   * ملاءمة الصفحة / عرض الصفحة بالكامل: pick a zoom that fits the WHOLE
   * artboard (all four edges inside the viewport) and then centre it, so Fit
   * never lands on a smaller view of wherever the author had scrolled to.
   */
  const fitToScreen = useCallback(() => {
    const el = document.querySelector<HTMLElement>(".editor-canvas-stage");
    if (!el) return setZoom(0.82);
    const rect = el.getBoundingClientRect();
    // Measure the ACTIVE artboard, not whichever page happens to be first in
    // the all-pages preview — the fit must always bring the page being edited
    // into view, and pages may carry different sizes.
    const pageEl = document.querySelector<HTMLElement>(
      `.editor-canvas-stage [data-page-id="${CSS.escape(activePage.id)}"]`,
    );
    const pxPerMm =
      pageEl && activeSize.w > 0
        ? pageEl.clientWidth / activeSize.w
        : 96 / 25.4;
    const pagePxW = activeSize.w * pxPerMm;
    const pagePxH = (activeSize.h + 12) * pxPerMm;
    const padding = 28; // pixels of breathing room on every edge
    const next = Math.min(
      Math.max(0, rect.width - padding * 2) / pagePxW,
      Math.max(0, rect.height - padding * 2) / pagePxH,
    );
    setZoom(Math.max(0.2, Math.min(2, next)));
    requestAnimationFrame(() => {
      const stage = document.querySelector<HTMLElement>(".editor-canvas-stage");
      const pageEl2 = stage?.querySelector<HTMLElement>(
        `[data-page-id="${CSS.escape(activePage.id)}"]`,
      );
      if (!stage || !pageEl2) return;
      const sr = stage.getBoundingClientRect();
      const pr = pageEl2.getBoundingClientRect();
      stage.scrollLeft += pr.left + pr.width / 2 - (sr.left + sr.width / 2);
      stage.scrollTop += pr.top + pr.height / 2 - (sr.top + sr.height / 2);
    });
  }, [activePage?.id, activeSize.h, activeSize.w, setZoom]);
  fitRef.current = fitToScreen;

  /**
   * 🪄 ضبط وتنسيق مساحة العمل: dock every panel back to its default place,
   * then — once the columns have re-laid out — fit and centre the artboard.
   * Zoom only ever changes the canvas viewport; the chrome never scales.
   */
  const resetWorkspaceLayout = useEditor((s) => s.resetWorkspaceLayout);
  const arrangeWorkspace = useCallback(() => {
    resetWorkspaceLayout();
    setTimeout(() => fitRef.current(), 80);
  }, [resetWorkspaceLayout]);

  /*
   * Safe auto-fit whenever a DIFFERENT document is loaded (opening a project,
   * creating a new one, importing a file). Keyed on the project id so plain
   * edits never move the author's view.
   */
  const projectId = useEditor((s) => s.id);
  const lastFitProjectRef = useRef<string | undefined>(undefined);
  const lastFitFirstPageRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!hydrated) return;
    const firstPageId = useEditor.getState().pages[0]?.id;
    if (lastFitProjectRef.current === undefined) {
      // First load is owned by the shell-shape effect above.
      lastFitProjectRef.current = projectId ?? "";
      lastFitFirstPageRef.current = firstPageId;
      return;
    }
    if (lastFitProjectRef.current === (projectId ?? "")) return;
    // First autosave assigns an id to the SAME document. Do not interpret a
    // drag's save as opening a project and reset the author's current zoom.
    const assignedId = lastFitProjectRef.current === "" && lastFitFirstPageRef.current === firstPageId;
    lastFitProjectRef.current = projectId ?? "";
    lastFitFirstPageRef.current = firstPageId;
    if (assignedId) return;
    const timer = setTimeout(() => fitRef.current(), 90);
    return () => clearTimeout(timer);
  }, [projectId, hydrated]);

  /**
   * Toolbar/keyboard zoom keeps the middle of the current view stable. With a
   * bare setZoom the artboard rescales around its top edge and whatever the
   * author was looking at flies off-screen — zoom then stops being a way to
   * navigate. Anchoring on the viewport centre (same mechanism as ctrl+wheel)
   * keeps the visible content in place at every step.
   */
  const zoomCentered = useCallback(
    (next: number) => {
      const stage = document.querySelector<HTMLElement>(".editor-canvas-stage");
      if (!stage) return setZoom(Math.max(0.2, Math.min(2, next)));
      const r = stage.getBoundingClientRect();
      zoomAnchoredAt(
        stage,
        useEditor.getState().zoom,
        next,
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
    },
    [setZoom],
  );

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
      const typing =
        !!t &&
        (t.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
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
      /*
       * Photoshop muscle memory (step 9).
       *
       *   V           أداة التحديد/التحريك — the tool every other one returns to
       *   T           أداة النص — drag a box, type straight away
       *   R           أداة الأشكال — drag a box, get a rectangle
       *   Space+drag  pan (owned by the canvas)
       *
       * The tool itself lives in the canvas (it owns the page geometry); the
       * shortcut only broadcasts, exactly like the «نص بالرسم» toolbar button,
       * so there is one implementation of "arm the tool" and it is never
       * duplicated in the shell.
       */
      if (!meta && !e.altKey && key === "v") {
        e.preventDefault();
        armTool(null);
        return;
      }
      if (!meta && !e.altKey && key === "t") {
        e.preventDefault();
        // Both halves of "text tool": show the text tab and arm the drag-to-draw
        // gesture, so a press on the artboard starts typing.
        useEditor.getState().setLeftTab("elements");
        armTool("text");
        return;
      }
      if (!meta && !e.altKey && key === "r") {
        e.preventDefault();
        useEditor.getState().setLeftTab("shapes");
        armTool("rect");
        return;
      }
      if (meta && key === "j") {
        if (typing) return;
        e.preventDefault();
        duplicateSelected();
        return;
      }
      /*
       * Layer order on the bracket keys, the Photoshop arrangement:
       *   ⌘] forward   ⌘[ back   ⌘⇧] to front   ⌘⇧[ to back
       * `e.code` covers layouts where the bracket sits behind another glyph
       * (including the Arabic keymap), so the shortcut is not layout-dependent.
       */
      if (meta && (key === "[" || e.code === "BracketLeft")) {
        if (typing) return;
        e.preventDefault();
        bring(e.shiftKey ? "bottom" : "back");
        return;
      }
      if (meta && (key === "]" || e.code === "BracketRight")) {
        if (typing) return;
        e.preventDefault();
        bring(e.shiftKey ? "front" : "forward");
        return;
      }
      if (!meta && e.shiftKey && (key === "1" || e.code === "Digit1")) {
        e.preventDefault();
        fitToScreen();
        return;
      }
      /*
       * Keyboard zoom targets the CANVAS only (artboard + content): the
       * toolbar, panels and header keep their size at every zoom level, so
       * buttons stay hittable and no panel can leave the screen. Browser zoom
       * is never touched.
       */
      if (meta && (key === "+" || key === "=")) {
        e.preventDefault();
        zoomCentered(useEditor.getState().zoom + 0.08);
        return;
      }
      if (meta && key === "-") {
        e.preventDefault();
        zoomCentered(useEditor.getState().zoom - 0.08);
        return;
      }
      if (meta && (key === "0" || e.code === "Digit0")) {
        e.preventDefault();
        fitToScreen();
        return;
      }
      /*
       * Escape closes a floating drawer before it touches the selection: on a
       * tablet the drawer covers the canvas, so the author's first Escape means
       * "put the artwork back", not "clear what I had selected".
       */
      if (
        e.key === "Escape" &&
        !isDesktop &&
        (useEditor.getState().leftOpen || useEditor.getState().rightOpen)
      ) {
        e.preventDefault();
        closeFloatingPanels();
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
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) &&
        selectedIds.length
      ) {
        e.preventDefault();
        const state = useEditor.getState();
        const selected = state.selectedElements();
        const step = e.shiftKey ? 5 : e.altKey ? 0.5 : 1;
        const dx =
          e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
        const dy =
          e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
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
    zoomCentered,
    setZoom,
    group,
    ungroup,
    bring,
    selectAll,
    enterGroup,
    enteredGroupId,
    isDesktop,
    closeFloatingPanels,
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
  /**
   * Ask the canvas to switch tool. `null` is the select/move tool.
   *
   * A window event keeps the tool state in the one component that needs it
   * (the canvas measures page coordinates), so this is a broadcast, not a
   * second source of truth.
   */
  const armTool = (tool: "text" | "rect" | null) => {
    window.dispatchEvent(new CustomEvent("nasaq:tool", { detail: tool }));
  };

  const resizePanel = (
    side: "left" | "right",
    startClientX: number,
    startWidth: number,
  ) => {
    document.body.classList.add("is-resizing-panel");
    const move = (event: PointerEvent) => {
      // Left panel: inner edge is on its LEFT side of the grid (DOM-LTR), so
      // width grows as the pointer moves left in screen space. Right panel:
      // inner edge faces the other way, so width grows as the pointer moves
      // right. Both follow the dragged edge.
      const delta =
        side === "left"
          ? startClientX - event.clientX
          : event.clientX - startClientX;
      const width = Math.min(
        PANEL_MAX[side],
        Math.max(PANEL_MIN[side], startWidth + delta),
      );
      setPanelWidths((current) =>
        current[side] === width ? current : { ...current, [side]: width },
      );
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
    const el = document.querySelector(".editor-canvas-stage");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pageContent = document.querySelector<HTMLElement>(
      ".editor-canvas-stage .page-frame-content",
    );
    const activePageScale =
      pageContent && activeSize.w > 0
        ? pageContent.clientWidth / activeSize.w
        : 96 / 25.4;
    const padding = 20; // pixels
    const next = Math.min(
      (rect.width - padding * 2) / (bounds.w * activePageScale),
      (rect.height - padding * 2) / (bounds.h * activePageScale),
    );
    setZoom(Math.max(0.2, Math.min(2, next)));
    requestAnimationFrame(() => {
      const target = document.querySelector(
        `[data-el-id="${CSS.escape(selectedElements()[0]?.id || "")}"]`,
      );
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
    <div
      className={cn(
        "editor-ui editor-shell grid grid-rows-[auto_minmax(0,1fr)]",
        dark ? "editor-dark" : "editor-light",
        focusMode && "editor-focus",
      )}
    >
      {/*
       * Toolbar row — ONE line at every width.
       *
       * The row is `flex-nowrap` and is itself the horizontal scroller
       * (`overflow-x-auto` + `whitespace-nowrap`): the brand group, the history
       * + zoom cluster and the actions group are all `shrink-0`, so nothing is
       * ever squeezed onto a second line, and nothing is clipped off the edge
       * either. At `md` and up the tool tray is `min-w-0` and absorbs the
       * slack — it narrows and scrolls inside its own box (`md:overflow-x-auto`
       * is the tray's, not the row's) so the row itself rarely needs to scroll.
       * On a phone the four groups are together wider than the screen, so the
       * row scrolls: the strip slides under the finger instead of breaking into
       * a stack of ragged lines, which is what used to push controls past the
       * right edge.
       *
       * The global actions the author reaches for constantly are the first
       * controls on that strip — Undo/Redo and Zoom/Fit (pinned cluster) right
       * after the brand group, then Save and Export — so at most one short
       * swipe separates the author from any of them at any width.
       */}
      <header
        ref={headerRef}
        data-editor-obstacle="header"
        className="editor-toolbar z-[var(--z-panel)] flex flex-nowrap items-center gap-x-2 overflow-x-auto whitespace-nowrap border-b px-3 py-1.5 pr-[max(0.75rem,var(--safe-right))] pl-[max(0.75rem,var(--safe-left))] pt-[max(0.375rem,var(--safe-top))]"
      >
        <div className="flex shrink-0 items-center gap-2">
          <a
            href="/"
            className="inline-flex h-9 items-center gap-1 rounded-[8px] px-2 text-[12px] font-extrabold transition hover:bg-line-2 dark:hover:bg-white/10"
            title="العودة إلى الصفحة الرئيسية"
          >
            <Home className="size-4" />
          </a>
          <button
            type="button"
            onClick={() => {
              useEditor.setState({
                leftTab: "elements",
                leftOpen: true,
                leftCollapsed: false,
              });
              window.dispatchEvent(new CustomEvent("nasaq:draw-text"));
            }}
            className="inline-flex h-9 items-center gap-1 rounded-[8px] px-2 text-[12px] font-extrabold transition hover:bg-line-2 dark:hover:bg-white/10"
            title="إدراج مربع نص — اسحب على الصفحة لتحديد موضعه وحجمه"
            aria-label="إدراج مربع نص"
            data-tour="text-tool"
          >
            <PenLine className="size-4" />
            {/*
             * Icon-only by design. The old inline caption read as a how-to
             * rather than a tool name and squeezed the tool tray; the control
             * now carries a formal Arabic tooltip and an accessible label
             * instead, exactly like the other single-icon actions.
             */}
            <span className="sr-only">إدراج مربع نص</span>
          </button>
          {/**
           * «مشاريعي» → صفحة المشاريع. A real same-tab navigation (anchor) so it
           * works from any editor state — project, page, panel, focus mode —
           * with no dependency on editor state at all.
           */}
          <a
            href="/projects"
            className="inline-flex h-9 items-center gap-1 rounded-[8px] px-2 text-[12px] font-extrabold transition hover:bg-line-2 dark:hover:bg-white/10"
            title="الانتقال إلى مشاريعي"
          >
            <BookOpen className="size-4" />
          </a>
          {/**
           * PINNED TOOLS — «أدوات التقرير», «المكتبة», «أضف مكتبة», «عناوين
           * الفقرات».
           *
           * These four live in the toolbar itself: outside the scrollable tray
           * and outside both side panels, because they are the controls a
           * report author reaches for on every page. Pinning them here means
           * they survive focus mode, a collapsed panel and a narrow tablet —
           * nothing has to be opened first.
           */}
          <span
            className="mx-0.5 h-6 w-px shrink-0 bg-line dark:bg-white/10"
            aria-hidden
          />
          <button
            type="button"
            data-tour="report-tools"
            onClick={() => {
              // Report tools are docked in the RIGHT panel, so pinning the
              // button means: leave focus mode, open that panel, switch it to
              // «الخصائص» and expand the section. RightPanel listens for the
              // event — the accordion state belongs to it, not to the toolbar.
              useEditor.setState({
                focusMode: false,
                rightCollapsed: false,
                rightOpen: true,
                rightTab: "properties",
              });
              window.dispatchEvent(new CustomEvent(OPEN_REPORT_TOOLS_EVENT));
            }}
            className="inline-flex h-9 items-center gap-1 rounded-[8px] px-2 text-[12px] font-extrabold transition hover:bg-line-2 dark:hover:bg-white/10"
            title="أدوات التقرير — بطاقات المؤشرات، الختم، الترويسة والتذييل، ومراجعة ما قبل الطباعة"
          >
            <ClipboardList className="size-4" />
            <span className="hidden 2xl:inline">أدوات التقرير</span>
          </button>
          <button
            type="button"
            data-tour="library-toggle"
            onClick={() => {
              // One button, two directions: a second press retracts the dock
              // (or closes the drawer), so the Library is a toggle, not a
              // one-way door.
              if (libraryVisible) {
                if (focusMode)
                  useEditor.setState({
                    focusMode: false,
                    leftCollapsed: false,
                    leftOpen: false,
                  });
                else toggleSidebar("left");
                return;
              }
              openLibrary();
            }}
            aria-pressed={libraryVisible}
            className={cn(
              "inline-flex h-9 items-center gap-1 rounded-[8px] px-2 text-[12px] font-extrabold transition hover:bg-line-2 dark:hover:bg-white/10",
              libraryVisible && "bg-navy/10 text-navy dark:bg-white/10 dark:text-gold-2",
            )}
            title={libraryVisible ? "إغلاق المكتبة" : "فتح المكتبة"}
          >
            <Library className="size-4" />
            <span className="hidden 2xl:inline">المكتبة</span>
          </button>
          <button
            type="button"
            onClick={() => setAddLibraryOpen(true)}
            className="inline-flex h-9 items-center gap-1 rounded-[8px] px-2 text-[12px] font-extrabold transition hover:bg-line-2 dark:hover:bg-white/10"
            title="أضف مكتبة — حوّل أي مجلد أو مجموعة ملفات إلى مجلدات بنمط نَسَق"
          >
            <FolderPlus className="size-4" />
            <span className="hidden 2xl:inline">أضف مكتبة</span>
          </button>
          <button
            type="button"
            onClick={() => setHeadingGeneratorOpen(true)}
            className="inline-flex h-9 items-center gap-1 rounded-[8px] px-2 text-[12px] font-extrabold transition hover:bg-line-2 dark:hover:bg-white/10"
            title="مولد عناوين الفقرات — تصاميم جاهزة وقابلة للتعديل"
          >
            <Heading1 className="size-4" />
            <span className="hidden 2xl:inline">عناوين الفقرات</span>
          </button>
        </div>

        {/*
         * Scrolls rather than clipping when the viewport cannot hold every
         * control. The inner `w-max` wrapper is what keeps centering safe:
         * `justify-center` on a scroll container lets overflowing items spill
         * over BOTH edges and pile onto the neighbouring groups, while
         * `mx-auto` centers only when the row fits and scrolls from its start
         * edge when it does not.
         */}
        {/*
         * Tool tray.
         *
         * Below `md` it is `min-w-fit` + `order-last`: `min-w-fit` keeps it at
         * its natural width so it never scrolls inside its own box — it simply
         * takes part in the row's scroll — and `order-last` puts it at the END
         * of that single row (brand ▸ history/zoom ▸ actions ▸ tray), so the
         * menus, the project name and the grid toggle stay one swipe away
         * instead of wrapping the toolbar into a second line. From `md` up
         * `md:order-none` returns it to the middle and `min-w-0` lets it shrink
         * into whatever space the outer groups leave, and its own
         * `overflow-x-auto` then does the scrolling (the tablet behaviour)
         * rather than the row.
         */}
        {/*
         * Pinned cluster — history + zoom.
         *
         * These four actions are pressed constantly and in a hurry (undo the
         * last nudge, zoom out to see the page), so they must never scroll off
         * the row on a tablet. They therefore sit OUTSIDE the scrollable tray,
         * `shrink-0`, next to the brand group; the tray keeps the menus, the
         * project name and the grid toggle, which are the items that can afford
         * to slide.
         */}
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            onClick={undo}
            disabled={past.length <= 1}
            title="تراجع (⌘Z)"
          >
            <Undo2 className="size-4" />
          </IconButton>
          <IconButton
            onClick={redo}
            disabled={!future.length}
            title="إعادة (⌘⇧Z)"
          >
            <Redo2 className="size-4" />
          </IconButton>
          <span
            className="mx-0.5 h-6 w-px shrink-0 bg-line dark:bg-white/10"
            aria-hidden
          />
          <IconButton onClick={() => zoomCentered(zoom - 0.08)} title="تصغير">
            <ZoomOut className="size-4" />
          </IconButton>
          <span className="w-10 shrink-0 text-center text-[12px] font-bold tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <IconButton onClick={() => zoomCentered(zoom + 0.08)} title="تكبير">
            <ZoomIn className="size-4" />
          </IconButton>
          {/*
           * Fit is the companion action of zooming (it used to be buried in the
           * View menu), so it stays on the strip in one click at every size.
           */}
          <IconButton onClick={fitToScreen} title="ملاءمة الصفحة">
            <Scan className="size-4" />
          </IconButton>
          <button
            type="button"
            onClick={arrangeWorkspace}
            title="ضبط وتنسيق مساحة العمل — ملاءمة الصفحة وتوسيطها وإعادة اللوحات لأماكنها"
            aria-label="ضبط وتنسيق مساحة العمل"
            className="ms-1 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[9px] border border-emerald-500/40 bg-emerald-500/10 px-2.5 text-[12px] font-extrabold text-emerald-700 transition hover:bg-emerald-500/20 dark:border-emerald-400/40 dark:text-emerald-300"
          >
            <span aria-hidden>🪄</span>
            <span className="hidden xl:inline">ضبط وتنسيق مساحة العمل</span>
          </button>
        </div>

        <div className="editor-pane-scroll order-last flex min-w-fit flex-1 items-center overflow-x-auto whitespace-nowrap md:order-none md:min-w-0">
          <div className="mx-auto flex w-max items-center gap-1">
            {/* Secondary tools grouped into four real, keyboard-accessible menus.
              Fit/100% live in the View menu (قائمة «عرض»). */}
            <span
              className="mx-0.5 h-6 w-px shrink-0 bg-line dark:bg-white/10"
              aria-hidden
            />
            <ToolbarMenus
              fitToScreen={fitToScreen}
              fitToSelection={fitToSelection}
            />
            <span
              className="mx-0.5 h-6 w-px shrink-0 bg-line dark:bg-white/10"
              aria-hidden
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="اسم المشروع"
              className="mx-0.5 block h-9 w-24 min-w-0 shrink rounded-[8px] px-2 text-center text-[12px] font-bold outline-none hover:bg-line-2 focus:bg-line-2 dark:bg-white/5 dark:text-white"
            />
            <IconButton
              onClick={() => toggle("showGrid")}
              active={showGrid}
              title="الشبكة"
            >
              <Grid3x3 className="size-4" />
            </IconButton>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5">
          <SaveBadge
            state={saveState}
            label={label}
            onClick={() => void saveNow()}
          />
          <IconButton
            onClick={() => toggle("previewAll")}
            active={previewAll}
            title="كل الصفحات"
          >
            <GalleryHorizontalEnd className="size-4" />
          </IconButton>
          <IconButton
            onClick={() => toggle("dark")}
            title={dark ? "الوضع النهاري" : "الوضع الليلي"}
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </IconButton>
          {/* Panel toggles stay live even in focus mode: full screen must never
              mean losing the tools — one tap exits focus and brings the panel
              back (collapsed→open), so the exit is always one press away. */}
          {/*
           * Sidebar toggles (Phase 1).
           *
           * ONE button per sidebar that is correct in every layout: docked
           * screens flip the collapsed flag, tablet/phone flip the floating
           * drawer — so the control never looks dead (the old buttons toggled
           * the desktop-only flag, which did nothing visible at <1024px).
           * Leaving focus mode restores the docks instead of merely toggling.
           */}
          <IconButton
            onClick={() => {
              if (focusMode) {
                useEditor.setState({
                  focusMode: false,
                  leftCollapsed: false,
                  leftOpen: false,
                });
                return;
              }
              toggleSidebar("left");
            }}
            active={isDesktop ? !leftCollapsed && !focusMode : leftOpen}
            title={
              isDesktop
                ? leftCollapsed
                  ? "إظهار لوحة المكونات"
                  : "طي لوحة المكونات"
                : leftOpen
                  ? "إغلاق لوحة المكونات"
                  : "فتح لوحة المكونات"
            }
          >
            <PanelRight className="size-4" />
          </IconButton>
          <IconButton
            onClick={() => {
              if (focusMode) {
                useEditor.setState({
                  focusMode: false,
                  rightCollapsed: false,
                  rightOpen: touchProperties,
                });
                return;
              }
              toggleSidebar("right");
            }}
            active={isDesktop && !touchProperties ? !rightCollapsed && !focusMode : rightOpen}
            title={
              isDesktop && !touchProperties
                ? rightCollapsed
                  ? "إظهار لوحة الخصائص"
                  : "طي لوحة الخصائص"
                : rightOpen
                  ? "إغلاق لوحة الخصائص"
                  : "فتح لوحة الخصائص"
            }
          >
            <PanelLeft className="size-4" />
          </IconButton>
          {/*
           * The Library toggle now sits with the other pinned tools at the
           * START of the strip («المكتبة»), so this slot keeps the panel and
           * focus controls the author needs while actually editing.
           */}
          {/*
           * Floating bubble visibility. Tooltips and the bubble itself explain
           * the state, so the icon never has to carry the meaning alone.
           */}
          <IconButton
            onClick={() => toggleBubble()}
            active={bubbleEnabled}
            title={
              bubbleEnabled
                ? "إخفاء الشريط العائم للعنصر المحدد"
                : "إظهار الشريط العائم للعنصر المحدد"
            }
          >
            {bubbleEnabled ? (
              <Eye className="size-4" />
            ) : (
              <EyeOff className="size-4" />
            )}
          </IconButton>
          <IconButton
            onClick={() => toggle("focusMode")}
            active={focusMode}
            title={focusMode ? "الخروج من وضع التركيز" : "وضع التركيز"}
          >
            <Focus className="size-4" />
          </IconButton>
          <IconButton onClick={onOpenFile} title="استيراد مشروع من ملف JSON">
            <FolderOpen className="size-4" />
          </IconButton>
          <button
            type="button"
            onClick={() => toggle("exportOpen")}
            className="inline-flex h-9 items-center gap-1 rounded-[8px] bg-navy px-2 text-[12px] font-extrabold text-white"
          >
            <Download className="size-4" />
            تصدير
          </button>
        </div>
      </header>

      {/*
       * Workspace.
       *
       * `lg2:grid-rows-[minmax(0,1fr)]` is what keeps the panes on screen: without
       * a bounded row the implicit row sizes to the tallest panel's content, and
       * the overflow is then clipped by `lg2:overflow-hidden` — which is exactly
       * how the lower properties controls became unreachable. The wrappers are
       * `h-full min-h-0 overflow-hidden` so each panel's inner `flex-1
       * overflow-auto` region is the thing that scrolls.
       */}
      <div
        onContextMenu={(event) => {
          event.preventDefault();
          const target = (event.target as HTMLElement).closest<HTMLElement>(
            "[data-el-id]",
          );
          const targetId = target?.dataset.elId || null;
          if (targetId && !selectedIds.includes(targetId)) select(targetId);
          openContextMenu({
            x: event.clientX,
            y: event.clientY,
            targetId,
            source: "canvas",
          });
        }}
        className={cn(
          "editor-focus-workspace editor-workspace-row relative grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden",
          focusMode || (leftCollapsed && rightDockCollapsed)
            ? "lg2:grid-cols-[minmax(0,1fr)]"
            : leftCollapsed
              ? "lg2:grid-cols-[minmax(360px,1fr)_320px] xl:grid-cols-[minmax(420px,1fr)_336px]"
              : rightDockCollapsed
                ? "lg2:grid-cols-[280px_minmax(360px,1fr)] xl:grid-cols-[292px_minmax(420px,1fr)]"
                : "lg2:grid-cols-[280px_minmax(360px,1fr)_320px] xl:grid-cols-[292px_minmax(420px,1fr)_336px]",
        )}
        style={{
          /*
           * Docking transition (fix #5): the Library button and the sidebar
           * toggles animate the column change so the dock slides instead of
           * snapping. `is-resizing-panel` (set while a resizer is dragged)
           * switches the transition off, so manual resizing stays 1:1 with the
           * pointer and never feels laggy.
           */
          transition:
            "grid-template-columns 180ms cubic-bezier(0.22, 1, 0.36, 1)",
          gridTemplateColumns:
            focusMode || (leftCollapsed && rightDockCollapsed)
              ? isDesktop
                ? "minmax(0, 1fr)"
                : undefined
              : !isDesktop
                ? undefined
                : leftCollapsed
                  ? `minmax(360px, 1fr) ${panelWidths.right}px`
                  : rightDockCollapsed
                    ? `${panelWidths.left}px minmax(360px, 1fr)`
                    : `${panelWidths.left}px minmax(360px, 1fr) ${panelWidths.right}px`,
        }}
      >
        <div
          data-tour="left-panel"
          className={cn(
            "editor-sidebar relative z-[var(--z-panel)] h-full min-h-0 overflow-hidden",
            /*
             * Phase 1 — below the breakpoint the panel FLOATS over the canvas
             * (a slide-over), it never squishes the artboard. In RTL the
             * components panel belongs to the visual right edge, which is the
             * physical `right` side here.
             */
            "max-lg2:fixed max-lg2:inset-y-0 max-lg2:right-0 max-lg2:z-[var(--z-drawer)] max-lg2:w-[min(320px,86vw)] max-lg2:shadow-2xl",
            "max-lg2:transition-transform max-lg2:duration-200 max-lg2:ease-out",
            !leftOpen && "max-lg2:translate-x-full",
            !leftOpen && "max-lg2:pointer-events-none",
            leftCollapsed && "lg2:hidden",
          )}
        >
          {/*
           * Panel close button — inside the tab-strip row's own flow, not
           * floating: an absolutely-positioned X previously sat ON TOP of the
           * first tabs (and any content near the panel's top corner), covering
           * them. Keeping it in-flow removes the overlap at every size, zoom
           * and theme without hiding the affordance.
           */}
          <div className="flex items-center justify-start border-b border-line px-1.5 py-1 dark:border-white/10">
            <button
              type="button"
              onClick={() =>
                isDesktop ? toggle("leftCollapsed") : closeFloatingPanels()
              }
              aria-label="إغلاق لوحة العناصر"
              title="إغلاق لوحة العناصر"
              className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-line px-2 text-[10px] font-extrabold text-muted hover:text-ink dark:border-white/10"
            >
              <X className="size-3.5" /> إغلاق
            </button>
          </div>
          <LeftPanel
            onUpload={onUpload}
            onUploadSvg={onUploadSvg}
            onAddCustomAsset={onAddCustomAsset}
          />
          {!leftCollapsed && !focusMode && (
            <PanelResizeHandle
              side="left"
              onStart={(event) =>
                resizePanel("left", event.clientX, panelWidths.left)
              }
            />
          )}
        </div>

        <div className="editor-canvas-workspace relative grid min-h-0 grid-rows-[minmax(0,1fr)_auto_auto_auto] overflow-hidden">
          {/*
           * Tapping the canvas dismisses the floating drawers: on a tablet the
           * artwork is what the author wants to see, and reaching for a close
           * chip to do it would be a second, avoidable gesture.
           */}
          <CanvasStage
            onDropImage={onDropImage}
            onCanvasTap={() => (drawerOpen ? closeFloatingPanels() : undefined)}
          />
          <ArrangeBar />
          <div
            data-editor-obstacle="page-rail-resizer"
            className="editor-page-rail-resizer"
            role="separator"
            aria-orientation="horizontal"
            aria-label="تغيير ارتفاع لوحة الصفحات — اسحب"
            title="اسحب لتغيير ارتفاع لوحة الصفحات"
            tabIndex={0}
            onPointerDown={startPagesResize}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                nudgePagesHeight(16);
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                nudgePagesHeight(-16);
              }
            }}
          />
          {/*
           * Pages panel height is applied to the rail itself (and its thumbs
           * scale through `--rail-height`), so growing the panel reveals more
           * page rows instead of distorting the thumbnails' aspect ratio.
           */}
          <div
            data-editor-obstacle="page-rail"
            className="min-h-0 min-w-0"
            style={{ height: pagesPanelHeight }}
          >
            <PageRail height={pagesPanelHeight} minHeight={PAGES_PANEL_MIN} />
          </div>
          <WorkspaceStatusBar />
        </div>

        {touchProperties ? (
          <TouchPropertiesSheet open={rightOpen && !focusMode} onClose={() => useEditor.setState({ rightOpen: false })}>
            <RightPanel onReplaceImage={onReplaceImage} />
          </TouchPropertiesSheet>
        ) : (
          <div
            className={cn(
              "editor-sidebar editor-properties relative z-[var(--z-panel)] h-full min-h-0 overflow-hidden",
              /*
               * The properties panel is the visual LEFT sidebar; it slides in from
               * the physical left edge on tablet/phone, identically in landscape
               * and portrait so muscle memory carries across orientations.
               */
              /*
               * Tablet width: the Properties/Layers drawer is compact by default
               * (288px ≈ `w-72`) between 768 and 1024px, so it covers noticeably
               * less of the artboard it floats over; phones keep the roomier
               * `min(340px, 90vw)` slide-over, where the canvas is stacked behind
               * the drawer anyway.
               */
              "max-lg2:fixed max-lg2:inset-y-0 max-lg2:left-0 max-lg2:z-[var(--z-drawer)] max-lg2:w-[min(340px,90vw)] max-lg2:shadow-2xl md:max-lg2:w-72",
              "max-lg2:transition-transform max-lg2:duration-200 max-lg2:ease-out",
              !rightOpen && "max-lg2:-translate-x-full",
              !rightOpen && "max-lg2:pointer-events-none",
              rightCollapsed && "lg2:hidden",
            )}
          >
            {/* Same in-flow close row for the properties panel. */}
            <div className="flex items-center justify-end border-b border-line px-1.5 py-1 dark:border-white/10">
              <button
                type="button"
                onClick={() =>
                  isDesktop ? toggle("rightCollapsed") : closeFloatingPanels()
                }
                aria-label="إغلاق لوحة الخصائص"
                title="إغلاق لوحة الخصائص"
                className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-line px-2 text-[10px] font-extrabold text-muted hover:text-ink dark:border-white/10"
              >
                <X className="size-3.5" /> إغلاق
              </button>
            </div>
            <RightPanel onReplaceImage={onReplaceImage} />
            {!rightCollapsed && !focusMode && (
              <PanelResizeHandle
                side="right"
                onStart={(event) =>
                  resizePanel("right", event.clientX, panelWidths.right)
                }
              />
            )}
          </div>
        )}
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
        <div
          className="pointer-events-none absolute left-1/2 z-[var(--z-drawer)] flex -translate-x-1/2 gap-2 lg2:hidden"
          style={{ bottom: `calc(${pagesPanelHeight}px + 12px)` }}
        >
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

      {/*
       * The old floating «إغلاق اللوحة» pill used to sit absolutely at the
       * top centre of the shell — right on top of the toolbar controls and
       * the artboard beneath them. Each drawer now carries its own in-flow
       * «إغلاق» chip in its header (and the launcher chips reappear once
       * both are shut), so nothing needs to float above the workspace.
       */}

      {/*
       * Shared backdrop for the floating drawers. Tapping it (or the canvas)
       * closes them; it is rendered behind the drawers but above the canvas.
       */}
      {drawerOpen && (
        <div
          className="editor-drawer-backdrop"
          onClick={closeFloatingPanels}
          aria-hidden
        />
      )}

      <WorkspaceOverlays
        menu={contextMenu}
        onCloseMenu={closeContextMenu}
        fitToScreen={fitToScreen}
      />
      <ExportDialog />

      {/*
       * Modal workbenches, mounted at the shell level so they survive a panel
       * collapse, a focus-mode toggle or a page switch while open.
       */}
      {addLibraryOpen && <AddLibraryDialog onClose={() => setAddLibraryOpen(false)} />}
      {headingGeneratorOpen && (
        <HeadingGeneratorDialog onClose={() => setHeadingGeneratorOpen(false)} />
      )}
      {/*
       * First-visit walkthrough. Mounted only after hydration: the tour
       * measures real controls, and measuring a skeleton would highlight the
       * wrong rectangle on a slow first paint.
       */}
      {tourOpen && hydrated && (
        <OnboardingTour onFinish={() => setTourOpen(false)} />
      )}
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
        /*
         * Frame-less, one uniform size: every toolbar control is the same 36px
         * control with a hover wash instead of a drawn border, so the row reads
         * as one tool strip at any zoom level. Active keeps the filled navy
         * state — that is what makes the on/off state readable without a frame.
         */
        "grid size-9 shrink-0 place-items-center rounded-[8px] transition hover:bg-line-2 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-white/10",
        active &&
          "bg-navy text-white hover:bg-navy dark:bg-navy dark:text-white",
      )}
    >
      {children}
    </button>
  );
}

function SaveBadge({
  state,
  label,
  onClick,
}: {
  state: SaveState;
  label: string;
  onClick: () => void;
}) {
  const tone =
    state === "error"
      ? "bg-red-500/10 text-danger"
      : state === "dirty" || state === "saving"
        ? "text-muted"
        : "text-ok";
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} (⌘S)`}
      className={cn(
        // Same 36px control as the rest of the strip; the state lives in the
        // icon and colour, the full label in the tooltip.
        "grid size-9 shrink-0 place-items-center rounded-[8px] transition hover:bg-line-2 dark:hover:bg-white/10",
        tone,
      )}
    >
      {state === "saved" ? (
        <Check className="size-4" />
      ) : (
        <Save className="size-4" />
      )}
    </button>
  );
}

function PanelResizeHandle({
  side,
  onStart,
}: {
  side: "left" | "right";
  onStart: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  /*
   * A 16px-wide hit strip with a visible 4px grip pill at the canvas edge.
   * `touch-action: none` is what makes the drag work on an iPad; without it
   * Safari turns the gesture into a panel scroll and the handle feels dead.
   */
  return (
    <div
      className={cn(
        "editor-panel-resize-handle",
        `editor-panel-resize-${side}`,
      )}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // Same guard as CanvasStage: synthetic events (no live pointer) make
        // setPointerCapture throw NotFoundError.
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* drag still works through window-level pointermove listeners */
        }
        onStart(event);
      }}
      role="separator"
      aria-orientation="vertical"
      aria-label={`تغيير عرض اللوحة ${side === "left" ? "اليسرى" : "اليمنى"} — اسحب المقبض`}
      title="اسحب لتغيير عرض اللوحة"
    >
      <span className="editor-panel-resize-grip" aria-hidden />
    </div>
  );
}
