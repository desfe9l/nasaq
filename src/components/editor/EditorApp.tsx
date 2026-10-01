import { subscribeTheme } from "@/lib/theme";
import { shortcutKey } from "@/lib/editor/keyboard";
import { EditorSettingsDialog } from "./EditorSettingsDialog";
import { OPEN_EDITOR_SETTINGS_EVENT } from "@/lib/editor/ui-state";
import { FloatingPanel } from "./ui/FloatingPanel";
import { IconButton } from "./ui/IconButton";
import { ViewMenu } from "./ViewMenu";

import { useCallback, useEffect, useRef, useState } from "react";

/* ── The six independent windows ─────────────────────────────────────────────
 * Each editor list is its own floating window (its own open flag, rectangle and
 * dock side). The shell renders them as high-z absolute overlays over the
 * workspace row; when one is docked to a screen edge the row switches to a grid
 * and RESERVES a track for it, so the canvas shrinks instead of being covered.
 */
type PanelId =
  | "library"
  | "tools"
  | "elements"
  | "properties"
  | "layers"
  | "report";

const PANEL_IDS: readonly PanelId[] = [
  "library",
  "tools",
  "elements",
  "properties",
  "layers",
  "report",
];

/** Docked strip bounds (px) — shared by the drag handlers and the defaults. */
const DOCK_MIN_W = 264;
const DOCK_MIN_H = 200;

/**
 * Kept for external scripts/anchors. «أدوات التقرير» is now its own window;
 * the toolbar button opens it directly via the store.
 */
