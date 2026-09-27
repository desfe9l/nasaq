import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import {
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  FolderOpen,
  ImagePlus,
  Layers,
  Minus,
  MoreHorizontal,
  RotateCcw,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  MousePointer2,
  Palette,
  SeparatorHorizontal,
  Shapes,
  SlidersHorizontal,
  Square,
  SquareDashedMousePointer,
  Type,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { loadToolDockConfig, saveToolDockConfig, resetToolDockConfig, type ToolDockItemConfig } from "@/lib/editor/tool-dock-config";
import { useEditor, type LeftTab, type RightTab } from "@/lib/editor/store";

type DrawTool = "text" | "rect" | null;
type FlyoutName = "text" | "shapes" | "colors" | "connectors";

const DEFAULT_COLORS = { foreground: "#2563eb", background: "#f4f5f6" } as const;
/** Long-press delay for tool submenus (touch, pen, and a held mouse button). */
const HOLD_MS = 450;
const HEX = /^#[\da-f]{6}$/i;

/**
 * Small corner triangle, Photoshop-style, marking a tool that has a flyout.
 * Drawn as vector so it stays crisp at every zoom and in both themes.
 */
function FlyoutMark() {
  return (
    <svg className="tool-dock-flyout-mark" viewBox="0 0 6 6" aria-hidden="true" focusable="false">
      <path d="M6 0 L6 6 L0 6 Z" fill="currentColor" />
    </svg>
  );
}

/** Swap arrows for the fill/stroke swatches (vector, 1.5px stroke). */
function SwapGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M2.5 4.5h6M7 2.5l2 2-2 2M9.5 7.5h-6M5 5.5l-2 2 2 2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Default-colours glyph: two tiny overlapping squares. */
function ResetGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <rect x="4.5" y="4.5" width="6" height="6" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1.5" y="1.5" width="6" height="6" rx="0.5" fill="currentColor" />
    </svg>
  );
}

/**
 * The unified toolbox («Click & Draw» rail).
 *
 * ONE slim, expandable rail merges what used to be scattered across bars:
 *
 *   Primary drawer (top)   — Select (arrow), Text (T) and Shapes (square),
 *     the direct-creation modes: click the tool, then drag the shape right
 *     out on the canvas. Each carries an explicit chevron that opens its
 *     flyout (long-press/right-click still work).
 *   Secondary drawer       — grouped by function, never duplicated: media
 *     upload (+image, or drop a file onto the canvas), project files (.nsq),
 *     then the panel gateways — layers stack, properties/settings, colour
 *     palette and connectors — separated by dividers.
 *   Width toggle («/»)     — collapses/expands the rail, touch-friendly.
 *
 * Every tool dispatches the exact same event (`nasaq:tool`) or store action
 * the header, the keyboard map (V / T / R) and the command palette already
 * use — the dock is another way to reach them, never a second
 * implementation.
 *
 * Desktop: its own grid track between the panels and the canvas.
 * Tablet (`floating`): a floating rail inside the canvas area only, so it can
 * never cover the page rail, the status bar or the side drawers.
 */
