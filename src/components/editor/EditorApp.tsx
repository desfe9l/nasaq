import { subscribeTheme } from "@/lib/theme";
import { shortcutKey } from "@/lib/editor/keyboard";
import { EditorSettingsDialog } from "./EditorSettingsDialog";
import { OPEN_EDITOR_SETTINGS_EVENT } from "@/lib/editor/ui-state";
import { TouchPropertiesSheet } from "./TouchPropertiesSheet";
import { isTouchPropertiesViewport } from "@/lib/editor/ui-state";
import { useCallback, useEffect, useRef, useState } from "react";

/** Sidebar resize bounds (px) — shared by the drag handler and the persisted default. */
const PANEL_MIN = { left: 232, right: 264 } as const;
const PANEL_MAX = { left: 460, right: 520 } as const;
/** Drag distance past a tablet drawer's minimum width that collapses it. */
const DRAWER_COLLAPSE_DRAG = 72;

/**
 * «أدوات التقرير» lives inside the right panel's accordion, whose open/closed
 * state belongs to `RightPanel`. The pinned toolbar button therefore announces
 * intent with an event rather than reaching into another component's state —
 * the panel opens itself, so the two can never disagree about what is showing.
 */
export const OPEN_REPORT_TOOLS_EVENT = "nasaq:open-report-tools";
import {
  Check,
  ClipboardList,
  Download,
  Eye,
  FolderPlus,
  Grid3x3,
  Heading1,
  Home,
  Library,
  Maximize,
  Minimize,
  Minus,
  PenLine,
  Plus,
  Redo2,
  Save,
  Scan,
  Undo2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { ThemedToaster } from "@/components/ui/ThemedToaster";
import {
  useEditor,
  saveLabel,
  PAGES_PANEL_MIN,
  type SaveState,
  type LeftTab,
  type RightTab,
} from "@/lib/editor/store";
import { absoluteBounds, elementsBounds, pageSize } from "@/lib/editor/model";
import { fitImageBox, prepareImage } from "@/lib/editor/images";
import { zoomAnchoredAt } from "@/lib/editor/viewport";
import { LeftPanel } from "./LeftPanel";
import { RightPanel } from "./RightPanel";
import { LEFT_PANEL_TABS, RIGHT_PANEL_TABS } from "./panel-tabs";
import { StudioToolDock, CollapsedPanelDock } from "./StudioToolDock";
import { CanvasStage } from "./CanvasStage";
import { ArrangeBar } from "./ArrangeBar";
import { PageRail } from "./PageRail";
import { ExportDialog } from "./ExportDialog";
import { cn } from "@/lib/utils";
import { EditorWorkspaceSkeleton } from "@/components/ui/Skeleton";
import { WorkspaceOverlays, WorkspaceStatusBar } from "./WorkspaceOverlays";
import { ToolbarMenus } from "./ToolbarMenus";
import { EditorAccountMenu } from "./EditorAccountMenu";
import { OVERLAY_BREAKPOINT, isOverlayViewport } from "@/lib/editor/ui-state";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useLicense } from "@/lib/license/client";
import { WORKSPACE_HOME_PATH } from "@/lib/auth/use-workspace-entry";
import { AddLibraryDialog } from "./AddLibraryDialog";
import { HeadingGeneratorDialog } from "./HeadingGeneratorDialog";
import { OnboardingTour, hasSeenTour } from "./OnboardingTour";
import { NsqIntake } from "./NsqIntake";
import { useNsqSignedIn } from "@/lib/nsq/use-nsq-session";
import { ProjectFileMenu, NSQ_SAVE_AS_EVENT } from "./ProjectFileMenu";
import { NSQ_ACCEPT } from "@/lib/nsq/format";
import { receiveProjectFile } from "@/lib/nsq/intake";
import { rememberUploadedFont } from "@/lib/nsq/fonts";

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
  const { entitlements, hasLicense, isAdmin, isSuspended } = useLicense(
    user?.id,
    user?.primaryEmail,
  );
  /** A licensed account's «الرئيسية» is its NASAQ Home; everyone else's is the site. */
  const homeHref =
    !isSuspended && (hasLicense || isAdmin) ? WORKSPACE_HOME_PATH : "/";
  const { signedIn: nsqSignedIn } = useNsqSignedIn();

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
      <ThemedToaster position="top-center" richColors dir="rtl" />

      {/*
       * Project files: native `.nsq` packages plus legacy JSON backups. Both go
       * through the validated `.nsq` intake — nothing is imported unchecked.
       */}
      <input
        ref={projectInput}
        type="file"
        accept={NSQ_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void receiveProjectFile(file, nsqSignedIn);
        }}
      />

      <NsqIntake />

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
                // Kept so a `.nsq` save can embed the font file it uses.
                rememberUploadedFont(fontName, String(reader.result));
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
        homeHref={homeHref}
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
  homeHref,
}: {
  onOpenFile: () => void;
  onUpload: (kind: "image" | "logo" | "font" | "library") => void;
  onReplaceImage: (id: string) => void;
  onDropImage: (file: File, at?: { x: number; y: number }) => Promise<void>;
  onUploadSvg: () => void;
  onAddCustomAsset: (kind: "icon" | "divider") => void;
  /** Where «الرئيسية» leads: the licensed Home, or the site for everyone else. */
  homeHref: string;
}) {
  const name = useEditor((s) => s.name);
  const setName = useEditor((s) => s.setName);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const [settingsTab, setSettingsTab] = useState<"editor" | "account" | null>(null);
  useEffect(() => {
    const openSettings = (event: Event) => setSettingsTab((event as CustomEvent).detail === "account" ? "account" : "editor");
    window.addEventListener(OPEN_EDITOR_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(OPEN_EDITOR_SETTINGS_EVENT, openSettings);
  }, []);
  const dark = useEditor((s) => s.dark);
  useEffect(() => subscribeTheme((value) => useEditor.setState({ dark: value })), []);
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
  const leftTab = useEditor((s) => s.leftTab);
  const rightTab = useEditor((s) => s.rightTab);
  const openLibrary = useEditor((s) => s.openLibrary);
  const openContextMenu = useEditor((s) => s.openContextMenu);
  const closeContextMenu = useEditor((s) => s.closeContextMenu);
  const bring = useEditor((s) => s.bring);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const copySelected = useEditor((s) => s.copySelected);
  const pasteClipboard = useEditor((s) => s.pasteClipboard);
  const copyStyle = useEditor((s) => s.copyStyle);
  const pasteStyle = useEditor((s) => s.pasteStyle);
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
    const update = () => {
      setIsDesktop(media.matches);
      // Dock visibility is not an explicit request to open a tablet drawer.
      // Rotating an iPad across the breakpoint must leave the canvas usable.
      if (!media.matches) useEditor.getState().closeFloatingPanels();
    };
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
   * Phase 1 sizes the panel bodies with `calc(100vh - header)`. The header
   * wraps onto extra lines when the viewport cannot hold every group, so it
   * is measured rather than hard-coded: on a coarse pointer the icon buttons grow to 44px, and the
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
    const pagePxH = activeSize.h * pxPerMm;
    const padding = 28; // pixels of breathing room on every edge
    const next = Math.min(
      Math.max(0, rect.width - padding * 2) / pagePxW,
      Math.max(0, rect.height - padding * 2 - 36) / pagePxH,
    );
    setZoom(Math.max(0.2, Math.min(2, next)));
    requestAnimationFrame(() => {
      const stage = document.querySelector<HTMLElement>(".editor-canvas-stage");
      const pageEl2 = stage?.querySelector<HTMLElement>(
        `[data-page-id="${CSS.escape(activePage.id)}"]`,
      );
      if (!stage || !pageEl2) return;
      const sr = stage.getBoundingClientRect();
      const pr = (pageEl2.closest(".artboard-cell") ?? pageEl2).getBoundingClientRect();
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
   * ملء الشاشة — part of the unified canvas-scaling cluster: the whole
   * studio (chrome + artboard) fills the device, so a tablet becomes a
   * true drafting surface. Tracked live so the glyph reflects an Escape
   * exit as faithfully as the button itself.
   */
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== "undefined" && !!document.fullscreenElement,
  );
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }, []);

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

  /**
   * Leaving the editor through its own links (Home, مشاريعي).
   *
   * The debounced auto-save and the page-1 thumbnail capture are async; a plain
   * anchor tears the page down before they finish, so the last edits could be
   * lost. Finish the pending save first, then navigate. A modified click (new
   * tab/window) is left to the browser — this tab keeps editing.
   */
  const leaveEditor = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const state = useEditor.getState();
    if (state.saveState !== "dirty" && state.saveState !== "saving") return;
    event.preventDefault();
    const href = event.currentTarget.href;
    void state.saveNow().finally(() => window.location.assign(href));
  };

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
      const t = e.target instanceof HTMLElement ? e.target : null;
      const typing =
        !!t &&
        (t.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
      const meta = e.metaKey || e.ctrlKey;
      if (e.defaultPrevented || e.isComposing || t?.closest('[role="dialog"], [role="menu"]')) return;
      const key = shortcutKey(e);

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
        // ⇧⌘S — «حفظ باسم» a native `.nsq` file; ⌘S keeps saving to the library.
        if (e.shiftKey) window.dispatchEvent(new CustomEvent(NSQ_SAVE_AS_EVENT));
        else void saveNow();
        return;
      }
      if (meta && key === "o" && !e.shiftKey) {
        e.preventDefault();
        onOpenFile();
        return;
      }
      if (meta && key === "e") {
        e.preventDefault();
        toggle("exportOpen");
        return;
      }
      if (meta && key === "d") {
        if (typing) return;
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (meta && e.altKey && key === "c") {
        if (typing) return;
        e.preventDefault();
        copyStyle();
        return;
      }
      if (meta && e.altKey && key === "v") {
        if (typing) return;
        e.preventDefault();
        pasteStyle();
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
        // ⇧⌘V = لصق في مكانه (paste in place); ⌘V keeps the nudged paste.
        pasteClipboard(e.shiftKey);
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
      if (!typing && !meta && !e.altKey && key === "v") {
        e.preventDefault();
        armTool(null);
        return;
      }
      if (!typing && !meta && !e.altKey && key === "t") {
        e.preventDefault();
        // Both halves of "text tool": show the text tab and arm the drag-to-draw
        // gesture, so a press on the artboard starts typing.
        useEditor.getState().setLeftTab("elements");
        armTool("text");
        return;
      }
      if (!typing && !meta && !e.altKey && key === "r") {
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
      if (!typing && !meta && e.shiftKey && (key === "1" || e.code === "Digit1")) {
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
      if (meta && (key === "+" || key === "=" || e.code === "Equal" || e.code === "NumpadAdd")) {
        e.preventDefault();
        zoomCentered(useEditor.getState().zoom + 0.08);
        return;
      }
      if (meta && (key === "-" || e.code === "Minus" || e.code === "NumpadSubtract")) {
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
    onOpenFile,
    toggle,
    duplicateSelected,
    deleteSelected,
    copySelected,
    pasteClipboard,
    copyStyle,
    pasteStyle,
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

  /**
   * Restore a collapsed desktop panel (optionally straight onto a tab) in one
   * click. `toggle` is the same persisted path the panel's own `>>` uses, so
   * the docked/collapsed choice survives a reload either way.
   */
  const expandPanel = <S extends "left" | "right">(
    side: S,
    tab?: S extends "left" ? LeftTab : RightTab,
  ) => {
    const state = useEditor.getState();
    if (side === "left") {
      if (tab) state.setLeftTab(tab as LeftTab);
      if (state.leftCollapsed) state.toggle("leftCollapsed");
      useEditor.setState({ leftOpen: true });
    } else {
      if (tab) state.setRightTab(tab as RightTab);
      if (state.rightCollapsed) state.toggle("rightCollapsed");
      useEditor.setState({ rightOpen: true });
    }
  };
  /** Toolbar shortcuts to a panel tab: open (and un-collapse) that panel. */
  const openLeftFromDock = (tab: LeftTab) => {
    if (useEditor.getState().focusMode) toggle("focusMode");
    expandPanel("left", tab);
  };
  const openRightFromDock = (tab: RightTab) => {
    if (useEditor.getState().focusMode) toggle("focusMode");
    expandPanel("right", tab);
  };

  const resizePanel = (
    side: "left" | "right",
    startClientX: number,
    startWidth: number,
    handle?: HTMLElement,
  ) => {
    document.body.classList.add("is-resizing-panel");
    /*
     * Tablet drawers float over the canvas, so dragging their edge never
     * reflows the workspace. Dragging past the minimum width slides the
     * drawer out under the finger; releasing beyond the threshold collapses
     * (closes) it, otherwise it springs back.
     */
    const drawer = isOverlayViewport()
      ? handle?.closest<HTMLElement>(".editor-sidebar") ?? null
      : null;
    let overshoot = 0;
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
      if (drawer) {
        overshoot = Math.max(0, PANEL_MIN[side] - (startWidth + delta));
        // The elements drawer sits on the physical right, the properties
        // drawer on the physical left; each slides toward its own edge.
        drawer.style.transition = "none";
        drawer.style.transform = overshoot
          ? `translateX(${side === "left" ? overshoot : -overshoot}px)`
          : "";
      }
    };
    const finish = () => {
      document.body.classList.remove("is-resizing-panel");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (drawer) {
        drawer.style.transition = "";
        drawer.style.transform = "";
        if (overshoot > DRAWER_COLLAPSE_DRAG) {
          useEditor.setState(side === "left" ? { leftOpen: false } : { rightOpen: false });
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const fitToSelection = () => {
    const selected = selectedElements();
    const bounds =
      absoluteBounds(
        activePage.elements,
        selected.map((element) => element.id),
      ) || elementsBounds(selected);
    if (!bounds) return fitToScreen();
    const el = document.querySelector(".editor-canvas-stage");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const activePageEl = document.querySelector<HTMLElement>(
      `.editor-canvas-stage [data-page-id="${CSS.escape(activePage.id)}"]`,
    );
    const pageContent = activePageEl?.closest<HTMLElement>(".page-frame-content");
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
      const target = activePageEl?.querySelector<HTMLElement>(
        `[data-el-id="${CSS.escape(selected[0]?.id || "")}"]`,
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
      dir="rtl"
      className={cn(
        "editor-ui editor-shell grid grid-rows-[auto_minmax(0,1fr)]",
        dark ? "editor-dark" : "editor-light",
        focusMode && "editor-focus",
      )}
    >
      {/*
       * Toolbar — three zones in one logical order at every width.
       *
       *   ① اللوحة: a single scaling cluster (− / % / + / fit / fullscreen),
       *     then history (تراجع/إعادة), then the document tools the author
       *     reaches for every page (نص بالرسم، أدوات التقرير، المكتبة، أضف
       *     مكتبة، عناوين الفقرات، الرئيسية) — each with a single, distinct
       *     home, separated by dividers so nothing cramps.
       *   ② المركز: the document itself — its name in one perfectly centered
       *     capsule with the document view controls (معاينة الصفحات، الشبكة،
       *     ثم قوائم المحاذاة/الترتيب/التحويل/العرض), plus the one primary
       *     utility «ضبط وتنسيق مساحة العمل».
       *   ③ مساحة العمل والحساب: save state, the project-file menu, the
       *     «تصدير» primary action and the account menu.
       *
       * The bar wraps by whole zones on narrow tablets (clusters are
       * `shrink-0`, never split mid-group), and every control grows to a
       * ≥42px hit target on coarse pointers — the strip auto-adjusts its
       * footprint instead of cramping or half-clipping a button.
       */}
      {settingsTab && <EditorSettingsDialog initialTab={settingsTab} onClose={() => setSettingsTab(null)} />}
      <header
        ref={headerRef}
        data-editor-obstacle="header"
        className="editor-toolbar z-[var(--z-panel)] flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-3 py-1.5 pr-[max(0.75rem,var(--safe-right))] pl-[max(0.75rem,var(--safe-left))] pt-[max(0.375rem,var(--safe-top))]"
      >
        {/* ① Canvas scaling, history, and the document tools. */}
        <div className="editor-header-zone">
          <div
            className="editor-zoom-cluster"
            role="group"
            aria-label="مقياس مساحة العمل"
          >
            <button
              type="button"
              className="editor-capsule-btn"
              onClick={() => zoomCentered(zoom - 0.08)}
              title="تصغير المقياس (⌘−)"
              aria-label="تصغير المقياس"
            >
              <Minus className="size-4" />
            </button>
            <button
              type="button"
              className="editor-zoom-readout"
              onClick={() => zoomCentered(1)}
              title="المقياس الحالي — انقر للعودة إلى 100%"
              aria-label="إعادة المقياس إلى مئة بالمئة"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="editor-capsule-btn"
              onClick={() => zoomCentered(zoom + 0.08)}
              title="تكبير المقياس (⌘+)"
              aria-label="تكبير المقياس"
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              className="editor-capsule-btn"
              onClick={fitToScreen}
              title="ملاءمة الصفحة (⌘0)"
              aria-label="ملاءمة الصفحة"
            >
              <Scan className="size-4" />
            </button>
            <button
              type="button"
              className={cn("editor-capsule-btn", isFullscreen && "is-active")}
              onClick={toggleFullscreen}
              title={isFullscreen ? "الخروج من ملء الشاشة" : "ملء الشاشة"}
              aria-label={isFullscreen ? "الخروج من ملء الشاشة" : "ملء الشاشة"}
              aria-pressed={isFullscreen}
            >
              {isFullscreen ? (
                <Minimize className="size-4" />
              ) : (
                <Maximize className="size-4" />
              )}
            </button>
          </div>

          <span className="editor-header-sep" aria-hidden />

          <button
            type="button"
            className="editor-header-btn"
            onClick={undo}
            disabled={past.length <= 1}
            title="تراجع (⌘Z)"
            aria-label="تراجع"
          >
            <Undo2 className="size-4" />
          </button>
          <button
            type="button"
            className="editor-header-btn"
            onClick={redo}
            disabled={!future.length}
            title="إعادة (⌘⇧Z)"
            aria-label="إعادة"
          >
            <Redo2 className="size-4" />
          </button>

          <span className="editor-header-sep" aria-hidden />

          {/*
           * Document/editing tools — one home each: draw a text box straight
           * on the canvas, report tools, the library, add-a-library, the
           * heading generator, and Home. Sidebar/layers/settings gateways
           * live in the unified tool dock instead (no duplicates).
           */}
          <button
            type="button"
            data-tour="text-tool"
            onClick={() => {
              useEditor.setState({
                leftTab: "elements",
                leftOpen: true,
                leftCollapsed: false,
              });
              window.dispatchEvent(new CustomEvent("nasaq:draw-text"));
            }}
            className="editor-header-btn"
            title="إدراج مربع نص — اسحب على الصفحة لتحديد موضعه وحجمه"
            aria-label="إدراج مربع نص"
          >
            <PenLine className="size-4" />
          </button>
          <button
            type="button"
            data-tour="report-tools"
            onClick={() => {
              // Report tools are docked in the RIGHT panel: leave focus mode,
              // open «الخصائص» and expand the section via its own event.
              useEditor.setState({
                focusMode: false,
                rightCollapsed: false,
                rightOpen: true,
                rightTab: "properties",
              });
              window.dispatchEvent(new CustomEvent(OPEN_REPORT_TOOLS_EVENT));
            }}
            className="editor-header-btn"
            title="أدوات التقرير — بطاقات المؤشرات، الختم، الترويسة والتذييل، ومراجعة ما قبل الطباعة"
            aria-label="أدوات التقرير"
          >
            <ClipboardList className="size-4" />
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
            className={cn("editor-header-btn", libraryVisible && "is-active")}
            title={libraryVisible ? "إغلاق المكتبة" : "فتح المكتبة"}
            aria-label={libraryVisible ? "إغلاق المكتبة" : "فتح المكتبة"}
          >
            <Library className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setAddLibraryOpen(true)}
            className="editor-header-btn"
            title="أضف مكتبة — حوّل أي مجلد أو مجموعة ملفات إلى مجلدات بنمط نَسَق"
            aria-label="أضف مكتبة"
          >
            <FolderPlus className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setHeadingGeneratorOpen(true)}
            className="editor-header-btn"
            title="مولد عناوين الفقرات — تصاميم جاهزة وقابلة للتعديل"
            aria-label="مولد عناوين الفقرات"
          >
            <Heading1 className="size-4" />
          </button>
          <a
            href={homeHref}
            onClick={leaveEditor}
            className="editor-header-btn"
            title="العودة إلى الرئيسية"
            aria-label="العودة إلى الرئيسية"
          >
            <Home className="size-4" />
          </a>
        </div>

        {/* ② Document identity + the single primary workspace utility. */}
        <div className="editor-header-zone editor-header-center">
          <div className="editor-doc-capsule">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="اسم المشروع"
              title={name || "مستند جديد"}
              className="editor-doc-name"
              placeholder="مستند جديد"
            />
            <span className="editor-capsule-sep" aria-hidden />
            <button
              type="button"
              onClick={() => toggle("previewAll")}
              className={cn("editor-capsule-btn", previewAll && "is-active")}
              title={
                previewAll ? "معاينة كل الصفحات (مفعّل)" : "معاينة صفحة واحدة"
              }
              aria-label="تبديل معاينة كل الصفحات"
              aria-pressed={previewAll}
            >
              <Eye className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => toggle("showGrid")}
              className={cn("editor-capsule-btn", showGrid && "is-active")}
              title="إظهار / إخفاء الشبكة"
              aria-label="الشبكة"
              aria-pressed={showGrid}
            >
              <Grid3x3 className="size-4" />
            </button>
          </div>
          {/* Document view controls: محاذاة، ترتيب الطبقات، تحويل، عرض. */}
          <ToolbarMenus
            fitToScreen={fitToScreen}
            fitToSelection={fitToSelection}
          />
          <button
            type="button"
            onClick={arrangeWorkspace}
            title="ضبط وتنسيق مساحة العمل — ملاءمة الصفحة وتوسيطها وإعادة اللوحات لأماكنها"
            aria-label="ضبط وتنسيق مساحة العمل"
            className="editor-wand-btn"
          >
            <Wand2 className="size-4" aria-hidden />
            <span>ضبط وتنسيق مساحة العمل</span>
          </button>
        </div>

        {/* ③ Workspace/account + the export action. */}
        <div className="editor-header-zone ms-auto">
          <SaveBadge
            state={saveState}
            label={label}
            onClick={() => void saveNow()}
          />
          <ProjectFileMenu onOpenFile={onOpenFile} />
          <span className="editor-header-sep" aria-hidden />
          <button
            type="button"
            onClick={() => toggle("exportOpen")}
            className="editor-export-btn"
            title="تصدير المشروع (⌘E)"
            aria-label="تصدير"
          >
            <Download className="size-4" />
            تصدير
          </button>
          <EditorAccountMenu />
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
          gridTemplateColumns: !isDesktop
            ? undefined
            : focusMode
              ? "minmax(0, 1fr)"
              : `${leftCollapsed ? "48px" : `minmax(${PANEL_MIN.left}px, min(${panelWidths.left}px, 28vw))`} max-content minmax(360px, 1fr) ${rightDockCollapsed ? "48px" : `minmax(${PANEL_MIN.right}px, min(${panelWidths.right}px, 30vw))`}`,
        }}
      >
        <div
          inert={!isDesktop && !leftOpen}
          data-tour="left-panel"
          className={cn(
            "editor-sidebar relative z-[var(--z-panel)] flex h-full min-h-0 flex-col overflow-hidden",
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
          style={!isDesktop ? { width: `min(${panelWidths.left}px, 86vw)` } : undefined}
        >
          {/*
           * The panel's own header carries its close/collapse control (the
           * `>>` beside the main tabs), so no second chrome row sits above the
           * tabs — that extra row is what pushed the panel's bottom toolbar
           * out of the fixed-height column.
           */}
          <LeftPanel
            onUpload={onUpload}
            onUploadSvg={onUploadSvg}
            onAddCustomAsset={onAddCustomAsset}
          />
          {!leftCollapsed && !focusMode && (
            <PanelResizeHandle
              side="left"
              onStart={(event) =>
                resizePanel("left", event.clientX, panelWidths.left, event.currentTarget)
              }
            />
          )}
        </div>
        {isDesktop && leftCollapsed && !focusMode && (
          <CollapsedPanelDock
            side="left"
            tabs={LEFT_PANEL_TABS}
            activeTab={leftTab}
            onExpand={() => expandPanel("left")}
            onTab={(tab) => expandPanel("left", tab)}
          />
        )}
        {isDesktop && !focusMode && (
          <StudioToolDock
            onOpenLeft={openLeftFromDock}
            onOpenRight={openRightFromDock}
            onUploadImage={() => onUpload("image")}
            onOpenFiles={onOpenFile}
          />
        )}

        <div className="editor-canvas-workspace relative grid min-w-0 min-h-0 grid-rows-[minmax(0,1fr)_auto_auto_auto] overflow-hidden">
          {/*
           * Tapping the canvas dismisses the floating drawers: on a tablet the
           * artwork is what the author wants to see, and reaching for a close
           * chip to do it would be a second, avoidable gesture.
           */}
          <CanvasStage
            onDropImage={onDropImage}
            onCanvasTap={() => (drawerOpen ? closeFloatingPanels() : undefined)}
          />
          {/*
           * Tablet: the toolbar floats inside the canvas row only (an
           * absolutely-positioned grid item placed on row 1), so it can never
           * sit on the page rail, the arrange bar or the status bar, and the
           * canvas keeps its full width.
           */}
          {!isDesktop && !focusMode && (
            <div className="studio-tool-dock-slot">
              <StudioToolDock
                floating
                onOpenLeft={openLeftFromDock}
                onOpenRight={openRightFromDock}
                onUploadImage={() => onUpload("image")}
                onOpenFiles={onOpenFile}
              />
            </div>
          )}
          {/* Launcher chips live in the canvas row too (grid row 1 / 2), so they
               sit above the page rail instead of guessing its height. */}
          {!(leftOpen || rightOpen) && (
            <div className="editor-launcher-slot flex lg2:hidden">
              <button
                type="button"
                onClick={() => toggle("leftOpen")}
                className="pointer-events-auto h-11 rounded-full bg-navy px-4 text-[12px] font-extrabold text-white shadow-lg shadow-navy/25"
              >
                عناصر
              </button>
              <button
                type="button"
                onClick={() => addPage()}
                className="pointer-events-auto h-11 rounded-full bg-navy px-4 text-[12px] font-extrabold text-white shadow-lg shadow-navy/25"
              >
                صفحة
              </button>
              <button
                type="button"
                onClick={() => toggle("rightOpen")}
                className="pointer-events-auto h-11 rounded-full bg-navy px-4 text-[12px] font-extrabold text-white shadow-lg shadow-navy/25"
              >
                خصائص
              </button>
            </div>
          )}
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

        {isDesktop && rightDockCollapsed && !focusMode && (
          <CollapsedPanelDock
            side="right"
            tabs={RIGHT_PANEL_TABS}
            activeTab={rightTab}
            onExpand={() => expandPanel("right")}
            onTab={(tab) => expandPanel("right", tab)}
          />
        )}
        {touchProperties ? (
          <TouchPropertiesSheet open={rightOpen && !focusMode} onClose={() => useEditor.setState({ rightOpen: false })}>
            <RightPanel onReplaceImage={onReplaceImage} />
          </TouchPropertiesSheet>
        ) : (
          <div
            inert={!isDesktop && !rightOpen}
            className={cn(
              "editor-sidebar editor-properties relative z-[var(--z-panel)] flex h-full min-h-0 flex-col overflow-hidden",
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
            style={!isDesktop ? { width: `min(${panelWidths.right}px, 90vw)` } : undefined}
          >
            <RightPanel onReplaceImage={onReplaceImage} />
            {!rightCollapsed && !focusMode && (
              <PanelResizeHandle
                side="right"
                onStart={(event) =>
                  resizePanel("right", event.clientX, panelWidths.right, event.currentTarget)
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
      ? "bg-danger/10 text-error"
      : state === "dirty" || state === "saving"
        ? "text-muted"
        : "text-success";
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} (⌘S)`}
      className={cn(
        // Same 36px control as the rest of the strip; the state lives in the
        // icon and colour, the full label in the tooltip.
        "grid size-9 shrink-0 place-items-center rounded-[8px] transition hover:bg-line-2",
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
