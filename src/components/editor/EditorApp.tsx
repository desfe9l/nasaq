import { useNavigate } from "@tanstack/react-router";
import { subscribeTheme } from "@/lib/theme";
import { BrandLogo } from "@/components/site/SiteChrome";
import {
  canRunShortcutInScope,
  isEditableTarget,
  shortcutKey,
  stepBrushSizeMm,
} from "@/lib/editor/keyboard";
import { useTools } from "@/lib/editor/tool-store";
import {
  REGION_MODES,
  toolDef,
  regionModeDef,
  resolveToolKey,
  type RegionMode,
  type ToolId,
} from "@/lib/editor/tools";
import { ToolPropertiesBar } from "./ToolPropertiesBar";
import { beginImageCrop, cropSelectionToImage } from "@/lib/editor/crop-session";

/**
 * One glyph per live state of the ONE select tool, keyed by region mode — the
 * toolbar cannot render a mode without an icon, and cannot render an icon for
 * a mode that does not exist. Nine selection buttons used to share this strip;
 * now a single cell shows the armed shape and its caret opens the dropdown.
 */
const SELECT_MODE_ICONS: Record<RegionMode, typeof MousePointer2> = {
  off: MousePointer2,
  rect: SquareDashed,
  // A distinct glyph from «مستطيل»: two different modes never wear one icon.
  square: Square,
  ellipse: Circle,
  lasso: Lasso,
};

/** The four non-selection tools — each one button, nothing else. */
const PAINT_ICONS: Record<"brush" | "eraser" | "text" | "shape", typeof Brush> = {
  brush: Brush,
  eraser: Eraser,
  text: TypeIcon,
  shape: RectangleHorizontal,
};

/**
 * The ONE «تحديد / قص» control: the button arms the plain pointer, and the
 * caret opens the whole region vocabulary (pointer · rectangle · square ·
 * ellipse · freeform) in a single compact dropdown. Picking a shape closes the
 * menu and starts the drawing state immediately; nothing about this control
 * reserves layout — the menu is a clamped portal, the tool options are a
 * floating capsule, and the crop frame carries its own ephemeral Apply/Cancel.
 */
function SelectCropTool({
  activeTool,
  activeMode,
}: {
  activeTool: ToolId;
  activeMode: RegionMode;
}) {
  const regionArmed = activeTool === "select" && activeMode !== "off";
  const def = toolDef("select");
  const modeDef = regionModeDef(regionArmed ? activeMode : "off");
  const Glyph = SELECT_MODE_ICONS[regionArmed ? activeMode : "off"];
  return (
    <div className="editor-tool-cell">
      <Tip
        label={def.label}
        hint={regionArmed ? modeDef.hint : def.hint}
        shortcut={def.shortcut}
        side="bottom"
      >
        <button
          type="button"
          className={cn("editor-icon-btn editor-tool-main", regionArmed && "is-active")}
          aria-label={def.label}
          aria-keyshortcuts={def.shortcut}
          onClick={() => useTools.getState().armSelect("off")}
        >
          <span className="editor-icon-glyph" aria-hidden="true">
            <Glyph className="size-4" strokeWidth={1.7} />
          </span>
        </button>
      </Tip>
      <AnchorMenu
        label="أنواع التحديد والقص"
        width={248}
        side="bottom"
        align="start"
        trigger={({ ref, onClick, ...aria }) => (
          <Tip label="نوع المنطقة" hint="الأساسي · مستطيل · مربع · بيضاوي · حر" side="bottom">
            <button
              ref={ref}
              type="button"
              onClick={onClick}
              className={cn("editor-tool-caret", regionArmed && "is-active")}
              aria-label="أنواع التحديد والقص"
              {...aria}
            >
              <ChevronDown size={11} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </Tip>
        )}
      >
        {REGION_MODES.map((mode) => {
          const ModeGlyph = SELECT_MODE_ICONS[mode.id];
          return (
            <MenuRow
              key={mode.id}
              icon={<ModeGlyph size={15} strokeWidth={1.8} />}
              label={mode.label}
              hint={mode.hint}
              shortcut={mode.shortcut}
              checked={activeTool === "select" && activeMode === mode.id}
              onSelect={() => useTools.getState().armSelect(mode.id)}
            />
          );
        })}
      </AnchorMenu>
    </div>
  );
}
import { EditorSettingsDialog } from "./EditorSettingsDialog";
import { OPEN_EDITOR_SETTINGS_EVENT } from "@/lib/editor/ui-state";
import { FloatingPanel } from "./ui/FloatingPanel";
import { IconButton } from "./ui/IconButton";
import { AnchorMenu, MenuRow } from "./ui/AnchorMenu";
import { Tip } from "./ui/Tip";
import { ViewMenu } from "./ViewMenu";
import { AppearanceMenu } from "./AppearanceMenu";
import { ProductNav } from "@/components/nav/ProductNav";
import { EDITOR_SURFACE_NAV, isEditorElementTab, editorSurfaceActive } from "@/lib/nav/surface-nav";

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
/** Opening height of a window docked to the top or bottom edge. */
const DOCK_BAND_H = 236;
/**
 * Dock-side storage. v3 resets every author ONCE to the shipped layout: the
 * content window (لوحة العناصر + أدوات العناصر + المكتبة)
 * pinned on the right, the inspector window (الخصائص + الطبقات + أدوات التقرير)
 * on the left.
 */
const DOCKS_KEY = "nasaq.panel.docks.v3";
const LAYOUT_APPLIED_KEY = "nasaq.workspace.layout.v2";
const COLLAPSED_KEY = "nasaq.panels.collapsed.v1";
const COLLAPSED_TRACK = 44;
const DEFAULT_DOCKS: Partial<Record<PanelId, DockSide>> = {
  [WORKSPACE_RIGHT_GROUP[0]]: "right",
  [WORKSPACE_LEFT_GROUP[0]]: "left",
};

/** Top and bottom pins are gone: only the two side edges remain. */
function sanitizeDockSides(
  sides: Partial<Record<PanelId, DockSide>>,
): Partial<Record<PanelId, DockSide>> {
  const next: Partial<Record<PanelId, DockSide>> = {};
  for (const id of PANEL_IDS) {
    const side = sides[id];
    if (side === "left" || side === "right") next[id] = side;
  }
  return next;
}

/**
 * Kept for external scripts/anchors. «أدوات التقرير» is now its own window;
 * the toolbar button opens it directly via the store.
 */