export function StudioToolDock({
  onOpenLeft,
  onOpenRight,
  onUploadImage,
  onOpenFiles,
  floating = false,
}: {
  onOpenLeft: (tab: LeftTab) => void;
  onOpenRight: (tab: RightTab) => void;
  onUploadImage: () => void;
  /** «ملفات المشروع» — opens a `.nsq` straight into the workspace. */
  onOpenFiles: () => void;
  floating?: boolean;
}) {
  const [wide, setWide] = useState(() => {
    try { return localStorage.getItem("nasaq.tool-dock-wide") === "true"; } catch { return false; }
  });
  const [dockConfig, setDockConfig] = useState<ToolDockItemConfig[]>(loadToolDockConfig);
  const [customizing, setCustomizing] = useState(false);
  const [activeTool, setActiveTool] = useState<DrawTool>(null);
  const [flyout, setFlyout] = useState<{ name: FlyoutName; top: number } | null>(null);
  const [tip, setTip] = useState<{ label: string; shortcut: string; top: number } | null>(null);
  const dockRef = useRef<HTMLElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldFlyout = useRef(false);
  const foregroundInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const selected = useEditor((s) => s.selectedElements()[0]);
  const selectedId = selected?.id;
  const selectedType = selected?.type;
  const selectedFill = selected?.style?.fill;
  const selectedColor = selected?.style?.color;
  const selectedBackground = selected?.style?.background;
  const selectedBorder = selected?.style?.borderColor;
  const selectedStroke = selected?.style?.svgStroke;
  const [colors, setColors] = useState<{ foreground: string; background: string }>({ ...DEFAULT_COLORS });
  const foreground = selectedFill || selectedColor || selectedBackground || colors.foreground;
  const background = selectedBorder || selectedStroke || colors.background;

  useEffect(() => {
    if (!selectedId) return;
    setColors((current) => ({
      foreground: selectedFill || selectedColor || selectedBackground || current.foreground,
      background: selectedBorder || selectedStroke || current.background,
    }));
  }, [selectedId, selectedFill, selectedColor, selectedBackground, selectedBorder, selectedStroke]);

  // Mirror the canvas tool state (it is armed from the header, the keyboard,
  // the command palette and the text-draw shortcut too).
  useEffect(() => {
    const onTool = (event: Event) => {
      const tool = (event as CustomEvent<DrawTool>).detail;
      setActiveTool(tool ?? null);
    };
    const onDrawText = () => setActiveTool("text");
    window.addEventListener("nasaq:tool", onTool);
    window.addEventListener("nasaq:draw-text", onDrawText);
    return () => {
      window.removeEventListener("nasaq:tool", onTool);
      window.removeEventListener("nasaq:draw-text", onDrawText);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setActiveTool(null);
      setFlyout(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (selectedId) setActiveTool(null);
  }, [selectedId]);

  // A flyout closes on any press outside the dock (mouse, touch or pen).
  useEffect(() => {
    if (!flyout) return;
    const onDown = (event: PointerEvent) => {
      if (dockRef.current?.contains(event.target as Node)) return;
      setFlyout(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [flyout]);

  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  /** Offset of a control inside the dock, for flyouts/tooltips rendered at dock level (outside the scrolling tool list, so they are never clipped). */
  const offsetOf = (node: HTMLElement) => {
    const dock = dockRef.current?.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    return dock ? rect.top - dock.top : 0;
  };

  const setLayout = () => setWide((current) => {
    const next = !current;
    try { localStorage.setItem("nasaq.tool-dock-wide", String(next)); } catch { /* storage is optional */ }
    return next;
  });
  const arm = (tool: DrawTool) => window.dispatchEvent(new CustomEvent("nasaq:tool", { detail: tool }));
  const openFlyout = (name: FlyoutName, node: HTMLElement, toggle = true) => {
    setTip(null);
    setFlyout((current) => (toggle && current?.name === name ? null : { name, top: offsetOf(node) }));
  };
  const startHold = (name: FlyoutName, node: HTMLElement) => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    heldFlyout.current = false;
    holdTimer.current = setTimeout(() => {
      heldFlyout.current = true;
      openFlyout(name, node, false);
    }, HOLD_MS);
  };
  const stopHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  const holdHandlers = (name: FlyoutName) => ({
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      startHold(name, event.currentTarget);
    },
    onPointerUp: stopHold,
    onPointerCancel: () => { stopHold(); heldFlyout.current = false; },
    onPointerLeave: stopHold,
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      stopHold();
      openFlyout(name, event.currentTarget);
    },
  });
  /** Swallows the click that ends a long-press, so opening a submenu never also fires the tool. */
  const consumeHeldClick = (event: React.MouseEvent) => {
    if (!heldFlyout.current) return false;
    heldFlyout.current = false;
    event.preventDefault();
    return true;
  };

  const patchFor = (key: "foreground" | "background", color: string) => {
    const isText = ["text", "box", "stat", "stamp", "table", "progress"].includes(selectedType || "");
    return key === "foreground"
      ? (isText ? { color } : { fill: color })
      : { borderColor: color, svgStroke: color };
  };
  const colorChange = (key: "foreground" | "background", color: string) => {
    setColors((current) => ({ ...current, [key]: color }));
    if (!selectedId) return;
    useEditor.getState().updateStyle(selectedId, patchFor(key, color));
  };
  /** Both swatches change in one store update, so the swap is a single undo step. */
  const applyPair = (next: { foreground: string; background: string }) => {
    setColors(next);
    if (!selectedId) return;
    useEditor.getState().updateStyle(selectedId, {
      ...patchFor("foreground", next.foreground),
      ...patchFor("background", next.background),
    });
  };
  const swapColors = () => applyPair({ foreground: background, background: foreground });
  const resetColors = () => applyPair({ ...DEFAULT_COLORS });
  const openPicker = (input: HTMLInputElement | null) => {
    if (!input) return;
    try {
      if (typeof input.showPicker === "function") { input.showPicker(); return; }
    } catch { /* fall back to click */ }
    input.click();
  };

  const showTip = (node: HTMLElement, label: string, shortcut: string) => {
    if (flyout) return;
    setTip({ label, shortcut, top: offsetOf(node) });
  };

  const toolButton = (
    name: string,
    Icon: LucideIcon,
    label: string,
    shortcut: string,
    action: () => void,
    active = false,
    submenu?: FlyoutName,
  ) => (
    <button
      key={name}
      type="button"
      className={cn("tool-dock-button", active && "is-active", submenu && flyout?.name === submenu && "is-open")}
      aria-label={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active}
      aria-haspopup={submenu ? "menu" : undefined}
      aria-expanded={submenu ? flyout?.name === submenu : undefined}
      aria-keyshortcuts={shortcut || undefined}
      onClick={(event) => {
        if (consumeHeldClick(event)) return;
        setFlyout(null);
        action();
      }}
      onKeyDown={(event) => {
        if (!submenu) return;
        if (event.key === "ArrowDown" || event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          openFlyout(submenu, event.currentTarget, false);
        }
      }}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") showTip(event.currentTarget, label, shortcut); }}
      onMouseLeave={() => setTip(null)}
      onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) showTip(event.currentTarget, label, shortcut); }}
      onBlur={() => setTip(null)}
      {...(submenu ? holdHandlers(submenu) : {})}
    >
      <Icon className="tool-dock-icon" strokeWidth={1.6} aria-hidden="true" />
      {submenu && <FlyoutMark />}
    </button>
  );

  /**
   * Primary creation tool: a two-part control.
   *
   * The main hit area arms «Click & Draw» instantly (draw a text box / a
   * square right on the canvas); the explicit chevron opens the mode flyout
   * on a plain tap, so the submenu is discoverable instead of hidden behind
   * a long-press alone.
   */
  const splitTool = (
    name: string,
    Icon: LucideIcon,
    label: string,
    shortcut: string,
    action: () => void,
    active: boolean,
    submenu: FlyoutName,
  ) => (
    <div key={name} className="tool-dock-split">
      {toolButton(name, Icon, label, shortcut, action, active, submenu)}
      <button
        type="button"
        className="tool-dock-chevron"
        aria-label={`${label} — فتح القائمة الفرعية`}
        aria-haspopup="menu"
        aria-expanded={flyout?.name === submenu}
        onClick={(event) => {
          const anchor = event.currentTarget.closest<HTMLElement>(".tool-dock-split");
          openFlyout(submenu, anchor ?? event.currentTarget);
        }}
      >
        <ChevronDown className="size-[9px]" strokeWidth={2.4} aria-hidden />
      </button>
    </div>
  );

  const menuItem = (Icon: ComponentType<{ className?: string; strokeWidth?: number }>, label: string, onSelect: () => void, hint?: string) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => { setFlyout(null); onSelect(); }}
    >
      <span className="tool-dock-menu-icon"><Icon className="size-4" strokeWidth={1.6} /></span>
      <span className="tool-dock-menu-label">{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  );

  const menuRef = useCallback((node: HTMLDivElement | null) => {
    node?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, []);

  return (
    <aside
      ref={dockRef}
      className={cn("studio-tool-dock", wide && "is-wide", floating && "is-floating")}
      aria-label="شريط الأدوات"
      // The dock is chrome, not canvas: a right-click / long-press here must
      // never open the workspace's element context menu behind it.
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        className="tool-dock-layout"
        onClick={setLayout}
        aria-label={wide ? "تصغير شريط الأدوات إلى عمود واحد" : "توسيع شريط الأدوات إلى عمودين"}
        aria-pressed={wide}
        onPointerEnter={(event) => { if (event.pointerType === "mouse") showTip(event.currentTarget, wide ? "عمود واحد" : "عمودان", ""); }}
        onMouseLeave={() => setTip(null)}
      >
        {wide ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
      </button>
      <div className="tool-dock-tools" onScroll={() => { setTip(null); setFlyout(null); }}>
        {dockConfig
          .filter((t) => t.visible && t.category !== "extra")
          .map((item) => {
            switch (item.id) {
              case "select":
                return toolButton("select", MousePointer2, "تحديد وتحريك", "V", () => arm(null), activeTool === null);
              case "text":
                return splitTool("text", Type, "نص بالرسم", "T", () => { onOpenLeft("elements"); arm("text"); }, activeTool === "text", "text");
              case "shape":
                return splitTool("shape", Square, "رسم مربع / أشكال", "R", () => { onOpenLeft("shapes"); arm("rect"); }, activeTool === "rect", "shapes");
              case "image":
                return toolButton("image", ImagePlus, "الوسائط — صورة (إفلات حر على اللوحة)", "", onUploadImage);
              case "files":
                return toolButton("files", FolderOpen, "ملفات المشروع — فتح ملف .nsq", "⌘O", onOpenFiles);
              case "layers":
                return toolButton("layers", Layers, "الطبقات", "", () => onOpenRight("layers"));
              case "properties":
                return toolButton("properties", SlidersHorizontal, "الخصائص والإعدادات", "", () => onOpenRight("properties"));
              case "colors":
                return toolButton("colors", Palette, "لوحة الألوان — تعبئة وإطار", "", () => openPicker(foregroundInput.current));
              default:
                return null;
            }
          })}
        {dockConfig.some((t) => t.visible && t.category === "extra") && (
          <>
            <span className="tool-dock-sep" aria-hidden="true" />
            {dockConfig
              .filter((t) => t.visible && t.category === "extra")
              .map((item) => {
                if (item.id === "connectors") {
                  return splitTool("connectors", Waypoints, "الموصلات والخطوط", "", () => onOpenLeft("shapes"), false, "connectors");
                }
                return null;
              })}
          </>
        )}
        <span className="tool-dock-sep" aria-hidden="true" />
        <button
          type="button"
          className="tool-dock-btn"
          title="تخصيص شريط الأدوات"
          aria-label="تخصيص شريط الأدوات"
          onClick={() => setCustomizing(true)}
          onPointerEnter={(e) => { if (e.pointerType === "mouse") showTip(e.currentTarget, "تخصيص الأدوات", ""); }}
          onMouseLeave={() => setTip(null)}
        >
          <MoreHorizontal className="tool-dock-icon" strokeWidth={1.6} />
        </button>
      </div>

      {/*
       * Foreground (fill) over background (stroke), overlapping like Photoshop.
       * Each swatch is a <label> for its colour input, so a click or tap opens
       * the native picker on every browser (including iPadOS Safari). A
       * long-press / right-click opens the colour submenu (swap, defaults).
       */}
      <div
        className={cn("tool-dock-colors", flyout?.name === "colors" && "is-open")}
        role="group"
        aria-label="ألوان التعبئة والإطار"
        {...holdHandlers("colors")}
      >
        <button
          type="button"
          className="tool-color-mini tool-color-swap"
          onClick={(event) => { if (!consumeHeldClick(event)) swapColors(); }}
          aria-label="تبديل لون التعبئة ولون الإطار"
          onPointerEnter={(event) => { if (event.pointerType === "mouse") showTip(event.currentTarget, "تبديل التعبئة والإطار", ""); }}
          onMouseLeave={() => setTip(null)}
        >
          <SwapGlyph />
        </button>
        <label
          className="tool-color-swatch tool-color-background"
          aria-label="لون الإطار"
          onClick={(event) => { consumeHeldClick(event); }}
          onPointerEnter={(event) => { if (event.pointerType === "mouse") showTip(event.currentTarget, "لون الإطار", ""); }}
          onMouseLeave={() => setTip(null)}
        >
          <span className="tool-color-chip is-stroke" style={{ borderColor: background }} aria-hidden="true" />
          <input
            ref={backgroundInput}
            type="color"
            value={HEX.test(background) ? background : DEFAULT_COLORS.background}
            aria-label="اختيار لون الإطار"
            onChange={(event) => colorChange("background", event.target.value)}
          />
        </label>
        <label
          className="tool-color-swatch tool-color-foreground"
          aria-label="لون التعبئة"
          onClick={(event) => { consumeHeldClick(event); }}
          onPointerEnter={(event) => { if (event.pointerType === "mouse") showTip(event.currentTarget, "لون التعبئة", ""); }}
          onMouseLeave={() => setTip(null)}
        >
          <span className="tool-color-chip is-fill" style={{ backgroundColor: foreground }} aria-hidden="true" />
          <input
            ref={foregroundInput}
            type="color"
            value={HEX.test(foreground) ? foreground : DEFAULT_COLORS.foreground}
            aria-label="اختيار لون التعبئة"
            onChange={(event) => colorChange("foreground", event.target.value)}
          />
        </label>
        <button
          type="button"
          className="tool-color-mini tool-color-reset"
          onClick={(event) => { if (!consumeHeldClick(event)) resetColors(); }}
          aria-label="الألوان الافتراضية"
          onPointerEnter={(event) => { if (event.pointerType === "mouse") showTip(event.currentTarget, "الألوان الافتراضية", ""); }}
          onMouseLeave={() => setTip(null)}
        >
          <ResetGlyph />
        </button>
        <FlyoutMark />
      </div>

      {tip && !flyout && (
        <div className="tool-dock-tip" style={{ top: tip.top }} role="tooltip">
          <span>{tip.label}</span>
          {tip.shortcut && <kbd>{tip.shortcut}</kbd>}
        </div>
      )}

      {flyout && (
        <div
          ref={menuRef}
          className={cn("tool-dock-flyout", flyout.name === "colors" && "is-bottom")}
          style={flyout.name === "colors" ? undefined : { top: flyout.top }}
          role="menu"
          aria-label={flyout.name === "text" ? "أدوات النص" : flyout.name === "shapes" ? "أدوات الأشكال" : flyout.name === "connectors" ? "الموصلات والخطوط" : "الألوان"}
        >
          {flyout.name === "text" && (
            <>
              {menuItem(Type, "نص بالرسم", () => { onOpenLeft("elements"); arm("text"); }, "T")}
              {menuItem(SquareDashedMousePointer, "مربع محتوى", () => useEditor.getState().addElement("box"))}
            </>
          )}
          {flyout.name === "shapes" && (
            <>
              {menuItem(Square, "رسم مربع — انقر واسحب على اللوحة", () => { onOpenLeft("shapes"); arm("rect"); }, "R")}
              {menuItem(Shapes, "مكتبة الأشكال", () => onOpenLeft("shapes"))}
            </>
          )}
          {flyout.name === "connectors" && (
            <>
              {menuItem(Minus, "خط مستقيم", () => useEditor.getState().addElement("line"))}
              {menuItem(SeparatorHorizontal, "فاصل", () => useEditor.getState().addElement("divider"))}
              {menuItem(Waypoints, "كل الموصلات والخطوط", () => onOpenLeft("shapes"))}
            </>
          )}
          {flyout.name === "colors" && (
            <>
              {menuItem(() => <span className="tool-dock-menu-chip" style={{ backgroundColor: foreground }} />, "لون التعبئة…", () => openPicker(foregroundInput.current))}
              {menuItem(() => <span className="tool-dock-menu-chip is-stroke" style={{ borderColor: background }} />, "لون الإطار…", () => openPicker(backgroundInput.current))}
              {menuItem(SwapGlyph, "تبديل التعبئة والإطار", swapColors)}
              {menuItem(ResetGlyph, "الألوان الافتراضية", resetColors)}
            </>
          )}
        </div>
      )}
      {customizing && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          dir="rtl"
          onClick={() => setCustomizing(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-white/15 bg-[#181d21] p-5 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-bold">تخصيص شريط الأدوات (Photoshop-style)</h3>
              <button
                type="button"
                className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
                onClick={() => setCustomizing(false)}
              >
                ✕
              </button>
            </div>
            <p className="mb-3 text-[12px] text-white/70">
              قم بإعادة ترتيب الأدوات، إخفائها أو إظهارها، ونقلها إلى قسم الأدوات الإضافية (Extra Tools):
            </p>
            <div className="max-h-[300px] space-y-1.5 overflow-y-auto pe-1">
              {dockConfig.map((item, index) => {
                const labels: Record<string, string> = {
                  select: "تحديد وتحريك (V)",
                  text: "نص بالرسم (T)",
                  shape: "رسم مربع / أشكال (R)",
                  image: "الوسائط والصور",
                  files: "ملفات المشروع (.nsq)",
                  layers: "شجرة الطبقات",
                  properties: "لوحة الخصائص",
                  colors: "لوحة الألوان",
                  connectors: "الموصلات والخطوط",
                };
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[12px]"
                  >
                    <span className={cn("font-medium", !item.visible && "text-white/40 line-through")}>
                      {labels[item.id] || item.id}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="rounded p-1 hover:bg-white/10 disabled:opacity-30"
                        disabled={index === 0}
                        onClick={() => {
                          const next = [...dockConfig];
                          const [swapped] = next.splice(index, 1);
                          next.splice(index - 1, 0, swapped);
                          next.forEach((x, i) => (x.order = i));
                          setDockConfig(next);
                          saveToolDockConfig(next);
                        }}
                        title="تحريك لأعلى"
                      >
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 hover:bg-white/10 disabled:opacity-30"
                        disabled={index === dockConfig.length - 1}
                        onClick={() => {
                          const next = [...dockConfig];
                          const [swapped] = next.splice(index, 1);
                          next.splice(index + 1, 0, swapped);
                          next.forEach((x, i) => (x.order = i));
                          setDockConfig(next);
                          saveToolDockConfig(next);
                        }}
                        title="تحريك لأسفل"
                      >
                        <ArrowDown className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        className={cn("rounded p-1 hover:bg-white/10", item.category === "extra" ? "text-accent" : "text-white/60")}
                        onClick={() => {
                          const next: ToolDockItemConfig[] = dockConfig.map((x) =>
                            x.id === item.id
                              ? { ...x, category: (x.category === "extra" ? "primary" : "extra") as "primary" | "extra" }
                              : x,
                          );
                          setDockConfig(next);
                          saveToolDockConfig(next);
                        }}
                        title={item.category === "extra" ? "نقل للأدوات الرئيسية" : "نقل لقسم Extra Tools"}
                      >
                        {item.category === "extra" ? "★ Extra" : "☆"}
                      </button>
                      <button
                        type="button"
                        className={cn("rounded p-1 hover:bg-white/10", item.visible ? "text-emerald-400" : "text-white/40")}
                        onClick={() => {
                          const next = dockConfig.map((x) =>
                            x.id === item.id ? { ...x, visible: !x.visible } : x,
                          );
                          setDockConfig(next);
                          saveToolDockConfig(next);
                        }}
                        title={item.visible ? "إخفاء الأداة" : "إظهار الأداة"}
                      >
                        {item.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/10 hover:text-white"
                onClick={() => {
                  const restored = resetToolDockConfig();
                  setDockConfig(restored);
                }}
              >
                <RotateCcw className="size-3.5" />
                <span>استعادة الافتراضي</span>
              </button>
              <button
                type="button"
                className="rounded-lg bg-accent px-4 py-1.5 text-[12px] font-bold text-white hover:bg-accent/90"
                onClick={() => setCustomizing(false)}
              >
                تم
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

/**
 * A collapsed desktop panel: a narrow vertical icon dock. `>>` restores the
 * panel as it was; each icon restores it straight onto that tab — one click
 * either way.
 */
export function CollapsedPanelDock<T extends string>({
  side,
  tabs,
  activeTab,
  onExpand,
  onTab,
}: {
  side: "left" | "right";
  tabs: readonly { id: T; label: string; icon: LucideIcon }[];
  activeTab: T;
  onExpand: () => void;
  onTab: (tab: T) => void;
}) {
  // "left" is the elements/library panel, which sits on the physical RIGHT in
  // this RTL shell; it expands toward the canvas (leftwards), and vice versa.
  const ExpandIcon = side === "left" ? ChevronsLeft : ChevronsRight;
  const panelName = side === "left" ? "لوحة العناصر" : "لوحة الخصائص";
  return (
    <aside className={cn("collapsed-panel-dock", `is-${side}`)} aria-label={`${panelName} المطوية`}>
      <button
        type="button"
        className="collapsed-dock-expand"
        onClick={onExpand}
        title={`توسيع ${panelName}`}
        aria-label={`توسيع ${panelName}`}
      >
        <ExpandIcon className="size-4" />
      </button>
      <span className="collapsed-dock-sep" aria-hidden="true" />
      <div className="collapsed-dock-tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={cn("collapsed-dock-tab", tab.id === activeTab && "is-active")}
              onClick={() => onTab(tab.id)}
              title={tab.label}
              aria-label={`فتح ${tab.label}`}
            >
              <Icon className="size-[18px]" strokeWidth={1.6} />
              <span className="collapsed-dock-label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
