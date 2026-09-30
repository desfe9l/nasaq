import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FolderOpen,
  GripHorizontal,
  Layers,
  LayoutGrid,
  MousePointer2,
  PenTool,
  Shapes,
  SlidersHorizontal,
  Square,
  SquareDashedMousePointer,
  Type,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditor, type LeftTab, type RightTab } from "@/lib/editor/store";
import { useSelectedElement } from "@/lib/editor/selectors";
import {
  DOCK_METRICS_FALLBACK,
  dockLayout,
  type DockMetrics,
} from "@/lib/editor/ui-state";
import { AnchorMenu, MenuGroup, MenuRow } from "./ui/AnchorMenu";
import { IconButton } from "./ui/IconButton";
import { AddMenu } from "./AddMenu";
import { LEFT_PANEL_TABS } from "./panel-tabs";

/**
 * The canvas dock — a compact floating cluster, not a permanent rail.
 *
 * The old vertical tool column owned a grid track of its own, so every session
 * paid for it in canvas width whether or not a tool was being used, and its
 * "wide" mode could stretch into a long empty bar. This dock is:
 *
 *   • floating — it lives INSIDE the canvas row, anchored to the bottom-start
 *     corner, so it can never cover the page rail, the status bar or a docked
 *     panel, and the workspace has no column reserved for it;
 *   • icon-first — one fixed cell per tool, one icon size, one stroke, and no
 *     permanent labels: the tooltip names the tool on hover and on long-press,
 *     so a name never costs the canvas a pixel;
 *   • stable — `dockLayout()` (ui-state.ts) decides which tools fit the
 *     measured lane and folds the rest into a drawer, so the bar's rectangle
 *     never depends on an open menu and an icon is never squeezed;
 *   • movable — the grip drags it anywhere inside the canvas and the position
 *     is remembered, which is what keeps it off the artwork on a small screen;
 *   • collapsible — one chevron folds it to a single control, so a docked
 *     panel or a crowded page gets the space back;
 *   • single-purpose — one home per action: draw tools, insert (Add), panel
 *     gateways and the colour pair. Nothing here duplicates the header, and a
 *     keyboard shortcut is printed in exactly one place.
 */
type DrawTool = "text" | "rect" | null;

const DEFAULT_COLORS = { foreground: "#2563eb", background: "#f4f5f6" } as const;
const HEX = /^#[\da-f]{6}$/i;
/** Session memory for the drag position. */
const POS_KEY = "nasaq.canvas-dock.pos";
const COLLAPSE_KEY = "nasaq.canvas-dock.collapsed";
/** Canvas edge the dock keeps clear of (`inset-inline-start: 12px` + 12px). */
const DOCK_LANE_INSET = 24;

export interface CanvasDockProps {
  onOpenLeft: (tab: LeftTab) => void;
  onOpenRight: (tab: RightTab) => void;
  onUpload: (kind: "image" | "logo" | "library") => void;
  onUploadSvg: () => void;
  onAddLibrary: () => void;
  onHeadingGenerator: () => void;
  onReportTools: () => void;
}