export const OPEN_REPORT_TOOLS_EVENT = "nasaq:open-report-tools";
import {
  Brush,
  Check,
  ChevronDown,
  Circle,
  Download,
  Eraser,
  Lasso,
  Library,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Save,
  Scan,
  SlidersHorizontal,
  RectangleHorizontal,
  Square,
  SquareDashed,
  Type as TypeIcon,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { ThemedToaster } from "@/components/ui/ThemedToaster";
import {
  useEditor,
  saveLabel,
  PAGES_PANEL_MIN,
  type LeftTab,
} from "@/lib/editor/store";
import {
  leavePromptOpen,
  requestLeave,
  unloadBypassed,
  unloadShouldPrompt,
} from "@/lib/editor/leave-controller";
import { LeaveGuard } from "@/components/editor/LeaveGuard";
import { TemplateDraftBar } from "./TemplateDraftBar";
import { absoluteBounds, elementsBounds, pageSize } from "@/lib/editor/model";
import {
  placeImageBox,
  prepareImage,
  uniqueImageFiles,
} from "@/lib/editor/images";
import { zoomAnchoredAt } from "@/lib/editor/viewport";
import { clampZoom, stepZoom } from "@/lib/editor/document-space";
import {
  canvasViewport,
  visiblePageRect,
  insertionPage,
} from "@/lib/editor/canvas-space";
import { mmToPx } from "@/lib/editor/render-units";
import { useInteraction } from "@/lib/editor/interaction-store";
import { findElement, type Project } from "@/lib/editor/model";
import { LeftPanel, ElementToolsWindow } from "./LeftPanel";
import { PropertiesPanel, LayersPanel } from "./RightPanel";
import { AssetLibrary } from "./AssetLibrary";
import { ReportToolsPanel } from "./ReportToolsPanel";
import { AddMenu } from "./AddMenu";
import { CanvasStage } from "./CanvasStage";
import { PageRail } from "./PageRail";
import { ExportDialog } from "./ExportDialog";
import { PageSettingsHost } from "./PageSettingsDialog";
import { NewPageHost } from "./NewPageDialog";
import { cn } from "@/lib/utils";
import { EditorWorkspaceSkeleton } from "@/components/ui/Skeleton";
import { WorkspaceOverlays, WorkspaceStatusBar } from "./WorkspaceOverlays";
import { EditorAccountMenu } from "./EditorAccountMenu";
import { HeaderPaint } from "./HeaderPaint";
import {
  OVERLAY_BREAKPOINT,
  DOCK_BREAKPOINT,
  isOverlayViewport,
  resolveEditorSurface,
  clampDockSize,
  fitSideDockWidths,
  workspaceFitZoom,
  PAGES_RAIL_COLLAPSED,
  type DockSide,
  type EditorSurface,
} from "@/lib/editor/ui-state";
import {
  defaultWorkspaceGroups,
  detachPanelTab,
  hostOf,
  loadPanelGroups,
  movePanelTab,
  savePanelGroups,
  WORKSPACE_LEFT_GROUP,
  WORKSPACE_RIGHT_GROUP,
  type PanelGroupState,
} from "@/lib/editor/panel-groups";
import {
  loadDockEdgePreference,
  saveDockEdgePreference,
  type DockEdgePreference,
} from "@/lib/editor/workspace-dock";
import { PANEL_META, PanelTabStrip } from "./PanelTabStrip";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useLicense } from "@/lib/license/client";
import { WORKSPACE_HOME_PATH } from "@/lib/auth/use-workspace-entry";
import { AddLibraryDialog } from "./AddLibraryDialog";
import { HeadingGeneratorDialog } from "./HeadingGeneratorDialog";
import { NasaqAiHub } from "./NasaqAiHub";
import { toggleNasaqAi } from "@/lib/ai/nasaq-ai";
import { OnboardingTour, hasSeenTour } from "./OnboardingTour";
import { NsqIntake } from "./NsqIntake";
import { AppInstallNotice } from "@/components/AppInstallNotice";
import { isStandalone } from "@/lib/app-install";
import { MobileWorkspaceGuide } from "@/components/editor/MobileWorkspaceGuide";
import { useNsqSignedIn } from "@/lib/nsq/use-nsq-session";
import { ProjectFileMenu, NSQ_SAVE_AS_EVENT } from "./ProjectFileMenu";
import { NSQ_ACCEPT } from "@/lib/nsq/format";
import { receiveProjectFile } from "@/lib/nsq/intake";
import { rememberUploadedFont } from "@/lib/nsq/fonts";
import { classifyImport } from "@/lib/editor/import/detect";

/**
 * The studio shell.
 *
 * Route-level concerns (site chrome, navigation) live in `SiteHeader`; this
 * component owns the editor chrome, the hidden file inputs the panels drive,
 * and the global keyboard map.
 */