export const OPEN_REPORT_TOOLS_EVENT = "nasaq:open-report-tools";
import {
  Check,
  Download,
  Library,
  Minus,
  Plus,
  Redo2,
  Save,
  Scan,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { ThemedToaster } from "@/components/ui/ThemedToaster";
import {
  useEditor,
  saveLabel,
  writeDraftSnapshot,
  PAGES_PANEL_MIN,
  type LeftTab,
  type RightTab,
} from "@/lib/editor/store";
import { absoluteBounds, elementsBounds, pageSize } from "@/lib/editor/model";
import { fitImageBox, prepareImage } from "@/lib/editor/images";
import { zoomAnchoredAt } from "@/lib/editor/viewport";
import { clampZoom, stepZoom } from "@/lib/editor/document-space";
import {
  canvasViewport,
  visiblePageRect,
  insertionPage,
} from "@/lib/editor/canvas-space";
import { mmToPx } from "@/lib/editor/render-units";
import { useInteraction } from "@/lib/editor/interaction-store";
import { findElement } from "@/lib/editor/model";
import { LeftPanel, ElementToolsWindow } from "./LeftPanel";
import { PropertiesPanel, LayersPanel } from "./RightPanel";
import { AssetLibrary } from "./AssetLibrary";
import { ReportToolsPanel } from "./ReportToolsPanel";
import { AddMenu } from "./AddMenu";
import { CanvasStage } from "./CanvasStage";
import { PageRail } from "./PageRail";
import { ExportDialog } from "./ExportDialog";
import { cn } from "@/lib/utils";
import { EditorWorkspaceSkeleton } from "@/components/ui/Skeleton";
import { WorkspaceOverlays, WorkspaceStatusBar } from "./WorkspaceOverlays";
import { EditorAccountMenu } from "./EditorAccountMenu";
import {
  OVERLAY_BREAKPOINT,
  isOverlayViewport,
  clampDockSize,
  PAGES_RAIL_COLLAPSED,
  type DockSide,
} from "@/lib/editor/ui-state";
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
  /** ?showcase=1 (live product preview on the site): hide the account surface. */
  const showcase = useEditor((s) => s.showcase);
  const setEntitlements = useEditor((s) => s.setEntitlements);
  const { user } = useCurrentUserState();
  const {
    entitlements,
    hasLicense,
    isAdmin,
    isSuspended,
    isLoading: licenseLoading,
  } = useLicense(user?.id, user?.primaryEmail);
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
    pageId?: string;
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
    if (!licenseLoading) setEntitlements(entitlements);
  }, [entitlements, licenseLoading, setEntitlements]);

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
  const ingestImage = async (
    file: File,
    at?: { x: number; y: number; pageId: string },
  ) => {
    const api = useEditor.getState();
    const intent = at ? { type: "image" as const } : imageIntent.current;
    const requestedPage = at?.pageId || ("pageId" in intent && intent.pageId);
    const targetPage = requestedPage
      ? api.pages.find((page) => page.id === requestedPage)
      : insertionPage(
          document.querySelector<HTMLElement>(".editor-canvas-stage"),
          api.pages,
          api.activePageId,
        );
    if (!targetPage) return;
    const pageId = targetPage.id;
    const visible = targetPage
      ? visiblePageRect(
          document.querySelector<HTMLElement>(".editor-canvas-stage"),
          targetPage,
        )
      : null;
    const size = pageSize(targetPage);
    const center =
      at ||
      (visible
        ? { x: visible.x + visible.w / 2, y: visible.y + visible.h / 2 }
        : { x: size.w / 2, y: size.h / 2 });
    try {
      const img = await prepareImage(file);
      const kind = intent.type === "logo" ? "logo" : "image";

      if (intent.type === "replace" && intent.targetId) {
        // Swapping the source keeps the author's box, rotation, and effects.
        const page = useEditor.getState().pages.find((p) => p.id === pageId);
        const el = page && findElement(page.elements, intent.targetId)?.el;
        if (el && !el.locked && !page?.locked)
          api.applyElements(pageId, [
            { ...el, src: img.src, style: { ...el.style, crop: undefined } },
          ]);
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
        const box = fitImageBox(img, {
          w: Math.min(max.w, size.w),
          h: Math.min(max.h, size.h),
        });
        api.addElementAt(
          kind,
          {
            src: img.src,
            name: kind === "logo" ? "شعار" : "صورة",
            w: box.w,
            h: box.h,
          },
          center,
          pageId,
        );
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
    imageIntent.current = {
      type: "replace",
      targetId: id,
      pageId: useEditor.getState().activePageId,
    };
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

      {!showcase && <NsqIntake />}

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
          const state = useEditor.getState();
          const stage = document.querySelector<HTMLElement>(
            ".editor-canvas-stage",
          );
          const targetPage = insertionPage(
            stage,
            state.pages,
            state.activePageId,
          );
          if (!targetPage) return;
          const visible = visiblePageRect(stage, targetPage),
            size = pageSize(targetPage);
          const center = {
            x: visible ? visible.x + visible.w / 2 : size.w / 2,
            y: visible ? visible.y + visible.h / 2 : size.h / 2,
          };
          const reader = new FileReader();
          reader.onload = () => {
            const markup = String(reader.result || "");
            if (!markup.includes("<svg")) {
              toast.error("الملف ليس رسم SVG صالحًا");
              return;
            }
            useEditor.getState().addElementAt(
              "svg",
              {
                content: markup,
                name:
                  file.name.replace(/\.svg$/i, "").slice(0, 30) || "رسم SVG",
              },
              center,
              targetPage.id,
            );
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
  onDropImage: (
    file: File,
    at?: { x: number; y: number; pageId: string },
  ) => Promise<void>;
  onUploadSvg: () => void;
  onAddCustomAsset: (kind: "icon" | "divider") => void;
  /** Where «الرئيسية» leads: the licensed Home, or the site for everyone else. */
  homeHref: string;
}) {
  const name = useEditor((s) => s.name);
  const setName = useEditor((s) => s.setName);
  const zoom = useEditor((s) => s.zoom);
  const selectionIdentity = useEditor((s) => s.selectedIds.join(" "));
  useEffect(() => {
    // Selection owns the next surface; stale global drawers/paint sessions yield.
    window.dispatchEvent(new Event("nasaq:selection-ui-reset"));
  }, [selectionIdentity]);
  const cropActive = useInteraction((s) => s.crop !== null);
  const setZoom = useEditor((s) => s.setZoom);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  /*
   * Primitive lengths, never the arrays: `past` re-renders the whole shell on
   * every history push, `past.length` only when the depth actually changes.
   */
  const pastDepth = useEditor((s) => s.past.length);
  const futureDepth = useEditor((s) => s.future.length);
  const [settingsTab, setSettingsTab] = useState<"editor" | "account" | null>(
    null,
  );
  useEffect(() => {
    const openSettings = (event: Event) =>
      setSettingsTab(
        (event as CustomEvent).detail === "account" ? "account" : "editor",
      );
    window.addEventListener(OPEN_EDITOR_SETTINGS_EVENT, openSettings);
    return () =>
      window.removeEventListener(OPEN_EDITOR_SETTINGS_EVENT, openSettings);
  }, []);
  const appearance = useEditor((s) => s.appearance);
  useEffect(
    () =>
      subscribeTheme((value) =>
        useEditor.setState({ appearance: value }),
      ),
    [],
  );
  const toggle = useEditor((s) => s.toggle);
  const focusMode = useEditor((s) => s.focusMode);
  const leftOpen = useEditor((s) => s.leftOpen);
  const rightOpen = useEditor((s) => s.rightOpen);
  // The split windows: each list has its own open flag (persisted).
  const layersOpenFlag = useEditor((s) => s.layersOpen);
  const reportOpenFlag = useEditor((s) => s.reportToolsOpen);
  const libraryOpenFlag = useEditor((s) => s.libraryOpen);
  const toolsOpenFlag = useEditor((s) => s.toolsOpen);
  const pagesRailHidden = useEditor((s) => s.pagesRailHidden);
  const leftOpenFlag = leftOpen;
  const rightOpenFlag = rightOpen;
  const closeFloatingPanels = useEditor((s) => s.closeFloatingPanels);
  const pagesPanelHeight = useEditor((s) => s.pagesPanelHeight);
  const pagesRailCollapsed = useEditor((s) => s.pagesRailCollapsed);
  const setPagesPanelHeight = useEditor((s) => s.setPagesPanelHeight);
  const contextMenu = useEditor((s) => s.contextMenu);
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
  const nudgeSelection = useEditor((s) => s.nudgeSelection);
  const saveNow = useEditor((s) => s.saveNow);
  const group = useEditor((s) => s.group);
  const ungroup = useEditor((s) => s.ungroup);
  const selectAll = useEditor((s) => s.selectAll);
  const enterGroup = useEditor((s) => s.enterGroup);
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
  /**
   * Phone width. The bar drops to two deliberate rows there and the scaling
   * cluster moves into «عرض», so history, export and the account control can
   * never be pushed off screen by a zoom stepper.
   */
  const [isCompact, setIsCompact] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 600px)").matches,
  );
  /** First load is what arms the auto-fit below. */
  const hydrated = useEditor((s) => s.hydrated);
  /** ?showcase=1: no walkthrough, no account menu in the product preview. */
  const showcase = useEditor((s) => s.showcase);
  /** «أضف مكتبة» and «مولد عناوين الفقرات» are modal, so they own no store state. */
  const [addLibraryOpen, setAddLibraryOpen] = useState(false);
  const [libraryFolderRequest, setLibraryFolderRequest] = useState(0);
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

  useEffect(() => {
    const compact = window.matchMedia("(max-width: 600px)");
    const onCompact = () => setIsCompact(compact.matches);
    onCompact();
    compact.addEventListener("change", onCompact);
    return () => compact.removeEventListener("change", onCompact);
  }, []);

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

  /** Latest `fitToScreen`, for the layout effect that must not re-subscribe. */
  const fitRef = useRef<() => void>(() => {});

  /**
   * ملاءمة الصفحة / عرض الصفحة بالكامل: pick a zoom that fits the WHOLE
   * artboard (all four edges inside the viewport) and then centre it, so Fit
   * never lands on a smaller view of wherever the author had scrolled to.
   */
  const fitToScreen = useCallback(() => {
    // Read the LIVE document, never a render-time snapshot: fits can be
    // triggered by effects and events that outlive the last render.
    const state = useEditor.getState();
    const activePage =
      state.pages.find((p) => p.id === state.activePageId) || state.pages[0];
    if (!activePage) return setZoom(0.82);
    const activeSize = pageSize(activePage);
    const el = document.querySelector<HTMLElement>(".editor-canvas-stage");
    if (!el) return setZoom(0.82);
    const rect = canvasViewport(el, activeSize);
    // Measure the ACTIVE artboard, not whichever page happens to be first in
    // the all-pages preview — the fit must always bring the page being edited
    // into view, and pages may carry different sizes.
    const pageEl = document.querySelector<HTMLElement>(
      `.editor-canvas-stage [data-page-id="${CSS.escape(activePage.id)}"]`,
    );
    const pagePxW = mmToPx(activeSize.w);
    const pagePxH = mmToPx(activeSize.h);
    const padding = 16;
    const next = Math.min(
      Math.max(0, rect.width - padding * 2) / pagePxW,
      Math.max(0, rect.height - padding * 2 - 36) / pagePxH,
    );
    setZoom(clampZoom(next));
    requestAnimationFrame(() => {
      const stage = document.querySelector<HTMLElement>(".editor-canvas-stage");
      const pageEl2 = stage?.querySelector<HTMLElement>(
        `[data-page-id="${CSS.escape(activePage.id)}"]`,
      );
      if (!stage || !pageEl2) return;
      const sr = canvasViewport(stage, activeSize);
      const pr = (
        pageEl2.closest(".artboard-cell") ?? pageEl2
      ).getBoundingClientRect();
      stage.scrollLeft += pr.left + pr.width / 2 - (sr.left + sr.width / 2);
      stage.scrollTop += pr.top + pr.height / 2 - (sr.top + sr.height / 2);
    });
  }, [setZoom]);
  fitRef.current = fitToScreen;

  useEffect(() => {
    const onFitPage = () => fitRef.current();
    window.addEventListener("nasaq:fit-page", onFitPage);
    return () => window.removeEventListener("nasaq:fit-page", onFitPage);
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
    const assignedId =
      lastFitProjectRef.current === "" &&
      lastFitFirstPageRef.current === firstPageId;
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
      if (!stage) return setZoom(clampZoom(next));
      const r = canvasViewport(stage);
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
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    const state = useEditor.getState();
    if (state.saveState !== "dirty" && state.saveState !== "saving") return;
    event.preventDefault();
    const href = event.currentTarget.href;
    void state.saveNow().finally(() => window.location.assign(href));
  };

  /*
   * Flush pending work when the tab is hidden, closed or reloaded mid-edit.
   *
   * `beforeunload`/`pagehide` handlers cannot wait for promises: the async
   * IndexedDB save may lose the race with the teardown. So the unload path
   * ALSO writes a synchronous, owner-stamped draft of the open document; the
   * next hydrate recovers it when it is newer than the stored row. That is
   * what makes an accidental ⌘R non-destructive even inside the debounce
   * window. `visibilitychange` (tab switch, iPad app switch) keeps the
   * ordinary async flush for the common cases.
   */
  useEffect(() => {
    const flush = () => {
      const state = useEditor.getState();
      if (state.saveState === "dirty") void saveNow();
    };
    const flushSync = () => {
      const state = useEditor.getState();
      if (state.saveState === "dirty" || state.saveState === "saving")
        writeDraftSnapshot();
      flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushSync();
    };
    window.addEventListener("beforeunload", flushSync);
    window.addEventListener("pagehide", flushSync);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      flushSync();
      window.removeEventListener("beforeunload", flushSync);
      window.removeEventListener("pagehide", flushSync);
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
      if (
        e.defaultPrevented ||
        e.isComposing ||
        t?.closest('[role="dialog"], [role="menu"]')
      )
        return;
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
        if (e.shiftKey)
          window.dispatchEvent(new CustomEvent(NSQ_SAVE_AS_EVENT));
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
      if (
        !typing &&
        !meta &&
        e.shiftKey &&
        (key === "1" || e.code === "Digit1")
      ) {
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
      if (
        meta &&
        (key === "+" ||
          key === "=" ||
          e.code === "Equal" ||
          e.code === "NumpadAdd")
      ) {
        e.preventDefault();
        zoomCentered(stepZoom(useEditor.getState().zoom, 1));
        return;
      }
      if (
        meta &&
        (key === "-" || e.code === "Minus" || e.code === "NumpadSubtract")
      ) {
        e.preventDefault();
        zoomCentered(stepZoom(useEditor.getState().zoom, -1));
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
        anyWindowOpen()
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
        if (useEditor.getState().enteredGroupId) enterGroup(null);
        else select(null);
        return;
      }
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) &&
        useEditor.getState().selectedIds.length
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : e.altKey ? 0.5 : 1;
        const dx =
          e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
        const dy =
          e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
        // The whole selection moves as ONE undoable store write (the old path
        // wrote per element and re-rendered the editor N times per keypress).
        nudgeSelection(dx, dy);
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
    nudgeSelection,
    fitToScreen,
    zoomCentered,
    setZoom,
    group,
    ungroup,
    bring,
    selectAll,
    enterGroup,
    isDesktop,
    closeFloatingPanels,
  ]);

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
  /**
   * Window registry. The six lists are independent windows; their open flags
   * live in the store (persisted), their rectangles in each window's own
   * localStorage slot, and their dock sides in the shell below.
   */
  const PANEL_DEFS: Record<
    PanelId,
    {
      title: string;
      side: "left" | "right";
      defaultSize: { width: number; height: number };
      minSize: { width: number; height: number };
      /** Stagger so several first-open windows fan out instead of stacking. */
      spawnShift: number;
    }
  > = {
    // المكتبة — the asset shelf.
    library: {
      title: "المكتبة",
      side: "left",
      defaultSize: { width: 420, height: 520 },
      minSize: { width: 340, height: 240 },
      spawnShift: 0,
    },
    // أدوات العناصر — the smart library. WIDER default on purpose: its 4-column
    // card grids clip badly below ~420px, and the window is fully resizable.
    tools: {
      title: "أدوات العناصر",
      side: "left",
      defaultSize: { width: 480, height: 560 },
      minSize: { width: 380, height: 260 },
      spawnShift: 28,
    },
    elements: {
      title: "لوحة العناصر",
      side: "left",
      defaultSize: { width: 380, height: 560 },
      minSize: { width: 300, height: 240 },
      spawnShift: 56,
    },
    properties: {
      title: "الخصائص",
      side: "right",
      defaultSize: { width: 340, height: 560 },
      minSize: { width: 280, height: 240 },
      spawnShift: 0,
    },
    layers: {
      title: "الطبقات",
      side: "right",
      defaultSize: { width: 320, height: 480 },
      minSize: { width: 260, height: 200 },
      spawnShift: 28,
    },
    report: {
      title: "أدوات التقرير",
      side: "right",
      defaultSize: { width: 400, height: 520 },
      minSize: { width: 320, height: 240 },
      spawnShift: 56,
    },
  };

  const panelOpen: Record<PanelId, boolean> = {
    library: libraryOpenFlag,
    tools: toolsOpenFlag,
    elements: leftOpenFlag,
    properties: rightOpenFlag,
    layers: layersOpenFlag,
    report: reportOpenFlag,
  };

  // Live read (not the render-scoped flags): the keyboard effect outlives
  // renders, and a stale flag would keep Escape from dismissing the drawers.
  const anyWindowOpen = () => {
    const s = useEditor.getState();
    return (
      s.leftOpen ||
      s.rightOpen ||
      s.layersOpen ||
      s.reportToolsOpen ||
      s.libraryOpen ||
      s.toolsOpen
    );
  };

  const setPanelOpenFlag = (id: PanelId, open: boolean) => {
    switch (id) {
      case "library":
        useEditor.setState({ libraryOpen: open });
        break;
      case "tools":
        useEditor.setState({ toolsOpen: open });
        break;
      case "elements":
        useEditor.setState({
          leftOpen: open,
          ...(open ? { leftCollapsed: false } : {}),
        });
        break;
      case "properties":
        useEditor.setState({
          rightOpen: open,
          ...(open ? { rightCollapsed: false } : {}),
        });
        break;
      case "layers":
        useEditor.setState({ layersOpen: open });
        break;
      case "report":
        useEditor.setState({ reportToolsOpen: open });
        break;
    }
  };

  /* ── Docking (per-window, per-edge) ─────────────────────────────────────
   * One window per screen edge. Docking reserves a grid track (the canvas
   * shrinks, never gets covered); undocking gives the space back. The dock
   * side and the strip size are remembered per window.
   */
  const [dockSides, setDockSides] = useState<Partial<Record<PanelId, DockSide>>>(
    () => {
      try {
        return JSON.parse(
          localStorage.getItem("nasaq.panel.docks.v2") || "{}",
        ) as Partial<Record<PanelId, DockSide>>;
      } catch {
        return {};
      }
    },
  );
  const [dockSizes, setDockSizes] = useState<
    Partial<Record<PanelId, { w: number; h: number }>>
  >(() => {
    try {
      return JSON.parse(
        localStorage.getItem("nasaq.panel.dock-sizes.v2") || "{}",
      ) as Partial<Record<PanelId, { w: number; h: number }>>;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("nasaq.panel.docks.v2", JSON.stringify(dockSides));
    } catch {
      /* the layout stays available for this session */
    }
  }, [dockSides]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "nasaq.panel.dock-sizes.v2",
        JSON.stringify(dockSizes),
      );
    } catch {
      /* the layout stays available for this session */
    }
  }, [dockSizes]);

  const changeDockSide = (id: PanelId, side: DockSide | null) => {
    const next: Partial<Record<PanelId, DockSide>> = { ...dockSides };
    if (!side) {
      delete next[id];
    } else {
      // One window per edge: the previous occupant returns to floating.
      for (const other of PANEL_IDS)
        if (other !== id && next[other] === side) delete next[other];
      next[id] = side;
      // Seed the strip size from the window's last floating rectangle so the
      // docked size is the one the author was actually using.
      setDockSizes((sizes) => {
        if (sizes[id]) return sizes;
        let stored: { width: number; height: number } | null = null;
        try {
          stored = JSON.parse(
            localStorage.getItem(`nasaq.panel.${id}.pos.v2`) || "null",
          );
        } catch {
          stored = null;
        }
        if (side === "left" || side === "right") {
          return {
            ...sizes,
            [id]: {
              w: clampDockSize(stored?.width ?? PANEL_DEFS[id].defaultSize.width, window.innerWidth, DOCK_MIN_W),
              h: 0,
            },
          };
        }
        return {
          ...sizes,
          [id]: {
            w: 0,
            h: clampDockSize(stored?.height ?? PANEL_DEFS[id].defaultSize.height, window.innerHeight, DOCK_MIN_H),
          },
        };
      });
    }
    setDockSides(next);
  };

  /** Viewport size, re-rendered on resize so dock clamps track the screen. */
  const [vp, setVp] = useState({
    w: typeof window === "undefined" ? 1440 : window.innerWidth,
    h: typeof window === "undefined" ? 900 : window.innerHeight,
  });
  useEffect(() => {
    const onResize = () =>
      setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /** Which window (if any) currently occupies each screen edge. */
  const dockedBySide: Partial<Record<DockSide, PanelId>> = {};
  if (isDesktop && !focusMode && !cropActive) {
    for (const id of PANEL_IDS) {
      const side = dockSides[id];
      if (side && panelOpen[id]) dockedBySide[side] = id;
    }
  }
  const visibleDock = (id: PanelId): boolean =>
    isDesktop &&
    !focusMode &&
    !cropActive &&
    Boolean(dockSides[id]) &&
    panelOpen[id];

  /*
   * A fingerprint of the docked layout. When it changes (a window docks,
   * undocks, or swaps edges) the canvas gains or loses a track, so the shell
   * re-fits the artboard to the new space — the same refit the tablet
   * boundary triggers.
   */
  const dockSignature = PANEL_IDS.map((id) =>
    visibleDock(id) ? `${id}:${dockSides[id]}` : id,
  ).join("|");

  /** Docked strip length for a window (clamped so the canvas keeps its share). */
  const dockW = (id: PanelId) =>
    clampDockSize(
      dockSizes[id]?.w || PANEL_DEFS[id].defaultSize.width,
      vp.w,
      DOCK_MIN_W,
    );
  const dockH = (id: PanelId) =>
    clampDockSize(
      dockSizes[id]?.h || PANEL_DEFS[id].defaultSize.height,
      vp.h,
      DOCK_MIN_H,
    );

  /*
   * The workspace grid. In this RTL shell the FIRST column sits on the
   * physical RIGHT edge, so a right-docked window is column 1 and a
   * left-docked one the last column. Rows are physical: top dock = row 1,
   * bottom dock = last row. With nothing docked it is a single full-width
   * track and the canvas owns the whole workspace.
   */
  const workspaceCols: string[] = [];
  if (dockedBySide.right) workspaceCols.push(`${dockW(dockedBySide.right)}px`);
  workspaceCols.push("minmax(0, 1fr)");
  if (dockedBySide.left) workspaceCols.push(`${dockW(dockedBySide.left)}px`);
  const workspaceRows: string[] = [];
  if (dockedBySide.top) workspaceRows.push(`${dockH(dockedBySide.top)}px`);
  workspaceRows.push("minmax(0, 1fr)");
  if (dockedBySide.bottom)
    workspaceRows.push(`${dockH(dockedBySide.bottom)}px`);
  const centerArea = {
    gridRow: dockedBySide.top ? 2 : 1,
    gridColumn: dockedBySide.right ? 2 : 1,
  };

  const dockArea = (side: DockSide): React.CSSProperties => {
    if (side === "top")
      return { gridRow: 1, gridColumn: "1 / -1", width: "100%", height: "100%" };
    if (side === "bottom")
      return {
        gridRow: workspaceRows.length,
        gridColumn: "1 / -1",
        width: "100%",
        height: "100%",
      };
    if (side === "left")
      return {
        gridRow: dockedBySide.top ? 2 : 1,
        gridColumn: workspaceCols.length,
        width: "100%",
        height: "100%",
      };
    // Right dock: in this RTL grid the FIRST column is the physical right
    // edge, so the right-docked window owns column 1 and the canvas sits in
    // column 2 (see `centerArea`).
    return {
      gridRow: dockedBySide.top ? 2 : 1,
      gridColumn: 1,
      width: "100%",
      height: "100%",
    };
  };

  /** Drag a docked strip's inner edge to resize the docked window live. */
  const startDockResize = (
    id: PanelId,
    side: DockSide,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    document.body.classList.add("is-resizing-panel");
    const horizontal = side === "left" || side === "right";
    const start = horizontal ? event.clientX : event.clientY;
    const size = horizontal
      ? dockSizes[id]?.w || PANEL_DEFS[id].defaultSize.width
      : dockSizes[id]?.h || PANEL_DEFS[id].defaultSize.height;
    const axis = horizontal ? window.innerWidth : window.innerHeight;
    const min = horizontal ? DOCK_MIN_W : DOCK_MIN_H;
    // The strip sits on the panel's canvas-facing edge: dragging it AWAY from
    // the screen edge (left dock → pointer right, right dock → pointer left,
    // top → down, bottom → up) widens the panel and shrinks the canvas.
    const grow = side === "left" || side === "top";
    const move = (ev: PointerEvent) => {
      const pos = horizontal ? ev.clientX : ev.clientY;
      const delta = grow ? pos - start : start - pos;
      setDockSizes((sizes) =>
        horizontal
          ? { ...sizes, [id]: { ...(sizes[id] ?? { w: 0, h: 0 }), w: clampDockSize(size + delta, axis, min) } }
          : { ...sizes, [id]: { ...(sizes[id] ?? { w: 0, h: 0 }), h: clampDockSize(size + delta, axis, min) } },
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

  /** One docked window: the window fills its grid track + an inner-edge strip. */
  const renderDockedWindow = (id: PanelId, side: DockSide) => {
    const stripSide =
      side === "left" ? "right" : side === "right" ? "left" : undefined;
    return (
      <div
        key={id}
        className="editor-dock-cell relative min-h-0 min-w-0"
        style={dockArea(side)}
      >
        <FloatingPanel
          storageKey={`nasaq.panel.${id}`}
          title={PANEL_DEFS[id].title}
          side={PANEL_DEFS[id].side}
          open
          onClose={() => setPanelOpenFlag(id, false)}
          dockSide={side}
          onDockSideChange={(next) => changeDockSide(id, next)}
          gridAreaStyle={{ width: "100%", height: "100%" }}
        >
          {renderPanelBody(id)}
        </FloatingPanel>
        {stripSide && (
          <div
            className={cn(
              "editor-dock-strip",
              stripSide === "left"
                ? "editor-dock-strip-left"
                : "editor-dock-strip-right",
            )}
            role="separator"
            aria-orientation="vertical"
            aria-label={`تغيير عرض ${PANEL_DEFS[id].title} المثبتة — اسحب`}
            title="اسحب لتغيير عرض النافذة المثبتة"
            onPointerDown={(event) => startDockResize(id, side, event)}
          />
        )}
        {stripSide === undefined && (
          <div
            className={cn(
              "editor-dock-strip",
              side === "top"
                ? "editor-dock-strip-bottom"
                : "editor-dock-strip-top",
            )}
            role="separator"
            aria-orientation="horizontal"
            aria-label={`تغيير ارتفاع ${PANEL_DEFS[id].title} المثبتة — اسحب`}
            title="اسحب لتغيير ارتفاع النافذة المثبتة"
            onPointerDown={(event) => startDockResize(id, side, event)}
          />
        )}
      </div>
    );
  };

  const renderPanelBody = (id: PanelId) => {
    switch (id) {
      case "library":
        return (
          <div className="editor-pane-scroll editor-panel-body no-bottom-pad h-full p-3">
            <AssetLibrary createFolderRequest={libraryFolderRequest} />
          </div>
        );
      case "tools":
        return (
          <ElementToolsWindow
            onAddCustomAsset={onAddCustomAsset}
            onOpenShapes={() => useEditor.getState().setLeftTab("shapes")}
            onOpenTemplates={() => useEditor.getState().setLeftTab("templates")}
          />
        );
      case "elements":
        return (
          <LeftPanel onUpload={onUpload} onUploadSvg={onUploadSvg} />
        );
      case "properties":
        return <PropertiesPanel onReplaceImage={onReplaceImage} />;
      case "layers":
        return <LayersPanel />;
      case "report":
        return (
          <div className="editor-pane-scroll editor-panel-body no-bottom-pad h-full p-3">
            <ReportToolsPanel />
          </div>
        );
    }
  };

  /**
   * Restore a collapsed desktop panel (optionally straight onto a tab) in one
   * click. Windows are independent now: opening one never closes the others.
   */
  const expandPanel = (
    side: "left" | "right",
    tab?: LeftTab | RightTab,
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
  const openLeftTab = (tab: LeftTab) => {
    if (useEditor.getState().focusMode) toggle("focusMode");
    // setLeftTab routes «library»/«tools» to their own windows.
    useEditor.getState().setLeftTab(tab);
    if (tab === "library" || tab === "tools") return;
    expandPanel("left", tab);
  };
  const requestLibraryFolder = () => {
    openLeftTab("library");
    setLibraryFolderRequest((request) => request + 1);
  };
  /**
   * «أدوات التقرير» is its OWN window since the split: opening it simply
   * raises that window, which can sit beside properties and layers.
   */
  const openReportTools = () => {
    useEditor.setState({ focusMode: false, reportToolsOpen: true });
  };

  const fitToSelection = () => {
    const state = useEditor.getState();
    const activePage =
      state.pages.find((p) => p.id === state.activePageId) || state.pages[0];
    if (!activePage) return;
    const activeSize = pageSize(activePage);
    const selected = state.selectedElements();
    const bounds =
      absoluteBounds(
        activePage.elements,
        selected.map((element) => element.id),
      ) || elementsBounds(selected);
    if (!bounds) return fitToScreen();
    const stage = document.querySelector<HTMLElement>(".editor-canvas-stage");
    if (!stage) return;
    const view = canvasViewport(stage);
    const next = Math.min(
      (view.width - 40) / mmToPx(bounds.w),
      (view.height - 40) / mmToPx(bounds.h),
    );
    setZoom(clampZoom(next));
    requestAnimationFrame(() => {
      const page = stage.querySelector<HTMLElement>(
        `[data-page-id="${CSS.escape(activePage.id)}"]`,
      );
      if (!page) return;
      const rect = page.getBoundingClientRect();
      const viewport = canvasViewport(stage);
      stage.scrollLeft +=
        rect.left +
        ((bounds.x + bounds.w / 2) / activeSize.w) * rect.width -
        (viewport.left + viewport.width / 2);
      stage.scrollTop +=
        rect.top +
        ((bounds.y + bounds.h / 2) / activeSize.h) * rect.height -
        (viewport.top + viewport.height / 2);
    });
  };

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
        if (stage && page) {
          const viewport = canvasViewport(stage);
          const bounds = (
            page.closest(".artboard-cell") ?? page
          ).getBoundingClientRect();
          if (
            bounds.width <= viewport.width - 32 &&
            bounds.height <= viewport.height - 32
          ) {
            stage.scrollLeft +=
              bounds.left +
              bounds.width / 2 -
              (viewport.left + viewport.width / 2);
            stage.scrollTop +=
              bounds.top +
              bounds.height / 2 -
              (viewport.top + viewport.height / 2);
            return;
          }
        }
      }
      fitRef.current();
    }, 60);
    return () => clearTimeout(timer);
  }, [isDesktop, hydrated, dockSignature]);

  return (
    /*
     * Editor shell.
     *
     * Rows are `auto` (header) + `minmax(0,1fr)` (workspace), so the single
     * header line never steals height from the canvas — not even on a phone,
     * where it folds to two deliberate rows of its own.
     */
    <div
      dir="rtl"
      className={cn(
        "editor-ui editor-shell grid grid-rows-[auto_minmax(0,1fr)]",
        appearance === "light" ? "editor-light" : "editor-dark",
        appearance === "dim" && "editor-dim",
        focusMode && "editor-focus",
      )}
    >
      {/*
       * Toolbar — three zones, icon-first, one line at every width.
       *
       * The canvas is the product, so the bar keeps only what belongs to the
       * DOCUMENT: history, the scaling cluster, the document name, and the
       * document actions (view options, save, project file, export, account).
       *
       * Insert actions stay in «إضافة»; zoom, appearance and panel controls are
       * in «عرض». Selection-only actions stay in the contextual toolbar and
       * context menu, not in permanent Properties rows.
       *
       * Every control is an `IconButton`: same box, same icon size, same
       * tooltip (hover on pointer devices, long-press on touch), no labels to
       * re-read on every visit.
       */}
      {settingsTab && (
        <EditorSettingsDialog
          initialTab={settingsTab}
          onClose={() => setSettingsTab(null)}
        />
      )}
      <header
        ref={headerRef}
        data-editor-obstacle="header"
        className="editor-toolbar z-[var(--z-bubble)] flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-3 py-1.5 pr-[max(0.75rem,var(--safe-right))] pl-[max(0.75rem,var(--safe-left))] pt-[max(0.375rem,var(--safe-top))]"
      >
        {/* ① History and the single scaling cluster. */}
        <div className="editor-header-zone editor-header-primary">
          <IconButton
            label="تراجع"
            hint="العودة إلى التغيير السابق"
            shortcut="⌘Z"
            icon={<Undo2 className="size-4" strokeWidth={1.7} />}
            onClick={undo}
            disabled={pastDepth <= 1}
          />
          <IconButton
            label="إعادة"
            hint="تطبيق التغيير التالي"
            shortcut="⌘⇧Z"
            icon={<Redo2 className="size-4" strokeWidth={1.7} />}
            onClick={redo}
            disabled={!futureDepth}
          />
          {/* On a phone the stepper gives way to «عرض», which carries the same
              commands, so history and export are never pushed off screen. */}
          {!isCompact && (
            <>
              <span className="editor-header-sep" aria-hidden />
              <div
                className="editor-zoom-cluster"
                role="group"
                aria-label="مقياس مساحة العمل"
              >
                <IconButton
                  label="تصغير اللوحة"
                  shortcut="⌘−"
                  className="editor-zoom-btn"
                  icon={<Minus className="size-4" strokeWidth={1.8} />}
                  onClick={() => zoomCentered(stepZoom(zoom, -1))}
                />
                <button
                  type="button"
                  className="editor-zoom-readout"
                  onClick={() => zoomCentered(1)}
                  title="المقياس الحالي — انقر للعودة إلى 100%"
                  aria-label="إعادة المقياس إلى مئة بالمئة"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <IconButton
                  label="تكبير اللوحة"
                  shortcut="⌘+"
                  className="editor-zoom-btn"
                  icon={<Plus className="size-4" strokeWidth={1.8} />}
                  onClick={() => zoomCentered(stepZoom(zoom, 1))}
                />
                <IconButton
                  label="ملاءمة الصفحة"
                  hint="إظهار الصفحة كاملة داخل مساحة العمل"
                  shortcut="⌘0"
                  className="editor-zoom-btn"
                  icon={<Scan className="size-4" strokeWidth={1.7} />}
                  onClick={fitToScreen}
                />
              </div>
            </>
          )}
        </div>

        {/* ② The document itself — its name, centred, editable in place. */}
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
          </div>
        </div>

        {/* ③ Document actions and the account. */}
        <div className="editor-header-zone editor-header-actions ms-auto">
          {/* Keep the frequently used library door on wide layouts; on phones,
              «إضافة» includes the same route without spending another toolbar cell. */}
          {!isCompact && (
            <IconButton
              label="المكتبة"
              hint="صورك، شعاراتك وملفات SVG المحفوظة"
              active={libraryOpenFlag && !focusMode && !cropActive}
              tipSide="bottom"
              icon={<Library className="size-4" strokeWidth={1.7} />}
              onClick={() => {
                if (libraryOpenFlag) {
                  setPanelOpenFlag("library", false);
                  return;
                }
                openLeftTab("library");
              }}
            />
          )}
          <AddMenu
            onUpload={(kind) => onUpload(kind)}
            onUploadSvg={onUploadSvg}
            onAddLibrary={() => setAddLibraryOpen(true)}
            onCreateLibraryFolder={requestLibraryFolder}
            onHeadingGenerator={() => setHeadingGeneratorOpen(true)}
            onReportTools={openReportTools}
            onDrawText={() => {
              openLeftTab("elements");
              armTool("text");
            }}
            onOpenLeft={openLeftTab}
          />
          <ViewMenu fitToScreen={fitToScreen} fitToSelection={fitToSelection} />
          <SaveBadge onClick={() => void saveNow()} />
          <ProjectFileMenu onOpenFile={onOpenFile} />
          <IconButton
            label="تصدير المشروع"
            hint="PDF أو Word أو PowerPoint أو صورة"
            shortcut="⌘E"
            primary
            className="editor-export-btn"
            icon={<Download className="size-4" strokeWidth={1.8} />}
            onClick={() => toggle("exportOpen")}
          />
          {!showcase && (
            <EditorAccountMenu
              homeHref={homeHref}
              onNavigateHome={leaveEditor}
            />
          )}
        </div>
      </header>

      {/*
       * Workspace — canvas first, always.
       *
       * The six editor lists are INDEPENDENT floating windows (their own open
       * flag, rectangle and dock side). Floating, they are high-z absolute
       * overlays: opening, closing, moving or resizing one can never reflow
       * the artboard. Docked to a screen edge, one becomes a grid track — the
       * row reserves its space and the canvas shrinks instead of being
       * covered, then reclaims it on undock.
       */}
      <div
        onContextMenu={(event) => {
          event.preventDefault();
          const target = (event.target as HTMLElement).closest<HTMLElement>(
            "[data-el-id]",
          );
          const targetId = target?.dataset.elId || null;
          if (targetId && !useEditor.getState().selectedIds.includes(targetId))
            select(targetId);
          openContextMenu({
            x: event.clientX,
            y: event.clientY,
            targetId,
            source: "canvas",
          });
        }}
        className="editor-focus-workspace editor-workspace-row relative min-h-0 overflow-hidden"
        style={{
          transition:
            "grid-template-columns 180ms cubic-bezier(0.22, 1, 0.36, 1), grid-template-rows 180ms cubic-bezier(0.22, 1, 0.36, 1)",
          display: "grid",
          gridTemplateColumns: workspaceCols.join(" "),
          gridTemplateRows: workspaceRows.join(" "),
        }}
      >
        {dockedBySide.top && renderDockedWindow(dockedBySide.top, "top")}
        <div
          className="editor-canvas-workspace relative grid min-w-0 min-h-0 grid-rows-[minmax(0,1fr)_auto_auto_auto] overflow-hidden"
          style={centerArea}
        >
          {/* Non-modal drawers leave direct canvas manipulation available. */}
          <CanvasStage onDropImage={onDropImage} />
          {!pagesRailHidden && (
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
          )}
          {/*
           * Pages panel: the compact tray (96px default, 84px floor), a 36px
           * chip strip when collapsed, and height 0 when hidden entirely —
           * the artboard reclaims every pixel in that case.
           */}
          <div
            data-editor-obstacle="page-rail"
            className="min-h-0 min-w-0"
            style={{
              height: pagesRailHidden
                ? 0
                : pagesRailCollapsed
                  ? PAGES_RAIL_COLLAPSED
                  : pagesPanelHeight,
            }}
          >
            {!pagesRailHidden && (
              <PageRail
                height={pagesRailCollapsed ? PAGES_RAIL_COLLAPSED : pagesPanelHeight}
                minHeight={PAGES_PANEL_MIN}
              />
            )}
          </div>
          <WorkspaceStatusBar />
        </div>
        {dockedBySide.left && renderDockedWindow(dockedBySide.left, "left")}
        {dockedBySide.right && renderDockedWindow(dockedBySide.right, "right")}
        {dockedBySide.bottom && renderDockedWindow(dockedBySide.bottom, "bottom")}

        {/* Floating (undocked) windows — absolute overlays over the workspace. */}
        {PANEL_IDS.filter((id) => !visibleDock(id)).map((id) => (
          <FloatingPanel
            key={id}
            storageKey={`nasaq.panel.${id}`}
            title={PANEL_DEFS[id].title}
            side={PANEL_DEFS[id].side}
            open={panelOpen[id] && !cropActive && !focusMode}
            onClose={() => setPanelOpenFlag(id, false)}
            onDockSideChange={(side) => changeDockSide(id, side)}
            defaultSize={PANEL_DEFS[id].defaultSize}
            minSize={PANEL_DEFS[id].minSize}
            spawnShift={PANEL_DEFS[id].spawnShift}
          >
            {renderPanelBody(id)}
          </FloatingPanel>
        ))}
      </div>

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
      {addLibraryOpen && (
        <AddLibraryDialog onClose={() => setAddLibraryOpen(false)} />
      )}
      {headingGeneratorOpen && (
        <HeadingGeneratorDialog
          onClose={() => setHeadingGeneratorOpen(false)}
        />
      )}
      {/*
       * First-visit walkthrough. Mounted only after hydration: the tour
       * measures real controls, and measuring a skeleton would highlight the
       * wrong rectangle on a slow first paint.
       */}
      {!showcase && tourOpen && hydrated && (
        <OnboardingTour onFinish={() => setTourOpen(false)} />
      )}
    </div>
  );
}

/**
 * Save-state indicator. Self-subscribed (including the 20 s `clockTick`
 * heartbeat the shell no longer re-renders for) so a save state change
 * repaints this button alone.
 */
function SaveBadge({ onClick }: { onClick: () => void }) {
  const state = useEditor((s) => s.saveState);
  const savedAt = useEditor((s) => s.savedAt);
  useEditor((s) => s.clockTick);
  const label = saveLabel(state, savedAt, Date.now());
  const tone =
    state === "error"
      ? "is-danger"
      : state === "dirty" || state === "saving"
        ? "is-pending"
        : "is-saved";
  return (
    /* Same 34px control as the rest of the strip: the state lives in the icon
       and its colour, the full sentence in the tooltip. */
    <IconButton
      label={label}
      hint="حفظ المستند الآن"
      shortcut="⌘S"
      onClick={onClick}
      className={tone}
      icon={
        state === "saved" ? (
          <Check className="size-4" strokeWidth={1.9} />
        ) : (
          <Save className="size-4" strokeWidth={1.7} />
        )
      }
    />
  );
}
