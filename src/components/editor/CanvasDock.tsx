import { useCallback, useEffect, useRef, useState } from "react";
import {
  Blocks,
  FolderOpen,
  GripHorizontal,
  Layers,
  MousePointer2,
  Shapes,
  SlidersHorizontal,
  Square,
  SquareDashedMousePointer,
  Type,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditor, type LeftTab, type RightTab } from "@/lib/editor/store";
import { useSelectedElement } from "@/lib/editor/selectors";
import { AnchorMenu, MenuRow } from "./ui/AnchorMenu";
import { IconButton } from "./ui/IconButton";
import { AddMenu } from "./AddMenu";

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
 *   • content-sized — `width: max-content` with a ceiling, so it is exactly as
 *     wide as its tools and never stretches across the editor;
 *   • movable — the grip drags it anywhere inside the canvas and the position
 *     is remembered, which is what keeps it off the artwork on a small screen;
 *   • collapsible — one chevron folds it to a single control, so a docked
 *     panel or a crowded page gets the space back;
 *   • single-purpose — one home per action: draw tools, insert (Add), panel
 *     gateways and the colour pair. Nothing here duplicates the header.
 */
type DrawTool = "text" | "rect" | null;

const DEFAULT_COLORS = { foreground: "#2563eb", background: "#f4f5f6" } as const;
const HEX = /^#[\da-f]{6}$/i;
/** Session memory for the drag position. */
const POS_KEY = "nasaq.canvas-dock.pos";
const COLLAPSE_KEY = "nasaq.canvas-dock.collapsed";

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

  const rightOpen = useEditor((s) => s.rightOpen);
  const rightTab = useEditor((s) => s.rightTab);
  const leftOpen = useEditor((s) => s.leftOpen);
  const leftTab = useEditor((s) => s.leftTab);
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

  return (
    <div className="studio-tool-dock-slot">
      <aside
        ref={dockRef}
        className={cn("studio-tool-dock", "editor-dock", collapsed && "is-collapsed")}
        data-editor-obstacle="tool-dock"
        data-tour="canvas-dock"
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
            <IconButton
              label="تحديد وتحريك"
              hint="العودة إلى أداة التحديد"
              shortcut="V"
              active={activeTool === null}
              tipSide="top"
              onClick={() => arm(null)}
              icon={<MousePointer2 className="size-4" strokeWidth={1.6} />}
            />

            <AnchorMenu
              label="أدوات النص"
              align="start"
              side="top"
              width={216}
              trigger={({ ref, ...props }) => (
                <IconButton
                  {...props}
                  ref={ref}
                  label="نص"
                  hint="مربع نص بالسحب، أو مربع محتوى جاهز"
                  shortcut="T"
                  active={activeTool === "text"}
                  tipSide="top"
                  icon={<Type className="size-4" strokeWidth={1.6} />}
                />
              )}
            >
              <MenuRow
                icon={<Type className="size-4" />}
                label="نص بالرسم"
                hint="اسحب على الصفحة لتحديد موضعه وحجمه"
                shortcut="T"
                onSelect={() => {
                  onOpenLeft("elements");
                  arm("text");
                }}
              />
              <MenuRow
                icon={<SquareDashedMousePointer className="size-4" />}
                label="مربع محتوى"
                onSelect={() => useEditor.getState().addElement("box")}
              />
            </AnchorMenu>

            <AnchorMenu
              label="أدوات الأشكال"
              align="start"
              side="top"
              width={216}
              trigger={({ ref, ...props }) => (
                <IconButton
                  {...props}
                  ref={ref}
                  label="أشكال"
                  hint="ارسم شكلاً أو افتح مكتبة الأشكال"
                  shortcut="R"
                  active={activeTool === "rect"}
                  tipSide="top"
                  icon={<Square className="size-4" strokeWidth={1.6} />}
                />
              )}
            >
              <MenuRow
                icon={<Square className="size-4" />}
                label="رسم مربع"
                hint="انقر واسحب على اللوحة"
                shortcut="R"
                onSelect={() => {
                  onOpenLeft("shapes");
                  arm("rect");
                }}
              />
              <MenuRow
                icon={<Shapes className="size-4" />}
                label="مكتبة الأشكال"
                onSelect={() => onOpenLeft("shapes")}
              />
            </AnchorMenu>

            <IconButton
              label="العناصر والمكتبة"
              hint="عناصر، أشكال، قوالب، صفحات، سمة وخطوط"
              active={leftOpen}
              tipSide="top"
              onClick={() => onOpenLeft(leftTab)}
              icon={
                leftOpen && leftTab === "tools" ? (
                  <Blocks className="size-4" strokeWidth={1.6} />
                ) : (
                  <FolderOpen className="size-4" strokeWidth={1.6} />
                )
              }
              data-tour="library"
            />
            <IconButton
              label="الخصائص والإعدادات"
              hint="خصائص العنصر المحدد"
              active={rightOpen && rightTab === "properties"}
              tipSide="top"
              onClick={() => onOpenRight("properties")}
              icon={<SlidersHorizontal className="size-4" strokeWidth={1.6} />}
              data-tour="properties"
            />
            <IconButton
              label="الطبقات"
              hint="شجرة الطبقات وترتيب العناصر"
              active={rightOpen && rightTab === "layers"}
              tipSide="top"
              onClick={() => onOpenRight("layers")}
              icon={<Layers className="size-4" strokeWidth={1.6} />}
            />

            <span className="editor-dock-sep" aria-hidden="true" />

            <AnchorMenu
              label="الألوان"
              align="start"
              side="top"
              width={216}
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
              <MenuRow
                icon={
                  <span
                    className="tool-dock-menu-chip"
                    style={{ backgroundColor: foreground }}
                  />
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
            </AnchorMenu>
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

        <IconButton
          label={collapsed ? "توسيع شريط الأدوات" : "تصغير شريط الأدوات"}
          hint="يُطوى الشريط إلى زر واحد"
          tipSide="top"
          onClick={toggleCollapsed}
          className="editor-dock-collapse"
          icon={
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d={collapsed ? "M5 10.5 8 7.5l3 3" : "M5 5.5 8 8.5l3-3"}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
        />
      </aside>

      {/* Native colour inputs: the same picker the panels use, on tap. */}
      <input
        ref={backgroundInput}
        type="color"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        value={HEX.test(background) ? background : DEFAULT_COLORS.background}
        onChange={(event) => colorChange("background", event.target.value)}
      />
      <input
        ref={foregroundInput}
        type="color"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        value={HEX.test(foreground) ? foreground : DEFAULT_COLORS.foreground}
        onChange={(event) => colorChange("foreground", event.target.value)}
      />
    </div>
  );
}