export function EditorApp({ projectId }: { projectId?: string } = {}) {
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
    trial,
  } = useLicense(user?.id, user?.primaryEmail);
  const activeTrial = trial && Date.parse(trial.expiresAt) > Date.now() ? trial : null;
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

  /*
   * One document, one address. When the author switches documents INSIDE the
   * studio (the project menu, a template, a fresh document), the address bar
   * follows the document that is actually open — so a refresh, a bookmark or a
   * shared link re-opens the same design, never "whatever was last touched".
   * The replace keeps Back meaning "leave the editor", not "walk the history of
   * documents I glanced at".
   */
  const openProjectId = useEditor((s) => s.id);
  const navigate = useNavigate();
  useEffect(() => {
    if (!projectId || !openProjectId || openProjectId === projectId) return;
    void navigate({
      to: "/editor/$projectId",
      params: { projectId: openProjectId },
      replace: true,
      /*
       * The store already decided the document (and any leave prompt was
       * resolved before it did), so the address follows it silently — a router
       * blocker here would ask the author to confirm a switch they just made.
       */
      ignoreBlocker: true,
    });
  }, [openProjectId, projectId, navigate]);

  // Keep editor-side limits in sync with the same server-derived entitlements
  // used by the license and export surfaces.
  useEffect(() => {
    if (!licenseLoading) setEntitlements(entitlements);
  }, [entitlements, licenseLoading, setEntitlements]);

  // The studio is a fixed-height shell; the marketing pages scroll normally.
  useEffect(() => {
    document.body.classList.add("is-editor");
    const previous = document.title;
    return () => {
      document.body.classList.remove("is-editor");
      document.title = previous;
    };
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
    intentOverride = imageIntent.current,
  ) => {
    const api = useEditor.getState();
    const intent = at ? { type: "image" as const } : intentOverride;
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
    const size = pageSize(targetPage);
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
        const imageCount = targetPage.elements.filter(
          (element) => element.type === "image" || element.type === "logo",
        ).length;
        const box = placeImageBox(
          { width: Math.max(1, img.width), height: Math.max(1, img.height) },
          size,
          {
            intent: kind,
            sequence: imageCount,
            ...(at ? { at } : {}),
          },
        );
        api.addElementAt(
          kind,
          {
            src: img.src,
            name: kind === "logo" ? "شعار" : "صورة",
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            style: {
              objectFit: "contain",
              objectX: 50,
              objectY: 50,
              aspectLock: true,
            },
          },
          undefined,
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

  /**
   * All non-native formats enter through the same ImportBuilder → Project →
   * importProject path. The editor therefore opens PSD/PDF/Office content as
   * ordinary pages and objects; there is no format-specific canvas or mode.
   */
  const openSelectedFile = async (file: File) => {
    if (!(await requestLeave())) return;
    const loadingId = toast.loading("جارٍ استيراد الملف إلى المحرر…");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const classified = classifyImport(file.name, bytes);
      if (!classified.format) throw new Error(classified.error || "صيغة غير مدعومة.");
      if (classified.format === "nsq" || classified.format === "json") {
        toast.dismiss(loadingId);
        await receiveProjectFile(file, nsqSignedIn);
        return;
      }

      // One canonical import service for every non-native format; PSD/PSB and
      // Office/PDF/raster share the same call, result shape and size policy.
      const [{ listAssets }, { importTemplateBytes }] = await Promise.all([
        import("@/lib/editor/storage"),
        import("@/lib/editor/import/run"),
      ]);
      const result = await importTemplateBytes(bytes, file.name, { assets: await listAssets() });
      const project: Project = result.project;
      const notes = result.notes;

      const opened = await useEditor.getState().importProject(project, { successMessage: null });
      if (!opened) {
        toast.dismiss(loadingId);
        return;
      }
      const approximate = notes.filter(
        (note) => note.mode === "partial" || note.mode === "flattened" || note.mode === "skipped",
      );
      const partialCount = approximate.length;
      const notePreview = approximate
        .slice(0, 2)
        .map((note) => `${note.name}: ${note.reason}`)
        .join(" · ");
      toast.success("تم الاستيراد — افتُتح المستند في محرر نَسَق", {
        id: loadingId,
        description: partialCount ? `${partialCount} ملاحظة تحويل. ${notePreview}` : undefined,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر استيراد الملف", { id: loadingId });
    }
  };

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
      <LeaveGuard />
      {activeTrial && (
        <div className="border-b border-brand/15 bg-brand/10 px-3 py-2 text-center text-[12px] font-bold text-ink">
          التجربة المجانية سارية حتى {new Date(activeTrial.expiresAt).toLocaleDateString("ar-SA")}.
          <a href="/license" className="ms-1 underline underline-offset-2">عرض حالة الاشتراك</a>
        </div>
      )}
      {!showcase && <TemplateDraftBar />}

      {/* One open door for native NASAQ projects and interoperable design files. */}
      <input
        ref={projectInput}
        type="file"
        accept={`${NSQ_ACCEPT},.psd,.psb,.docx,.pptx,.xlsx,.pdf,.png,.jpg,.jpeg,.svg`}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void openSelectedFile(file);
        }}
      />

      {!showcase && <NsqIntake />}

      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          const intent = imageIntent.current;
          e.target.value = "";
          if (!files.length) return;
          const unique = uniqueImageFiles(files);
          const selected = intent.type === "replace" ? unique.slice(0, 1) : unique;
          void (async () => {
            for (const file of selected) {
              await ingestImage(file, undefined, intent);
            }
          })();
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
  useEffect(() => {
    const project = name.trim() || "مستند جديد";
    document.title = `${project} — نَسَق`;
  }, [name]);
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
  const leftTab = useEditor((s) => s.leftTab);
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
   * drift apart. iPad portrait (768) docks the same windows as the desktop.
   */
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window === "undefined" || !isOverlayViewport(),
  );
  const [canDock, setCanDock] = useState(
    () =>
      typeof window === "undefined" ||
      window.matchMedia(`(min-width: ${DOCK_BREAKPOINT}px)`).matches,
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
  /**
   * Coarse pointer (finger-first) detection. The responsive layout system
   * resolves ONE surface from (viewport, pointer), publishes it as
   * `data-editor-surface` on the shell, and every density decision — tool
   * button size, options bar, drawer padding — reads the same answer, so the
   * bar cannot grow on iPad and shrink on desktop from separate media queries
   * that disagree.
   */
  const [coarsePointer, setCoarsePointer] = useState(
    () =>
      typeof window !== "undefined" &&
      (window.matchMedia("(any-pointer: coarse)").matches ||
        navigator.maxTouchPoints > 0),
  );
  useEffect(() => {
    const media = window.matchMedia("(any-pointer: coarse)");
    // iPadOS with a trackpad can advertise a fine primary pointer while touch
    // and Pencil remain available. maxTouchPoints keeps the layout touch-first.
    const update = () =>
      setCoarsePointer(media.matches || navigator.maxTouchPoints > 0);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  // Installed windows use the same tools and saved groups, one window at a
  // time. Observe display-mode transitions as well as iOS's standalone flag.
  const [installedApp, setInstalledApp] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const update = () => setInstalledApp(isStandalone());
    update();
    media.addEventListener("change", update);
    window.addEventListener("pageshow", update);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("pageshow", update);
    };
  }, []);
  const compactPanels = installedApp || coarsePointer || !canDock;
  /** The shell root: the surface attribute and the zoom guards live here. */
  const shellRef = useRef<HTMLDivElement>(null);
  /** First load is what arms the auto-fit below. */
  const hydrated = useEditor((s) => s.hydrated);
  /** ?showcase=1: no walkthrough, no account menu in the product preview. */
  const showcase = useEditor((s) => s.showcase);
  /** «أضف مكتبة» and «مولد عناوين الفقرات» are modal, so they own no store state. */
  const [addLibraryOpen, setAddLibraryOpen] = useState(false);
  const [libraryFolderRequest, setLibraryFolderRequest] = useState(0);
  const [headingGeneratorOpen, setHeadingGeneratorOpen] = useState(false);
  useEffect(() => {
    const open = () => setHeadingGeneratorOpen(true);
    window.addEventListener("nasaq:open-heading-generator", open);
    return () => window.removeEventListener("nasaq:open-heading-generator", open);
  }, []);
  /**
   * First-visit walkthrough. Read once, on mount, so the tour never reappears
   * mid-session after the author dismisses it.
   */
  const [tourOpen, setTourOpen] = useState(
    () => typeof window !== "undefined" && !hasSeenTour(),
  );
  useEffect(() => {
    const compact = window.matchMedia("(max-width: 600px)");
    const onCompact = () => setIsCompact(compact.matches);
    onCompact();
    compact.addEventListener("change", onCompact);
    return () => compact.removeEventListener("change", onCompact);
  }, []);

  useEffect(() => {
    const media = window.matchMedia(`(min-width: ${DOCK_BREAKPOINT}px)`);
    const update = () => {
      setCanDock(media.matches);
      // Crossing into tablet width hands the whole width back to the canvas.
      if (!media.matches) useEditor.getState().closeFloatingPanels();
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
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

  /** Latest `fitToScreen`, for layout effects that must not re-subscribe. */
  const fitRef = useRef<() => void>(() => {});
  /** Invalidates an older post-render centring loop when a newer fit wins. */
  const fitSequenceRef = useRef(0);

  /**
   * ملاءمة الصفحة / عرض الصفحة بالكامل: choose the largest undistorted camera
   * scale for the current device and unobscured canvas lane, then centre the
   * ACTIVE artboard after React has painted that exact zoom.
   */
  const fitToScreen = useCallback(() => {
    // Read the LIVE document, never a render-time snapshot: opens, imports and
    // responsive layout effects can all outlive the render that scheduled them.
    const state = useEditor.getState();
    const activePage =
      state.pages.find((p) => p.id === state.activePageId) || state.pages[0];
    if (!activePage) return setZoom(0.82);
    const activeSize = pageSize(activePage);
    const stage = document.querySelector<HTMLElement>(".editor-canvas-stage");
    if (!stage) return setZoom(0.82);
    const viewport = canvasViewport(stage, activeSize);
    const shell = stage.closest<HTMLElement>(".editor-ui");
    const device =
      (shell?.dataset.deviceSurface as EditorSurface | undefined) ?? "desktop";
    const next = clampZoom(
      workspaceFitZoom(
        { width: viewport.width, height: viewport.height },
        { width: mmToPx(activeSize.w), height: mmToPx(activeSize.h) },
        device,
      ),
    );
    const sequence = ++fitSequenceRef.current;
    setZoom(next);

    /*
     * A state write and a CSS transform do not necessarily paint in the same
     * frame (especially while an iPad rotates). Wait until the measured page
     * carries the target zoom, then correct the scroll twice at most. This
     * removes the old opening race that left a correctly scaled page far from
     * the user because centring ran against its previous size.
     */
    let paintAttempts = 0;
    let centrePass = 0;
    const land = () => {
      if (
        sequence !== fitSequenceRef.current ||
        useEditor.getState().zoom !== next
      )
        return;
      const liveStage = document.querySelector<HTMLElement>(
        ".editor-canvas-stage",
      );
      const page = liveStage?.querySelector<HTMLElement>(
        `[data-page-id="${CSS.escape(activePage.id)}"]`,
      );
      if (!liveStage || !page || !page.isConnected) return;
      const pageRect = page.getBoundingClientRect();
      const baseWidth = mmToPx(activeSize.w);
      const paintedZoom = baseWidth > 0 ? pageRect.width / baseWidth : next;
      if (
        Math.abs(paintedZoom - next) > 0.01 &&
        paintAttempts++ < 12
      ) {
        requestAnimationFrame(land);
        return;
      }
      const lane = canvasViewport(liveStage, activeSize);
      const cell = page.closest<HTMLElement>(".artboard-cell") ?? page;
      const bounds = cell.getBoundingClientRect();
      liveStage.scrollLeft +=
        bounds.left + bounds.width / 2 - (lane.left + lane.width / 2);
      liveStage.scrollTop +=
        bounds.top + bounds.height / 2 - (lane.top + lane.height / 2);
      // Layout/scroll clamping can settle one frame later on Safari. A second
      // pass is idempotent and keeps the page mathematically centred.
      if (centrePass++ < 1) requestAnimationFrame(land);
    };
    requestAnimationFrame(land);
  }, [setZoom]);
  fitRef.current = fitToScreen;

  useEffect(() => {
    const onFitPage = () => fitRef.current();
    window.addEventListener("nasaq:fit-page", onFitPage);
    return () => window.removeEventListener("nasaq:fit-page", onFitPage);
  }, []);

  /* Three-finger double tap on the artboard returns the page to a full fit.
     A single three-finger touch is ignored so it does not fight scrolling. */
  useEffect(() => {
    let last = 0;
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 3) return;
      const stage = document.querySelector(".editor-canvas-stage");
      const target = event.target;
      if (!stage || !(target instanceof Node) || !stage.contains(target)) return;
      const now = performance.now();
      if (now - last < 500) {
        event.preventDefault();
        fitRef.current();
        last = 0;
      } else {
        last = now;
      }
    };
    window.addEventListener("touchstart", onTouchStart, { passive: false });
    return () => window.removeEventListener("touchstart", onTouchStart);
  }, []);

  useEffect(() => {
    const onReplace = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id === "string" && id) onReplaceImage(id);
    };
    window.addEventListener("nasaq:replace-image", onReplace);
    return () => window.removeEventListener("nasaq:replace-image", onReplace);
  }, [onReplaceImage]);

  /*
   * Every true document replacement emits one transient revision from the
   * store. Unlike an id heuristic this also covers unsaved blanks, duplicated
   * templates and imported documents that reuse an id, while normal edits and
   * first autosave never disturb the camera.
   */
  const documentRevision = useEditor((s) => s.documentRevision);
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => fitRef.current(), 80);
    return () => window.clearTimeout(timer);
  }, [documentRevision, hydrated]);

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
    event.preventDefault();
    const href = event.currentTarget.href;
    void requestLeave().then((ok) => {
      if (ok) window.location.assign(href);
    });
  };

  /*
   * Tab hide still flushes the debounced save. Refresh and close do not write
   * the crash draft: the native prompt warns first, and a confirmed reload
   * must reopen the last successful save rather than unsaved edits.
   */
  useEffect(() => {
    const flush = () => {
      unloadShouldPrompt();
      if (unloadBypassed() || leavePromptOpen()) return;
      const state = useEditor.getState();
      if (state.saveState === "dirty" && !state.isSavePaused()) void saveNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [saveNow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      const typing = isEditableTarget(t);
      const meta = e.metaKey || e.ctrlKey;
      const modalOpen = Boolean(
        t?.closest('[role="dialog"], [role="menu"]') ||
          document.querySelector('[role="dialog"], [role="menu"]'),
      );
      if (e.defaultPrevented || e.isComposing || modalOpen) return;
      const interactionState = useInteraction.getState();
      const toolLive = useTools.getState();
      const shortcutCtx = {
        editableTarget: typing,
        modalOpen,
        interactionBusy: interactionState.active || Boolean(interactionState.marquee),
        painting: toolLive.painting,
        cropActive: Boolean(interactionState.crop),
      };
      const canRunApp = canRunShortcutInScope("app", shortcutCtx);
      const canRunCanvas = canRunShortcutInScope("canvas", shortcutCtx);
      const key = shortcutKey(e);

      if (meta && key === "z") {
        // While the caret is in a field or the in-place text editor, the browser's
        // own undo stack owns Cmd/Ctrl+Z — hijacking it would revert whole project
        // states when the author meant to undo a few characters.
        if (!canRunCanvas) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && key === "y") {
        if (!canRunCanvas) return;
        e.preventDefault();
        redo();
        return;
      }
      if (meta && key === "s") {
        if (!canRunApp) return;
        e.preventDefault();
        // ⇧⌘S — «حفظ باسم» a native `.nsq` file; ⌘S keeps saving to the library.
        if (e.shiftKey)
          window.dispatchEvent(new CustomEvent(NSQ_SAVE_AS_EVENT));
        else void saveNow();
        return;
      }
      if (meta && key === "o" && !e.shiftKey) {
        if (!canRunApp) return;
        e.preventDefault();
        onOpenFile();
        return;
      }
      if (meta && key === "e") {
        if (!canRunApp) return;
        e.preventDefault();
        toggle("exportOpen");
        return;
      }
      if (meta && key === "d") {
        if (!canRunCanvas) return;
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (meta && e.altKey && key === "c") {
        if (!canRunCanvas) return;
        e.preventDefault();
        copyStyle();
        return;
      }
      if (meta && e.altKey && key === "v") {
        if (!canRunCanvas) return;
        e.preventDefault();
        pasteStyle();
        return;
      }
      if (meta && key === "c") {
        if (!canRunCanvas) return;
        e.preventDefault();
        copySelected();
        return;
      }
      if (meta && key === "x") {
        if (!canRunCanvas) return;
        e.preventDefault();
        copySelected();
        deleteSelected();
        return;
      }
      if (meta && key === "v") {
        if (!canRunCanvas) return;
        e.preventDefault();
        // ⇧⌘V = لصق في مكانه (paste in place); ⌘V keeps the nudged paste.
        pasteClipboard(e.shiftKey);
        return;
      }
      if (meta && key === "a") {
        if (!canRunCanvas) return;
        e.preventDefault();
        selectAll();
        return;
      }
      if (meta && key === "g") {
        if (!canRunCanvas) return;
        e.preventDefault();
        if (e.shiftKey) ungroup();
        else group();
        return;
      }
      /*
       * Brush / Eraser diameter adjustment on bare `[` and `]` (when Cmd/Ctrl
       * is not held, so ⌘[ / ⌘] layer-order shortcuts never conflict).
       */
      if (
        canRunCanvas &&
        !meta &&
        !e.altKey &&
        (toolLive.tool === "brush" || toolLive.tool === "eraser") &&
        (key === "[" ||
          key === "]" ||
          e.code === "BracketLeft" ||
          e.code === "BracketRight")
      ) {
        e.preventDefault();
        const dir =
          key === "]" || e.code === "BracketRight" ? 1 : -1;
        if (toolLive.tool === "eraser") {
          toolLive.setEraser({
            sizeMm: stepBrushSizeMm(toolLive.eraser.sizeMm, dir),
          });
        } else {
          toolLive.setBrush({
            sizeMm: stepBrushSizeMm(toolLive.brush.sizeMm, dir),
          });
        }
        return;
      }
      /*
       * Tool shortcuts, straight from the tool table (so a shortcut can never
       * point at a tool that no longer exists):
       *   V pointer · M rectangle · ⇧M square · L lasso
       *   B brush · E eraser · T text · R rectangle shape
       * C is no longer a tool: it opens the crop frame on the selected image
       * — «قص» is an action on artwork, not a mode of its own.
       * Space+drag stays pan (owned by the canvas).
       */
      const activation = resolveToolKey(key, e.shiftKey);
      if (canRunCanvas && !meta && !e.altKey && activation) {
        e.preventDefault();
        if (activation.tool === "text") useEditor.getState().setLeftTab("elements");
        if (activation.tool === "shape") useEditor.getState().setLeftTab("shapes");
        useTools.getState().activate(activation);
        return;
      }
      if (canRunCanvas && !meta && !e.altKey && key === "c") {
        const st = useEditor.getState();
        const page = st.pages.find((p) => p.id === st.activePageId);
        const el =
          page && st.selectedId && !st.editingId
            ? findElement(page.elements, st.selectedId)?.el
            : null;
        if (el && (el.type === "image" || el.type === "logo")) {
          e.preventDefault();
          beginImageCrop(el.id);
        }
        return;
      }
      /*
       * Enter applies a finished region exactly where it would otherwise sit
       * unused: the keyboard never needs a second confirm button.
       */
      if (canRunCanvas && !meta && !e.altKey && e.key === "Enter") {
        const t = useTools.getState();
        if (
          t.tool === "select" &&
          t.regionMode !== "off" &&
          t.region &&
          !useInteraction.getState().crop &&
          !useEditor.getState().editingId
        ) {
          e.preventDefault();
          void cropSelectionToImage(t.region);
          return;
        }
      }
      if (meta && key === "j") {
        if (!canRunCanvas) return;
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
        if (!canRunCanvas) return;
        e.preventDefault();
        bring(e.shiftKey ? "bottom" : "back");
        return;
      }
      if (meta && (key === "]" || e.code === "BracketRight")) {
        if (!canRunCanvas) return;
        e.preventDefault();
        bring(e.shiftKey ? "front" : "forward");
        return;
      }
      if (
        canRunCanvas &&
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
        canRunApp &&
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
        canRunApp &&
        meta &&
        (key === "-" || e.code === "Minus" || e.code === "NumpadSubtract")
      ) {
        e.preventDefault();
        zoomCentered(stepZoom(useEditor.getState().zoom, -1));
        return;
      }
      if (canRunApp && meta && (key === "0" || e.code === "Digit0")) {
        e.preventDefault();
        fitToScreen();
        return;
      }
      if (shortcutCtx.interactionBusy || shortcutCtx.painting || shortcutCtx.cropActive) {
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
  /*
   * The live tool — read from the tool store, never mirrored.
   *
   * The header used to keep its own `activeTool` copy, kept in sync by two
   * window events, and the canvas kept a third copy. The single store removes
   * the whole class of "the button looks armed but the canvas disagrees" bugs.
   */
  const activeTool = useTools((s) => s.tool);
  const activeRegionMode = useTools((s) => s.regionMode);
  const armTool = (tool: ToolId | null) =>
    useTools.getState().setTool(tool ?? "select");

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
      // Wider floor: its card grids wrapped into a horizontal scroll below
      // ~460px and authors read that as "tools keep hiding". auto-fill grids
      // plus this floor keep ONE visible surface at every width.
      defaultSize: { width: 520, height: 560 },
      minSize: { width: 420, height: 260 },
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
  /** Close the six shared window hosts without rewriting desktop preferences. */
  const closePanelHosts = useCallback(
    () =>
      useEditor.setState({
        leftOpen: false,
        rightOpen: false,
        layersOpen: false,
        reportToolsOpen: false,
        libraryOpen: false,
        toolsOpen: false,
      }),
    [],
  );

  /* ── Grouped windows (one window, several panels as tabs) ───────────────
   * The six windows stay independent by default; an author who wants
   * «أدوات التقرير» and «الخصائص» in ONE place drags a tab onto another
   * window and they share it. The model (panel-groups) guarantees every
   * panel lives in exactly one window, so nothing can vanish by grouping.
   */
  const [groupState, setGroupState] = useState<PanelGroupState>(() =>
    loadPanelGroups(),
  );
  useEffect(() => {
    savePanelGroups(groupState);
  }, [groupState]);
  /** Windows that exist right now (hosts); members live inside their host. */
  const hosts = PANEL_IDS.filter((id) => Boolean(groupState.groups[id]));
  const selectTab = (host: PanelId, tab: PanelId) =>
    setGroupState((s) => ({ ...s, tabs: { ...s.tabs, [host]: tab } }));
  const dropTab = (tab: PanelId, host: PanelId) =>
    setGroupState((s) => movePanelTab(s, tab, host));
  const detachTab = (tab: PanelId) =>
    setGroupState((s) => detachPanelTab(s, tab));
  /** Raise the window that holds `id`, on that tab. */
  const revealPanel = (id: PanelId) => {
    const host = hostOf(groupState, id);
    // Desktop windows remain independently composable. On touch/overlay
    // surfaces a single shared window is deliberate: it maximises artboard
    // visibility and makes every new dock press an unambiguous replacement.
    if (compactPanels) closePanelHosts();
    setGroupState((s) =>
      s.tabs[host] === id ? s : { ...s, tabs: { ...s.tabs, [host]: id } },
    );
    setCollapsedPanels((current) => current[host] ? { ...current, [host]: false } : current);
    setPanelOpenFlag(host, true);
  };
  const togglePanelWindow = (id: PanelId) => {
    const host = hostOf(groupState, id);
    if (panelOpen[host] && groupState.tabs[host] === id)
      setPanelOpenFlag(host, false);
    else revealPanel(id);
  };
  /** Is the panel actually on screen right now (its host window, its tab)? */
  const panelChecked = PANEL_IDS.reduce(
    (acc, id) => {
      const host = hostOf(groupState, id);
      acc[id] = panelOpen[host] && groupState.tabs[host] === id;
      return acc;
    },
    {} as Record<PanelId, boolean>,
  );
  /**
   * Anything that opens a panel through the STORE (keyboard, command rows,
   * the tools that jump to a tab) still works when that panel is grouped:
   * the member flag going open raises its host window on the right tab.
   */
  useEffect(() => {
    for (const id of PANEL_IDS) {
      const host = hostOf(groupState, id);
      if (host === id || !panelOpen[id]) continue;
      setGroupState((s) => ({ ...s, tabs: { ...s.tabs, [host]: id } }));
      setPanelOpenFlag(host, true);
      setPanelOpenFlag(id, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    panelOpen.library,
    panelOpen.tools,
    panelOpen.elements,
    panelOpen.properties,
    panelOpen.layers,
    panelOpen.report,
  ]);
  /** The workspace's preferred pin edge (right / left / mirror the UI). */
  const [dockPref, setDockPref] = useState<DockEdgePreference>(() =>
    loadDockEdgePreference(),
  );
  const changeDockPref = (pref: DockEdgePreference) => {
    setDockPref(pref);
    saveDockEdgePreference(pref);
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

  /*
   * Enforce the compact-surface invariant even for legacy/store commands that
   * set a window flag directly instead of going through `revealPanel`. The
   * newest host wins; desktop deliberately keeps its independent windows.
   */
  const previousPanelOpenRef = useRef<Record<PanelId, boolean>>(panelOpen);
  useEffect(() => {
    if (!compactPanels) {
      previousPanelOpenRef.current = panelOpen;
      return;
    }
    const openHosts = hosts.filter((id) => panelOpen[id]);
    if (openHosts.length <= 1) {
      previousPanelOpenRef.current = panelOpen;
      return;
    }
    const newlyOpened = openHosts.filter(
      (id) => !previousPanelOpenRef.current[id],
    );
    const keep = newlyOpened.at(-1) ?? openHosts.at(-1);
    if (!keep) return;
    for (const id of openHosts) {
      if (id !== keep) setPanelOpenFlag(id, false);
    }
    previousPanelOpenRef.current = PANEL_IDS.reduce(
      (next, id) => ({ ...next, [id]: id === keep }),
      {} as Record<PanelId, boolean>,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    compactPanels,
    panelOpen.library,
    panelOpen.tools,
    panelOpen.elements,
    panelOpen.properties,
    panelOpen.layers,
    panelOpen.report,
  ]);

  /* ── Docking (per-window, per-edge) ─────────────────────────────────────
   * One window per screen edge. Docking reserves a grid track (the canvas
   * shrinks, never gets covered); undocking gives the space back. The dock
   * side and the strip size are remembered per window.
   */
  const [dockSides, setDockSides] = useState<Partial<Record<PanelId, DockSide>>>(
    () => {
      try {
        const raw = localStorage.getItem(DOCKS_KEY);
        // First visit (or the v3 reset): the two default windows are docked —
        // content tools on the right, properties + layers on the left.
        if (raw === null) return { ...DEFAULT_DOCKS };
        return sanitizeDockSides(JSON.parse(raw) as Partial<Record<PanelId, DockSide>>);
      } catch {
        return { ...DEFAULT_DOCKS };
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
      localStorage.setItem(DOCKS_KEY, JSON.stringify(dockSides));
    } catch {
      /* the layout stays available for this session */
    }
  }, [dockSides]);
  useEffect(() => {
    const reset = () => {
      const groups = defaultWorkspaceGroups();
      setGroupState(groups);
      savePanelGroups(groups);
      setDockSides({ ...DEFAULT_DOCKS });
      setDockSizes({});
      setCollapsedPanels({});
      try {
        localStorage.setItem(DOCKS_KEY, JSON.stringify(DEFAULT_DOCKS));
        localStorage.setItem(COLLAPSED_KEY, "{}");
        localStorage.removeItem("nasaq.panel.dock-sizes.v2");
        for (const id of PANEL_IDS) {
          localStorage.removeItem(`nasaq.panel.${id}.pos.v2`);
          localStorage.removeItem(`nasaq.panel.${id}`);
        }
      } catch {
        /* session state already reset */
      }
      for (const id of PANEL_IDS) setPanelOpenFlag(id, false);
      const touchOrOverlay =
        window.innerWidth < DOCK_BREAKPOINT ||
        window.matchMedia("(any-pointer: coarse)").matches ||
        navigator.maxTouchPoints > 0;
      if (!touchOrOverlay) {
        setPanelOpenFlag(WORKSPACE_RIGHT_GROUP[0], true);
        setPanelOpenFlag(WORKSPACE_LEFT_GROUP[0], true);
      }
    };
    window.addEventListener("nasaq:reset-workspace", reset);
    return () => window.removeEventListener("nasaq:reset-workspace", reset);
  }, []);
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

  const [collapsedPanels, setCollapsedPanels] = useState<
    Partial<Record<PanelId, boolean>>
  >(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "{}") as unknown;
      return raw && typeof raw === "object" ? (raw as Partial<Record<PanelId, boolean>>) : {};
    } catch {
      return {};
    }
  });
  const togglePanelCollapsed = (id: PanelId) => {
    setCollapsedPanels((current) => {
      const next = { ...current, [id]: !current[id] };
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        /* session memory still holds the bar */
      }
      return next;
    });
  };

  const changeDockSide = (id: PanelId, side: DockSide | null) => {
    if (side === "top" || side === "bottom") return;
    const next: Partial<Record<PanelId, DockSide>> = { ...dockSides };
    if (!side) {
      delete next[id];
    } else {
      const opposite: DockSide = side === "left" ? "right" : "left";
      const occupant = PANEL_IDS.find((other) => other !== id && next[other] === side);
      if (occupant) {
        const previous = next[id];
        const dest: DockSide =
          previous === "left" || previous === "right" ? previous : opposite;
        const blocked = PANEL_IDS.find(
          (other) => other !== id && other !== occupant && next[other] === dest,
        );
        if (blocked) delete next[blocked];
        next[occupant] = dest;
      }
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
        // A top/bottom dock is a horizontal BAND (its content flows in
        // columns, see `.is-docked-top` in styles.css), so it opens compact
        // and leaves the artboard its height; the strip resizes it.
        return {
          ...sizes,
          [id]: {
            w: 0,
            h: clampDockSize(
              Math.min(
                stored?.height ?? PANEL_DEFS[id].defaultSize.height,
                DOCK_BAND_H,
              ),
              window.innerHeight,
              DOCK_MIN_H,
            ),
          },
        };
      });
    }
    setDockSides(next);
  };

  /**
   * Two viewport rectangles, each used for the job it can answer correctly.
   * Layout dimensions classify the stable physical surface/orientation, while
   * visual dimensions keep windows inside the actually visible area. A soft
   * keyboard can therefore shrink panel bounds without pretending an iPad
   * portrait workspace has rotated into phone landscape.
   */
  const readLiveViewport = () => {
    if (typeof window === "undefined") {
      return {
        w: 1440,
        h: 900,
        layoutW: 1440,
        layoutH: 900,
        fullscreen: false,
      };
    }
    const vv = window.visualViewport;
    const useVv = Boolean(
      vv && (!vv.scale || vv.scale <= 1.01) && vv.width > 0 && vv.height > 0,
    );
    const doc =
      typeof document !== "undefined"
        ? (document as Document & {
            webkitFullscreenElement?: Element | null;
          })
        : null;
    return {
      w: Math.round(useVv ? vv!.width : window.innerWidth),
      h: Math.round(useVv ? vv!.height : window.innerHeight),
      layoutW: Math.round(window.innerWidth),
      layoutH: Math.round(window.innerHeight),
      fullscreen: Boolean(
        doc?.fullscreenElement || doc?.webkitFullscreenElement,
      ),
    };
  };
  const [vp, setVp] = useState(readLiveViewport);
  useEffect(() => {
    const onResize = () => {
      const next = readLiveViewport();
      setVp((prev) =>
        prev.w === next.w &&
        prev.h === next.h &&
        prev.layoutW === next.layoutW &&
        prev.layoutH === next.layoutH &&
        prev.fullscreen === next.fullscreen
          ? prev
          : next,
      );
      setIsDesktop(next.layoutW >= OVERLAY_BREAKPOINT);
      setCanDock(next.layoutW >= DOCK_BREAKPOINT);
      setIsCompact(next.layoutW <= 600);
    };
    const onOrientationChange = () => {
      onResize();
      setTimeout(onResize, 60);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrientationChange);
    window.screen?.orientation?.addEventListener?.("change", onOrientationChange);
    // iOS Safari keeps the visual viewport changing without firing `resize`
    // under some keyboard/rotation states; the second signal keeps dock
    // clamps honest during fullscreen and rotation.
    window.visualViewport?.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("scroll", onResize);
    document.addEventListener("fullscreenchange", onResize);
    document.addEventListener("webkitfullscreenchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrientationChange);
      window.screen?.orientation?.removeEventListener?.("change", onOrientationChange);
      window.visualViewport?.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("scroll", onResize);
      document.removeEventListener("fullscreenchange", onResize);
      document.removeEventListener("webkitfullscreenchange", onResize);
    };
  }, []);
  /*
   * The resolved 6-mode surface — desktop / tablet-landscape / tablet-portrait /
   * mobile-landscape / mobile-portrait / fullscreen — is the ONLY layout mode
   * the shell and the CSS density scale share.
   */
  const isFullscreenMode = Boolean(focusMode || vp.fullscreen);
  const deviceSurface: EditorSurface = resolveEditorSurface(
    vp.layoutW,
    vp.layoutH,
    coarsePointer,
    false,
  );
  const surface: EditorSurface = resolveEditorSurface(
    vp.layoutW,
    vp.layoutH,
    coarsePointer,
    isFullscreenMode,
  );
  const isMobileSurface =
    deviceSurface === "mobile-portrait" ||
    deviceSurface === "mobile-landscape";
  const [mobileRailExpanded, setMobileRailExpanded] = useState(false);
  useEffect(() => {
    // Each mobile opening starts artboard-first. Expansion stays available for
    // this document without rewriting the author's desktop rail preference.
    setMobileRailExpanded(false);
  }, [deviceSurface, documentRevision]);
  const effectivePagesRailHidden =
    pagesRailHidden ||
    deviceSurface === "mobile-landscape" ||
    isFullscreenMode;
  const effectivePagesRailCollapsed =
    pagesRailCollapsed || (isMobileSurface && !mobileRailExpanded);
  const collapsedRailHeight = coarsePointer ? 44 : PAGES_RAIL_COLLAPSED;
  const effectiveRailHeight = effectivePagesRailCollapsed
    ? collapsedRailHeight
    : deviceSurface === "mobile-landscape"
      ? Math.min(pagesPanelHeight, 76)
      : pagesPanelHeight;
  const toggleEffectivePagesRail = useCallback(() => {
    if (!isMobileSurface) {
      useEditor.getState().togglePagesRail();
      return;
    }
    if (effectivePagesRailCollapsed) {
      if (useEditor.getState().pagesRailCollapsed)
        useEditor.getState().togglePagesRail();
      setMobileRailExpanded(true);
    } else {
      setMobileRailExpanded(false);
    }
  }, [effectivePagesRailCollapsed, isMobileSurface]);
  /*
   * Accidental zoom is fixed at the APP level — once, here — not per tool.
   *
   * Three leaks used to let a stray pinch resize the whole interface:
   *  · iOS `gesture*` events fired by Safari on any surface (the canvas stage
   *    guarded them, the header and the docks did not),
   *  · trackpad/pinch Ctrl+wheel landing on chrome, which the browser reads as
   *    a page zoom (the canvas owns the INTENTIONAL zoom gesture and is left
   *    alone; the shell-level wheel listener is `{ passive: false }` so the
   *    chrome can call preventDefault without touching the document),
   *  · double-tap zoom, killed by `touch-action` on `.editor-ui` in CSS.
   * None of this reaches outside the editor: browser zoom stays fully
   * available on every other page, and the shell's own scrollable panes keep
   * one-finger scroll.
   */
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const claim = (event: Event) => event.preventDefault();
    const GESTURE_EVENTS = ["gesturestart", "gesturechange", "gestureend"] as const;
    for (const type of GESTURE_EVENTS)
      shell.addEventListener(type, claim, { passive: false });
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target as HTMLElement | null;
      // The canvas stage runs its own anchored zoom; chrome never zooms the app.
      if (target?.closest(".editor-canvas-stage")) return;
      event.preventDefault();
    };
    shell.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      for (const type of GESTURE_EVENTS)
        shell.removeEventListener(type, claim);
      shell.removeEventListener("wheel", onWheel);
    };
  }, []);

  /*
   * One-time layout reset to the shipped arrangement (v2): every author sees
   * the content window pinned on the right and the inspector window on the
   * left the first time this build loads, whatever their old flags said.
   * After that, the saved layout is theirs again.
   */
  useEffect(() => {
    // The shipped two-window arrangement belongs only to a real desktop. Do
    // not consume its one-time migration key while the same account is opening
    // on a phone/tablet; those surfaces are transiently artboard-first below.
    if (!hydrated || installedApp || deviceSurface !== "desktop") return;
    try {
      if (localStorage.getItem(LAYOUT_APPLIED_KEY)) return;
      localStorage.setItem(LAYOUT_APPLIED_KEY, "1");
    } catch {
      return;
    }
    const groups = defaultWorkspaceGroups();
    setGroupState(groups);
    setDockSides({ ...DEFAULT_DOCKS });
    for (const id of PANEL_IDS) setPanelOpenFlag(id, false);
    setPanelOpenFlag(WORKSPACE_RIGHT_GROUP[0], true);
    setPanelOpenFlag(WORKSPACE_LEFT_GROUP[0], true);
  }, [hydrated, deviceSurface, installedApp]);

  const widePanelLayoutRef = useRef<
    | {
        leftOpen: boolean;
        rightOpen: boolean;
        layersOpen: boolean;
        reportToolsOpen: boolean;
        libraryOpen: boolean;
        toolsOpen: boolean;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    if (!hydrated) return;
    if (deviceSurface === "desktop" && !installedApp) {
      if (widePanelLayoutRef.current) {
        useEditor.setState(widePanelLayoutRef.current);
        widePanelLayoutRef.current = undefined;
      }
      return;
    }
    // A compact opening is canvas-first, but this is intentionally transient:
    // visiting the same project on a phone must not erase its desktop layout.
    if (!widePanelLayoutRef.current) {
      const state = useEditor.getState();
      widePanelLayoutRef.current = {
        leftOpen: state.leftOpen,
        rightOpen: state.rightOpen,
        layersOpen: state.layersOpen,
        reportToolsOpen: state.reportToolsOpen,
        libraryOpen: state.libraryOpen,
        toolsOpen: state.toolsOpen,
      };
    }
    closePanelHosts();
  }, [closePanelHosts, deviceSurface, documentRevision, hydrated, installedApp]);

  /** Which window (if any) currently occupies each screen edge. */
  const dockW = (id: PanelId) =>
    collapsedPanels[id]
      ? COLLAPSED_TRACK
      : clampDockSize(
          dockSizes[id]?.w || PANEL_DEFS[id].defaultSize.width,
          vp.w,
          DOCK_MIN_W,
        );
  const dockH = (id: PanelId) =>
    collapsedPanels[id]
      ? COLLAPSED_TRACK
      : clampDockSize(
          dockSizes[id]?.h || PANEL_DEFS[id].defaultSize.height,
          vp.h,
          DOCK_MIN_H,
        );
  const requestedDock: Partial<Record<DockSide, PanelId>> = {};
  if (isDesktop && canDock && !focusMode && !cropActive) {
    for (const id of hosts) {
      const side = dockSides[id];
      if (side && panelOpen[id]) requestedDock[side] = id;
    }
  }
  /*
   * Two full side docks crush an iPad portrait page. Fit them against a
   * canvas floor; the dock that cannot stay becomes a movable floating
   * window instead of a grid track.
   */
  const sideFit = fitSideDockWidths(
    vp.w,
    requestedDock.left ? dockW(requestedDock.left) : null,
    requestedDock.right ? dockW(requestedDock.right) : null,
    DOCK_MIN_W,
    Math.max(300, Math.round(vp.w * 0.42)),
  );
  const dockedBySide: Partial<Record<DockSide, PanelId>> = {
    ...requestedDock,
  };
  if (requestedDock.left && sideFit.left == null) delete dockedBySide.left;
  if (requestedDock.right && sideFit.right == null) delete dockedBySide.right;
  const visibleDock = (id: PanelId): boolean =>
    dockedBySide.left === id ||
    dockedBySide.right === id ||
    dockedBySide.top === id ||
    dockedBySide.bottom === id;

  /*
   * A fingerprint of the docked layout. When it changes (a window docks,
   * undocks, or swaps edges) the canvas gains or loses a track, so the shell
   * re-fits the artboard to the new space — the same refit the tablet
   * boundary triggers.
   */
  const dockSignature = hosts
    .map((id) =>
      visibleDock(id)
        ? `${id}:${dockSides[id]}:${collapsedPanels[id] ? "c" : "o"}`
        : id,
    )
    .join("|");

  /*
   * The workspace grid. In this RTL shell the FIRST column sits on the
   * physical RIGHT edge, so a right-docked window is column 1 and a
   * left-docked one the last column. Rows are physical: top dock = row 1,
   * bottom dock = last row. With nothing docked it is a single full-width
   * track and the canvas owns the whole workspace.
   */
  const workspaceCols: string[] = [];
  if (dockedBySide.right)
    workspaceCols.push(`${sideFit.right ?? dockW(dockedBySide.right)}px`);
  workspaceCols.push("minmax(0, 1fr)");
  if (dockedBySide.left)
    workspaceCols.push(`${sideFit.left ?? dockW(dockedBySide.left)}px`);
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
          title={PANEL_META[groupState.tabs[id] ?? id].title}
          side={PANEL_DEFS[id].side}
          open
          onClose={() => setPanelOpenFlag(id, false)}
          dockSide={side}
          onDockSideChange={(next) => changeDockSide(id, next)}
          collapsed={Boolean(collapsedPanels[id])}
          onToggleCollapsed={() => togglePanelCollapsed(id)}
          gridAreaStyle={{ width: "100%", height: "100%" }}
        >
          {renderPanelBody(id)}
        </FloatingPanel>
        {stripSide && !collapsedPanels[id] && (
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
        {stripSide === undefined && !collapsedPanels[id] && (
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

  /** One panel's own content — the tab strip composes these in a window. */
  const renderPanelContent = (id: PanelId) => {
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
            onOpenShapes={() => openLeftTab("shapes")}
            onOpenTemplates={() => openLeftTab("templates")}
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
   * Window body: the group's tab strip above the active panel's content.
   * A single-panel window still shows the strip — it is the drop zone the
   * FIRST grouping drag needs, and it keeps every window one consistent
   * shape instead of two different looks.
   */
  const renderPanelBody = (id: PanelId) => (
    <div className="flex h-full min-h-0 flex-col">
      <PanelTabStrip
        host={id}
        compact={compactPanels}
        state={groupState}
        onSelect={(tab) => selectTab(id, tab)}
        onDropTab={dropTab}
        onDetach={detachTab}
      />
      <div className="min-h-0 flex-1">
        {renderPanelContent(groupState.tabs[id] ?? id)}
      </div>
    </div>
  );

  /** Toolbar shortcuts to a panel tab: open (and un-collapse) that panel. */
  const openLeftTab = (tab: LeftTab) => {
    if (useEditor.getState().focusMode) toggle("focusMode");
    // setLeftTab routes «library»/«tools» to their own windows.
    useEditor.getState().setLeftTab(tab);
    // Resolve EVERY child through its current host. Merely setting leftOpen
    // fails when Elements is an inactive tab in an already-open custom group.
    revealPanel(tab === "library" || tab === "tools" ? tab : "elements");
  };

  /**
   * Explicit surface navigation. Same strip as the site: a press opens or
   * closes a window. It never depends on an edge swipe or a hamburger.
   * «الصفحات» reveals the pages tab inside لوحة العناصر and the page rail.
   */
  const onSurfaceNav = (id: string) => {
    // «نَسَق AI» is one window for every capability — the hub owns its state.
    if (id === "ai") {
      if (useEditor.getState().focusMode) toggle("focusMode");
      toggleNasaqAi();
      return;
    }
    if (isEditorElementTab(id)) {
      if (editorSurfaceActive(id, useEditor.getState().leftTab, panelChecked) && !focusMode) {
        togglePanelWindow("elements");
        return;
      }
      openLeftTab(id);
      if (id === "pages" && useEditor.getState().pagesRailHidden)
        useEditor.getState().togglePagesRailHidden();
      return;
    }
    if (useEditor.getState().focusMode) toggle("focusMode");
    if ((PANEL_IDS as readonly string[]).includes(id))
      togglePanelWindow(id as PanelId);
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
    revealPanel("report");
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
    // Always establish the designed opening camera. Persisted zoom is useful
    // while staying in a document, but is not a safe default for a different
    // page shape, device, orientation or newly available canvas lane.
    const timer = window.setTimeout(() => fitRef.current(), 70);
    return () => window.clearTimeout(timer);
  }, [
    isDesktop,
    canDock,
    hydrated,
    dockSignature,
    surface,
    vp.layoutW,
    vp.layoutH,
  ]);

  // Exactly one shared View gateway: desktop keeps it with document actions;
  // mobile moves that same gateway beside the thumb tools so zoom/fit never
  // requires reaching to the top edge.
  const workspaceViewMenu = (
    <ViewMenu
      fitToScreen={fitToScreen}
      fitToSelection={fitToSelection}
      panelChecked={panelChecked}
      onTogglePanel={togglePanelWindow}
      dockPref={dockPref}
      onDockPref={changeDockPref}
    />
  );

  return (
    /*
     * Editor shell.
     *
     * Rows are `auto` (header) + `minmax(0,1fr)` (workspace), so the single
     * header line never steals height from the canvas — not even on a phone,
     * where it folds to two deliberate rows of its own.
     */
    <div
      ref={shellRef}
      dir="rtl"
      data-editor-surface={surface}
      data-device-surface={deviceSurface}
      data-installed-app={installedApp ? "true" : undefined}
      className={cn(
        "editor-ui editor-shell grid grid-rows-[auto_minmax(0,1fr)]",
        appearance === "light" ? "editor-light" : "editor-dark",
        appearance === "dim" && "editor-dim",
        isFullscreenMode && "editor-focus",
      )}
    >
      {/*
       * Toolbar — three zones, icon-first, one line at every width.
       *
       * The canvas is the product, so the bar keeps only what belongs to the
       * DOCUMENT: history, the scaling cluster, the document name, and the
       * document actions (view options, save, project file, export, account).
       *
       * Insert actions stay in «إضافة»; appearance has its own permanent
       * icon-first control, while «عرض» keeps zoom, workspace and panel options.
       * Selection-only actions stay in the contextual toolbar and context menu,
       * not in permanent Properties rows.
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
      {/* One-time offer to install the editor as a desktop app. */}
      <AppInstallNotice />
      {/*
       * Phone workspace: the first run names the gestures and the dock, so the
       * mobile layout is an explained instrument rather than a row of icons.
       */}
      {isMobileSurface && <MobileWorkspaceGuide />}
      <header
        ref={headerRef}
        data-editor-obstacle="header"
        className="editor-toolbar editor-toolbar-stack z-[var(--z-bubble)] border-b px-3 py-1.5 pr-[max(0.75rem,var(--safe-right))] pl-[max(0.75rem,var(--safe-left))] pt-[max(0.375rem,var(--safe-top))]"
      >
        <div className="editor-toolbar-main">
        {/* ① History and the single scaling cluster. */}
        <div
          className="editor-header-zone editor-header-primary editor-mobile-tools"
          data-editor-mobile-dock="tools"
        >
          {!isMobileSurface && (
            <>
              {/*
               * The NASAQ mark in the editor is ONE thing: the door back to the
               * main workspace. It links to /workspace only — never «الرئيسية»
               * marketing, never a new-document state, never a document reset.
               * It still passes through the leave guard, so a dirty document is
               * asked about before the door opens.
               */}
              <a
                href={WORKSPACE_HOME_PATH}
                className="editor-brand-mark"
                title="نَسَق | NASAQ — العودة إلى مساحة العمل"
                aria-label="العودة إلى مساحة عمل نَسَق الرئيسية"
                onClick={leaveEditor}
              >
                <BrandLogo compact markOnly />
              </a>
              <span className="editor-header-sep" aria-hidden />
            </>
          )}
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
          {/* ①½ The tool cluster — ONE select/crop tool plus the paint and
              draw tools. The region shape (rectangle, square, ellipse,
              freeform) is a compact dropdown inside the select cell, never a
              row of near-identical buttons; crop itself is not a tool at all,
              only what an armed region does over an image, with an ephemeral
              Apply/Cancel. Every button writes the single tool store, so the
              header and the canvas can never disagree about what is armed. */}
          <span className="editor-header-sep" aria-hidden />
          <div
            className="editor-tool-cluster"
            role="group"
            aria-label="أدوات التحديد والرسم"
          >
            <SelectCropTool activeTool={activeTool} activeMode={activeRegionMode} />
            <span className="editor-header-sep" aria-hidden />
            {(["brush", "eraser"] as const).map((id) => {
              const def = toolDef(id);
              const Glyph = PAINT_ICONS[id];
              return (
                <IconButton
                  key={id}
                  label={def.label}
                  hint={def.hint}
                  shortcut={def.shortcut}
                  active={activeTool === id}
                  icon={<Glyph className="size-4" strokeWidth={1.7} />}
                  onClick={() =>
                    useTools.getState().setTool(activeTool === id ? "select" : id)
                  }
                />
              );
            })}
            <span className="editor-header-sep" aria-hidden />
            {(["text", "shape"] as const).map((id) => {
              const def = toolDef(id);
              const Glyph = PAINT_ICONS[id];
              return (
                <IconButton
                  key={id}
                  label={def.label}
                  hint={def.hint}
                  shortcut={def.shortcut}
                  active={activeTool === id}
                  icon={<Glyph className="size-4" strokeWidth={1.7} />}
                  onClick={() => {
                    if (id === "text") openLeftTab("elements");
                    if (id === "shape") openLeftTab("shapes");
                    useTools.getState().setTool(activeTool === id ? "select" : id);
                  }}
                />
              );
            })}
          </div>
          {!isMobileSurface && (
            <>
              <span className="editor-header-sep" aria-hidden />
              <IconButton
                label="الخصائص"
                hint="فتح خصائص العنصر المحدد"
                active={panelChecked.properties && !focusMode && !cropActive}
                icon={
                  <SlidersHorizontal className="size-4" strokeWidth={1.7} />
                }
                onClick={() => togglePanelWindow("properties")}
              />
              {/* Paint: selection fill/border or the page background. Mobile
                  keeps the same controls in the Properties surface. */}
              <span className="editor-header-sep" aria-hidden />
              <HeaderPaint />
            </>
          )}
          {/* On a phone the stepper gives way to «عرض», which carries the same
              commands, so history and export are never pushed off screen. */}
          {!isCompact && !isMobileSurface && (
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
          {isMobileSurface && (
            <>
              <span className="editor-header-sep" aria-hidden />
              {workspaceViewMenu}
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
          {!isCompact && !isMobileSurface && (
            <IconButton
              label="المكتبة"
              hint="صورك، شعاراتك وملفات SVG المحفوظة"
              className="editor-header-library"
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
          {!isMobileSurface && workspaceViewMenu}
          {/* Permanent icon-first appearance gateway on every surface. */}
          <AppearanceMenu />
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
        </div>
        <ProductNav
          className="editor-surface-nav editor-mobile-surface-dock"
          label="أدوات المحرر"
          items={EDITOR_SURFACE_NAV}
          isActive={(id) =>
            !focusMode && !cropActive && editorSurfaceActive(id, leftTab, panelChecked)
          }
          onSelect={onSurfaceNav}
        />
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
          {/* A blank-canvas tap dismisses the one touch drawer; owned element,
              Pencil and transform gestures remain entirely inside CanvasStage. */}
          <CanvasStage
            onDropImage={onDropImage}
            onCanvasTap={
              compactPanels ? closePanelHosts : undefined
            }
          />
          {/* Properties of the live tool, docked to the canvas — never a second
              copy of the same setting, and never shown for a tool that has none. */}
          <ToolPropertiesBar />
          {!effectivePagesRailHidden && !effectivePagesRailCollapsed && (
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
              height: effectivePagesRailHidden ? 0 : effectiveRailHeight,
            }}
          >
            {!effectivePagesRailHidden && (
              <PageRail
                height={effectiveRailHeight}
                minHeight={PAGES_PANEL_MIN}
                collapsed={effectivePagesRailCollapsed}
                onToggleCollapsed={toggleEffectivePagesRail}
              />
            )}
          </div>
          {deviceSurface !== "mobile-landscape" && <WorkspaceStatusBar />}
        </div>
        {dockedBySide.left && renderDockedWindow(dockedBySide.left, "left")}
        {dockedBySide.right && renderDockedWindow(dockedBySide.right, "right")}
        {dockedBySide.bottom && renderDockedWindow(dockedBySide.bottom, "bottom")}

        {/* Floating (undocked) windows — absolute overlays over the workspace. */}
        {hosts.filter((id) => !visibleDock(id)).map((id) => (
          <FloatingPanel
            key={id}
            storageKey={`nasaq.panel.${id}`}
            title={PANEL_META[groupState.tabs[id] ?? id].title}
            side={PANEL_DEFS[id].side}
            open={panelOpen[id] && !cropActive && !focusMode}
            drawer={isMobileSurface}
            onClose={() => setPanelOpenFlag(id, false)}
            onDockSideChange={(side) => changeDockSide(id, side)}
            collapsed={Boolean(collapsedPanels[id])}
            onToggleCollapsed={() => togglePanelCollapsed(id)}
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
      <PageSettingsHost />
      <NewPageHost />

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
      <NasaqAiHub />
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
