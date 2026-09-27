import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  FolderOpen,
  ImagePlus,
  Layers,
  MousePointer2,
  Palette,
  Shapes,
  SlidersHorizontal,
  Square,
  SquareDashedMousePointer,
  Type,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditor, type LeftTab, type RightTab } from "@/lib/editor/store";

type DrawTool = "text" | "rect" | null;
type FlyoutName = "text" | "shapes" | "colors";

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
 * Photoshop-inspired main toolbar. Every tool dispatches the exact same event
 * (`nasaq:tool`) or store action the header, the keyboard map (V / T / R) and
 * the command palette already use — the dock is another way to reach them,
 * never a second implementation.
 *
 * Desktop: its own grid track between the panels and the canvas.
 * Tablet (`floating`): a floating rail inside the canvas area only, so it can
 * never cover the page rail, the status bar or the side drawers.
 */
export function StudioToolDock({
  onOpenLeft,
  onOpenRight,
  onUploadImage,
  floating = false,
}: {
  onOpenLeft: (tab: LeftTab) => void;
  onOpenRight: (tab: RightTab) => void;
  onUploadImage: () => void;
  floating?: boolean;
}) {
  const [wide, setWide] = useState(() => {
    try { return localStorage.getItem("nasaq.tool-dock-wide") === "true"; } catch { return false; }
  });
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
    submenu?: "text" | "shapes",
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
        {toolButton("select", MousePointer2, "تحديد وتحريك", "V", () => arm(null), activeTool === null)}
        {toolButton("text", Type, "نص بالرسم", "T", () => { onOpenLeft("elements"); arm("text"); }, activeTool === "text", "text")}
        {toolButton("shape", Square, "مستطيل / أشكال", "R", () => { onOpenLeft("shapes"); arm("rect"); }, activeTool === "rect", "shapes")}
        <span className="tool-dock-sep" aria-hidden="true" />
        {toolButton("image", ImagePlus, "إضافة صورة", "", onUploadImage)}
        {toolButton("library", FolderOpen, "المكتبة", "", () => onOpenLeft("library"))}
        {toolButton("layers", Layers, "الطبقات", "", () => onOpenRight("layers"))}
        {toolButton("properties", SlidersHorizontal, "الخصائص", "", () => onOpenRight("properties"))}
        {toolButton("colors", Palette, "ألوان التعبئة والإطار", "", () => openPicker(foregroundInput.current))}
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
          aria-label={flyout.name === "text" ? "أدوات النص" : flyout.name === "shapes" ? "أدوات الأشكال" : "الألوان"}
        >
          {flyout.name === "text" && (
            <>
              {menuItem(Type, "نص بالرسم", () => { onOpenLeft("elements"); arm("text"); }, "T")}
              {menuItem(SquareDashedMousePointer, "مربع محتوى", () => useEditor.getState().addElement("box"))}
            </>
          )}
          {flyout.name === "shapes" && (
            <>
              {menuItem(Square, "مستطيل بالرسم", () => { onOpenLeft("shapes"); arm("rect"); }, "R")}
              {menuItem(Shapes, "مكتبة الأشكال", () => onOpenLeft("shapes"))}
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