export function CanvasDock({
  onOpenLeft,
  onOpenRight,
  onUpload,
  onUploadSvg,
  onAddLibrary,
  onHeadingGenerator,
  onReportTools,
}: CanvasDockProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragState = useRef<{ id: number; x: number; y: number; ox: number; oy: number } | null>(null);
  const dockRef = useRef<HTMLElement>(null);
  const [activeTool, setActiveTool] = useState<DrawTool>(null);
  const foregroundInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  /** Free width the dock may occupy — the canvas row it floats in. */
  const [lane, setLane] = useState(Number.POSITIVE_INFINITY);
  const [metrics, setMetrics] = useState<DockMetrics>(DOCK_METRICS_FALLBACK);

  const rightOpen = useEditor((s) => s.rightOpen);
  const rightTab = useEditor((s) => s.rightTab);
  const leftOpen = useEditor((s) => s.leftOpen);
  const leftTab = useEditor((s) => s.leftTab);
  const activeLeftPanel = LEFT_PANEL_TABS.find((tab) => tab.id === leftTab);
  const ActiveLeftIcon = activeLeftPanel?.icon ?? FolderOpen;
  const activeLeftLabel = activeLeftPanel?.label ?? "العناصر";
  // Identity-stable selection (see selectors.ts): subscribing to a derived
  // array would re-render the dock on every document write.
  const selected = useSelectedElement();
  const selectedId = selected?.id;
  const selectedType = selected?.type;
  const selectedFill =
    selected?.type === "svg" ? selected.style.svgFill : selected?.style?.fill;
  const selectedColor = selected?.style?.color;
  const selectedBackground = selected?.style?.background;
  const selectedBorder =
    selectedType === "svg" || selectedType === "icon"
      ? selected?.style?.svgStroke
      : selected?.style?.borderColor;
  const selectedStroke = selected?.style?.svgStroke;
  const [colors, setColors] = useState<{ foreground: string; background: string }>({
    ...DEFAULT_COLORS,
  });
  const foreground = selectedFill || selectedColor || selectedBackground || colors.foreground;
  const background = selectedBorder || selectedStroke || colors.background;

  useEffect(() => {
    if (!selectedId) return;
    setColors((current) => ({
      foreground:
        selectedFill || selectedColor || selectedBackground || current.foreground,
      background: selectedBorder || selectedStroke || current.background,
    }));
  }, [
    selectedId,
    selectedFill,
    selectedColor,
    selectedBackground,
    selectedBorder,
    selectedStroke,
  ]);

  /*
   * Mirror the canvas tool state: the same event the header, the keyboard map
   * (V / T / R) and the command palette dispatch.
   */
  useEffect(() => {
    const onTool = (event: Event) => setActiveTool((event as CustomEvent<DrawTool>).detail ?? null);
    window.addEventListener("nasaq:tool", onTool);
    return () => window.removeEventListener("nasaq:tool", onTool);
  }, []);
  useEffect(() => {
    if (selectedId) setActiveTool(null);
  }, [selectedId]);

  /* Restored drag position, clamped into the canvas row on every viewport. */
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
        setPos(stored);
      }
    } catch {
      /* default corner */
    }
  }, []);

  /**
   * Measure the lane and the cell geometry.
   *
   * Both are read from the SLOT and from CSS custom properties, never from the
   * dock's own box: the dock's width is an OUTPUT of `dockLayout`, so measuring
   * it here would make the decision depend on its own result and oscillate.
   */
  const measure = useCallback(() => {
    const dock = dockRef.current;
    const slot = dock?.parentElement;
    if (!dock || !slot) return;
    const style = getComputedStyle(dock);
    const cell =
      parseFloat(style.getPropertyValue("--dock-size")) ||
      DOCK_METRICS_FALLBACK.cell;
    const gap = parseFloat(style.gap) || DOCK_METRICS_FALLBACK.gap;
    const pad = parseFloat(style.paddingInlineStart) || DOCK_METRICS_FALLBACK.pad;
    const grip =
      dock.querySelector<HTMLElement>(".editor-dock-grip")?.getBoundingClientRect()
        .width || DOCK_METRICS_FALLBACK.grip;
    setMetrics({ cell, gap, pad, grip, sep: DOCK_METRICS_FALLBACK.sep });
    setLane(Math.max(0, slot.getBoundingClientRect().width - DOCK_LANE_INSET));
  }, []);

  useEffect(() => {
    measure();
    const slot = dockRef.current?.parentElement;
    if (!slot || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    window.addEventListener("resize", measure);
    window.addEventListener("nasaq:panel-layout", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("nasaq:panel-layout", measure);
    };
  }, [measure, collapsed]);

  const clampInto = useCallback((next: { x: number; y: number }) => {
    const slot = dockRef.current?.parentElement?.getBoundingClientRect();
    const box = dockRef.current?.getBoundingClientRect();
    if (!slot || !box) return next;
    const maxX = Math.max(0, slot.width - box.width);
    const maxY = Math.max(0, slot.height - box.height);
    return {
      x: Math.min(Math.max(next.x, 0), maxX),
      y: Math.min(Math.max(next.y, 0), maxY),
    };
  }, []);

  useEffect(() => {
    if (!pos) return;
    const onResize = () => setPos((current) => (current ? clampInto(current) : current));
    window.addEventListener("resize", onResize);
    window.addEventListener("nasaq:panel-layout", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("nasaq:panel-layout", onResize);
    };
  }, [pos, clampInto]);

  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const slot = dockRef.current?.parentElement?.getBoundingClientRect();
    const box = dockRef.current?.getBoundingClientRect();
    if (!slot || !box) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      ox: box.left - slot.left,
      oy: box.top - slot.top,
    };
  };
  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragState.current;
    if (!drag || drag.id !== event.pointerId) return;
    const slot = dockRef.current?.parentElement?.getBoundingClientRect();
    if (!slot) return;
    setPos(
      clampInto({
        x: event.clientX - slot.left - drag.ox,
        y: event.clientY - slot.top - drag.oy,
      }),
    );
  };
  const endDrag = () => {
    if (!dragState.current) return;
    dragState.current = null;
    setPos((current) => {
      if (current) {
        try {
          localStorage.setItem(POS_KEY, JSON.stringify(current));
        } catch {
          /* position stays for this session only */
        }
      }
      return current;
    });
  };

  const arm = (tool: DrawTool) => window.dispatchEvent(new CustomEvent("nasaq:tool", { detail: tool }));
  const patchFor = (key: "foreground" | "background", color: string) => {
    const isText = ["text", "box", "stat", "stamp", "table", "progress"].includes(selectedType || "");
    return key === "foreground"
      ? selectedType === "svg"
        ? { svgFill: color }
        : selectedType === "icon"
          ? { fill: color, color }
          : isText
            ? { color }
            : { fill: color }
      : { borderColor: color, svgStroke: color };
  };
  const colorChange = (key: "foreground" | "background", color: string) => {
    setColors((current) => ({ ...current, [key]: color }));
    if (!selectedId) return;
    useEditor.getState().updateStyle(selectedId, patchFor(key, color));
  };
  /** Both swatches in one store update, so a swap is a single undo step. */
  const applyPair = (next: { foreground: string; background: string }) => {
    setColors(next);
    if (!selectedId) return;
    useEditor.getState().updateStyle(selectedId, {
      ...patchFor("foreground", next.foreground),
      ...patchFor("background", next.background),
    });
  };
  const openPicker = (input: HTMLInputElement | null) => {
    if (!input) return;
    try {
      if (typeof input.showPicker === "function") {
        input.showPicker();
        return;
      }
    } catch {
      /* fall back to a click */
    }
    input.click();
  };

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(COLLAPSE_KEY, String(next));
      } catch {
        /* preference stays for this session only */
      }
      return next;
    });
  };

  /*
   * What the lane affords. A collapsed dock shows two controls, so it never
   * needs to fold; an expanded one hands the tools that do not fit to a drawer
   * instead of squeezing them or wrapping onto a second row.
   */
  const layout = collapsed
    ? { bar: [], drawer: [], triggers: [] }
    : dockLayout(lane, metrics);
  const inBar = new Set(layout.bar);
  const folded = new Set(layout.triggers);
  const foldedParts = new Set(layout.drawer);

  /** The drawing actions, shared by the two group drawers. */
  const drawRows = {
    select: (
      <MenuRow
        icon={<MousePointer2 className="size-4" />}
        label="تحديد وتحريك"
        hint="العودة إلى أداة التحديد"
        checked={activeTool === null}
        onSelect={() => arm(null)}
      />
    ),
    text: (
      <MenuRow
        icon={<Type className="size-4" />}
        label="نص بالرسم"
        hint="اسحب على الصفحة لتحديد موضعه وحجمه"
        onSelect={() => {
          onOpenLeft("elements");
          arm("text");
        }}
      />
    ),
    box: (
      <MenuRow
        icon={<SquareDashedMousePointer className="size-4" />}
        label="مربع محتوى"
        onSelect={() => useEditor.getState().addElement("box")}
      />
    ),
    rect: (
      <MenuRow
        icon={<Square className="size-4" />}
        label="رسم مربع"
        hint="انقر واسحب على اللوحة"
        onSelect={() => {
          onOpenLeft("shapes");
          arm("rect");
        }}
      />
    ),
    library: (
      <MenuRow
        icon={<Shapes className="size-4" />}
        label="مكتبة الأشكال"
        onSelect={() => onOpenLeft("shapes")}
      />
    ),
  };
  const toggleLeftPanel = () => {
    if (leftOpen) {
      useEditor.setState({ leftOpen: false, leftCollapsed: true });
    } else {
      onOpenLeft(leftTab);
    }
  };
  const toggleRightPanel = (tab: "properties" | "layers") => {
    if (rightOpen && rightTab === tab) {
      useEditor.setState({ rightOpen: false, rightCollapsed: true });
    } else {
      onOpenRight(tab);
    }
  };
  const panelRows = (
    <>
      <MenuRow
        icon={<FolderOpen className="size-4" />}
        label="العناصر والمكتبة"
        hint="عناصر، أشكال، قوالب، صفحات، سمة وخطوط"
        checked={leftOpen}
        onSelect={toggleLeftPanel}
      />
      <MenuRow
        icon={<SlidersHorizontal className="size-4" />}
        label="الخصائص والإعدادات"
        hint="خصائص العنصر المحدد"
        checked={rightOpen && rightTab === "properties"}
        onSelect={() => toggleRightPanel("properties")}
      />
      <MenuRow
        icon={<Layers className="size-4" />}
        label="الطبقات"
        hint="شجرة الطبقات وترتيب العناصر"
        checked={rightOpen && rightTab === "layers"}
        onSelect={() => toggleRightPanel("layers")}
      />
    </>
  );
  const colorRows = (
    <>
      <MenuRow
        icon={
          <span className="tool-dock-menu-chip" style={{ backgroundColor: foreground }} />
        }
        label="لون التعبئة"
        onSelect={() => openPicker(foregroundInput.current)}
      />
      <MenuRow
        icon={
          <span
            className="tool-dock-menu-chip is-stroke"
            style={{ borderColor: background }}
          />
        }
        label="لون الإطار"
        onSelect={() => openPicker(backgroundInput.current)}
      />
      <MenuRow
        label="تبديل التعبئة والإطار"
        separatorBefore
        onSelect={() => applyPair({ foreground: background, background: foreground })}
      />
      <MenuRow
        label="الألوان الافتراضية"
        onSelect={() => applyPair({ ...DEFAULT_COLORS })}
      />
    </>
  );

  return (
    <div className="studio-tool-dock-slot">
      <aside
        ref={dockRef}
        className={cn("studio-tool-dock", "editor-dock", collapsed && "is-collapsed")}
        data-editor-obstacle="tool-dock"
        data-tour="canvas-dock"
        data-density={layout.drawer.length ? "folded" : "full"}
        aria-label="أدوات مساحة العمل"
        style={pos ? { insetInlineStart: pos.x, top: pos.y } : undefined}
        // Chrome, not canvas: a right-click here must never open the element
        // context menu behind the dock.
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <button
          type="button"
          className="editor-dock-grip"
          aria-label="نقل شريط الأدوات"
          title="اسحب لنقل الشريط — نقرتان لإعادته إلى الزاوية"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => {
            setPos(null);
            try {
              localStorage.removeItem(POS_KEY);
            } catch {
              /* nothing to clear */
            }
          }}
        >
          <GripHorizontal size={14} aria-hidden="true" />
        </button>

        {!collapsed ? (
          <>
            {inBar.has("select") && (
              <IconButton
                label="تحديد وتحريك"
                hint="العودة إلى أداة التحديد"
                shortcut="V"
                active={activeTool === null}
                tipSide="top"
                onClick={() => arm(null)}
                icon={<MousePointer2 className="size-4" />}
              />
            )}

            {folded.has("draw") ? (
              /* Both drawing groups behind one cell: a narrow lane loses a
                 slot, never a tool. */
              <AnchorMenu
                label="أدوات الرسم"
                drawer={{ id: "dock-draw", title: "أدوات الرسم" }}
                align="start"
                side="top"
                width={240}
                trigger={({ ref, ...props }) => (
                  <IconButton
                    {...props}
                    ref={ref}
                    label="أدوات الرسم"
                    hint="نص، مربع محتوى، أشكال"
                    active={activeTool === "text" || activeTool === "rect"}
                    tipSide="top"
                    icon={<PenTool className="size-4" />}
                  />
                )}
              >
                {/* On the narrowest lanes the pointer tool folds in here too,
                    so the drawer always carries the complete tool set. */}
                {foldedParts.has("select") && drawRows.select}
                {drawRows.text}
                {drawRows.box}
                {drawRows.rect}
                {drawRows.library}
              </AnchorMenu>
            ) : (
              <>
                <AnchorMenu
                  label="أدوات النص"
                  drawer={{ id: "dock-text", title: "أدوات النص" }}
                  align="start"
                  side="top"
                  width={240}
                  trigger={({ ref, ...props }) => (
                    <IconButton
                      {...props}
                      ref={ref}
                      label="نص"
                      hint="مربع نص بالسحب، أو مربع محتوى جاهز"
                      shortcut="T"
                      active={activeTool === "text"}
                      tipSide="top"
                      icon={<Type className="size-4" />}
                    />
                  )}
                >
                  {drawRows.text}
                  {drawRows.box}
                </AnchorMenu>

                <AnchorMenu
                  label="أدوات الأشكال"
                  drawer={{ id: "dock-shape", title: "أدوات الأشكال" }}
                  align="start"
                  side="top"
                  width={240}
                  trigger={({ ref, ...props }) => (
                    <IconButton
                      {...props}
                      ref={ref}
                      label="أشكال"
                      hint="ارسم شكلاً أو افتح مكتبة الأشكال"
                      shortcut="R"
                      active={activeTool === "rect"}
                      tipSide="top"
                      icon={<Square className="size-4" />}
                    />
                  )}
                >
                  {drawRows.rect}
                  {drawRows.library}
                </AnchorMenu>
              </>
            )}

            {folded.has("panels") ? (
              <AnchorMenu
                label="اللوحات"
                drawer={{ id: "dock-panels", title: "اللوحات" }}
                align="start"
                side="top"
                width={240}
                trigger={({ ref, ...props }) => (
                  <IconButton
                    {...props}
                    ref={ref}
                    label="اللوحات"
                    hint="العناصر، الخصائص والطبقات"
                    active={leftOpen || rightOpen}
                    tipSide="top"
                    icon={<LayoutGrid className="size-4" />}
                  />
                )}
              >
                {panelRows}
                {folded.has("colors") && (
                  <>
                    <MenuGroup title="الألوان" />
                    {colorRows}
                  </>
                )}
              </AnchorMenu>
            ) : (
              <>
                <IconButton
                  label={`${leftOpen ? "إخفاء" : "فتح"} لوحة ${activeLeftLabel}`}
                  hint="يتغير الرمز حسب اللوحة النشطة: المكتبة، القوالب، الصفحات، الأشكال أو الأدوات"
                  active={leftOpen}
                  tipSide="top"
                  onClick={toggleLeftPanel}
                  icon={<ActiveLeftIcon className="size-4" />}
                  data-tour="library"
                />
                <IconButton
                  label="الخصائص والإعدادات"
                  hint="خصائص العنصر المحدد"
                  active={rightOpen && rightTab === "properties"}
                  tipSide="top"
                  onClick={() => toggleRightPanel("properties")}
                  icon={<SlidersHorizontal className="size-4" />}
                  data-tour="properties"
                />
                <IconButton
                  label="الطبقات"
                  hint="شجرة الطبقات وترتيب العناصر"
                  active={rightOpen && rightTab === "layers"}
                  tipSide="top"
                  onClick={() => toggleRightPanel("layers")}
                  icon={<Layers className="size-4" />}
                />
              </>
            )}

            {inBar.has("colors") && (
              <>
                <span className="editor-dock-sep" aria-hidden="true" />

                <AnchorMenu
                  label="الألوان"
                  drawer={{ id: "dock-colors", title: "الألوان" }}
                  align="start"
                  side="top"
                  width={240}
                  trigger={({ ref, ...props }) => (
                    <span className="editor-dock-colors">
                      <IconButton
                        {...props}
                        ref={ref}
                        label="لون التعبئة والإطار"
                        hint="تعبئة وإطار العنصر المحدد"
                        tipSide="top"
                        className="editor-dock-color-btn"
                        icon={
                          <span className="editor-dock-color-chips" aria-hidden="true">
                            <span
                              className="is-fill"
                              style={{
                                backgroundColor: HEX.test(foreground) ? foreground : DEFAULT_COLORS.foreground,
                              }}
                            />
                            <span
                              className="is-stroke"
                              style={{
                                borderColor: HEX.test(background) ? background : DEFAULT_COLORS.background,
                              }}
                            />
                          </span>
                        }
                      />
                    </span>
                  )}
                >
                  {colorRows}
                </AnchorMenu>
              </>
            )}
          </>
        ) : null}

        <AddMenu
          onUpload={onUpload}
          onUploadSvg={onUploadSvg}
          onAddLibrary={onAddLibrary}
          onHeadingGenerator={onHeadingGenerator}
          onReportTools={onReportTools}
          onDrawText={() => {
            onOpenLeft("elements");
            arm("text");
          }}
          onOpenLeft={onOpenLeft}
        />

        {/* Chrome, not a tool: a quiet separator keeps the collapse control
            out of the tool group's hierarchy. */}
        <span className="editor-dock-sep" aria-hidden="true" />
        <IconButton
          label={collapsed ? "توسيع شريط الأدوات" : "تصغير شريط الأدوات"}
          hint="يُطوى الشريط إلى زر واحد"
          tipSide="top"
          onClick={toggleCollapsed}
          className="editor-dock-collapse"
          icon={
            collapsed ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )
          }
        />
      </aside>

      {/* Native colour inputs: the same picker the panels use, on tap. */}
      <input
        ref={backgroundInput}
        type="color"
        aria-label="اختيار لون الإطار"
        className="sr-only"
        tabIndex={-1}
        value={HEX.test(background) ? background : DEFAULT_COLORS.background}
        onChange={(event) => colorChange("background", event.target.value)}
      />
      <input
        ref={foregroundInput}
        type="color"
        aria-label="اختيار لون التعبئة"
        className="sr-only"
        tabIndex={-1}
        value={HEX.test(foreground) ? foreground : DEFAULT_COLORS.foreground}
        onChange={(event) => colorChange("foreground", event.target.value)}
      />
    </div>
  );
}
