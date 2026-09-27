import { useEffect, useRef, useState } from "react";
import {
  ChevronsRight,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  MousePointer2,
  Palette,
  PanelRight,
  PenLine,
  Shapes,
  Square,
  Type,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditor, type LeftTab, type RightTab } from "@/lib/editor/store";

type DrawTool = "text" | "rect" | null;

/** Photoshop-inspired access to existing NASAQ tools; all canvas tools still use their original event contract. */
export function StudioToolDock({
  onOpenLeft,
  onOpenRight,
  onUploadImage,
}: {
  onOpenLeft: (tab: LeftTab) => void;
  onOpenRight: (tab: RightTab) => void;
  onUploadImage: () => void;
}) {
  const [wide, setWide] = useState(() => {
    try { return localStorage.getItem("nasaq.tool-dock-wide") === "true"; } catch { return false; }
  });
  const [activeTool, setActiveTool] = useState<DrawTool>(null);
  const [flyout, setFlyout] = useState<"text" | "shapes" | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldFlyout = useRef(false);
  const foregroundInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const selected = useEditor((s) => s.selectedElements()[0]);
  const selectedId = selected?.id;
  const selectedFill = selected?.style?.fill;
  const selectedColor = selected?.style?.color;
  const selectedBackground = selected?.style?.background;
  const selectedBorder = selected?.style?.borderColor;
  const selectedStroke = selected?.style?.svgStroke;
  const [colors, setColors] = useState({ foreground: "#2563eb", background: "#f4f5f6" });
  const foreground = selectedFill || selectedColor || selectedBackground || colors.foreground;
  const background = selectedBorder || selectedStroke || colors.background;

  useEffect(() => {
    if (!selectedId) return;
    setColors((current) => ({
      foreground: selectedFill || selectedColor || selectedBackground || current.foreground,
      background: selectedBorder || selectedStroke || current.background,
    }));
  }, [selectedId, selectedFill, selectedColor, selectedBackground, selectedBorder, selectedStroke]);

  useEffect(() => {
    const onTool = (event: Event) => {
      const tool = (event as CustomEvent<DrawTool>).detail;
      setActiveTool(tool ?? null);
    };
    window.addEventListener("nasaq:tool", onTool);
    return () => window.removeEventListener("nasaq:tool", onTool);
  }, []);

  useEffect(() => {
    const clearDrawMode = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveTool(null);
    };
    window.addEventListener("keydown", clearDrawMode);
    return () => window.removeEventListener("keydown", clearDrawMode);
  }, []);

  useEffect(() => {
    if (selectedId) setActiveTool(null);
  }, [selectedId]);

  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  const setLayout = () => setWide((current) => {
    const next = !current;
    try { localStorage.setItem("nasaq.tool-dock-wide", String(next)); } catch { /* storage is optional */ }
    return next;
  });
  const arm = (tool: DrawTool) => window.dispatchEvent(new CustomEvent("nasaq:tool", { detail: tool }));
  const openFlyout = (name: "text" | "shapes") => setFlyout((current) => current === name ? null : name);
  const startHold = (name: "text" | "shapes") => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    heldFlyout.current = false;
    holdTimer.current = setTimeout(() => {
      heldFlyout.current = true;
      setFlyout(name);
    }, 520);
  };
  const stopHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  const colorChange = (key: "foreground" | "background", color: string) => {
    setColors((current) => ({ ...current, [key]: color }));
    if (!selectedId) return;
    const isText = ["text", "box", "stat", "stamp", "table", "progress"].includes(selected?.type || "");
    const patch = key === "foreground"
      ? (isText ? { color } : { fill: color })
      : { borderColor: color, svgStroke: color };
    useEditor.getState().updateStyle(selectedId, patch);
  };

  const toolButton = (
    name: string,
    icon: typeof MousePointer2,
    label: string,
    shortcut: string,
    action: () => void,
    active = false,
    submenu?: "text" | "shapes",
  ) => {
    const Icon = icon;
    return (
      <div key={name} className="tool-dock-item relative">
        <button
          type="button"
          className={cn("tool-dock-button", active && "is-active")}
          aria-label={label}
          aria-pressed={active}
          title={`${label}${shortcut ? ` (${shortcut})` : ""}`}
          onClick={(event) => {
            if (heldFlyout.current) {
              heldFlyout.current = false;
              event.preventDefault();
              return;
            }
            action();
          }}
          onPointerDown={(event) => { if (event.pointerType !== "mouse" && submenu) startHold(submenu); }}
          onPointerUp={stopHold}
          onPointerCancel={() => { stopHold(); heldFlyout.current = false; }}
          onPointerLeave={stopHold}
          onContextMenu={(event) => { if (submenu) { event.preventDefault(); openFlyout(submenu); } }}
        >
          <Icon className="size-[18px]" strokeWidth={1.8} />
          {submenu && <span className="tool-dock-flyout-mark" aria-hidden="true">▸</span>}
          <span className="tool-dock-label">{label}</span>
          {shortcut && <kbd className="tool-dock-shortcut">{shortcut}</kbd>}
        </button>
        {submenu && flyout === submenu && (
          <div className="tool-dock-flyout" role="menu" onClickCapture={() => { heldFlyout.current = false; }}>
            {submenu === "text" ? (
              <>
                <button type="button" role="menuitem" onClick={() => { onOpenLeft("elements"); arm("text"); setFlyout(null); }}><Type className="size-4" /> نص بالرسم</button>
                <button type="button" role="menuitem" onClick={() => { useEditor.getState().addElement("box"); setFlyout(null); }}><Square className="size-4" /> مربع نص</button>
              </>
            ) : (
              <>
                <button type="button" role="menuitem" onClick={() => { onOpenLeft("shapes"); arm("rect"); setFlyout(null); }}><Square className="size-4" /> مستطيل بالرسم</button>
                <button type="button" role="menuitem" onClick={() => { onOpenLeft("shapes"); setFlyout(null); }}><Shapes className="size-4" /> مكتبة الأشكال</button>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className={cn("studio-tool-dock", wide && "is-wide")} aria-label="شريط الأدوات">
      <button type="button" className="tool-dock-layout" onClick={setLayout} aria-label={wide ? "تصغير شريط الأدوات" : "توسيع شريط الأدوات إلى عمودين"} title={wide ? "تصغير شريط الأدوات" : "توسيع شريط الأدوات"}>
        <ChevronsRight className={cn("size-4", wide && "rotate-180")} />
        <span className="sr-only">{wide ? "تصغير" : "توسيع"}</span>
      </button>
      <div className="tool-dock-tools">
        {toolButton("select", MousePointer2, "تحديد وتحريك", "V", () => arm(null), activeTool === null)}
        {toolButton("text", PenLine, "نص بالرسم", "T", () => { onOpenLeft("elements"); arm("text"); }, activeTool === "text", "text")}
        {toolButton("shape", Shapes, "مستطيل / أشكال", "R", () => { onOpenLeft("shapes"); arm("rect"); }, activeTool === "rect", "shapes")}
        {toolButton("image", ImageIcon, "إضافة صورة", "", onUploadImage)}
        {toolButton("library", FolderOpen, "المكتبة", "", () => onOpenLeft("library"))}
        {toolButton("layers", Layers, "الطبقات", "", () => onOpenRight("layers"))}
        {toolButton("properties", PanelRight, "الخصائص", "", () => onOpenRight("properties"))}
        {toolButton("colors", Palette, "ألوان التعبئة والإطار", "", () => foregroundInput.current?.click())}
      </div>
      <div className="tool-dock-colors" aria-label="ألوان التعبئة والإطار">
        <button type="button" className="tool-color-swatch tool-color-background" style={{ backgroundColor: background }} onClick={() => backgroundInput.current?.click()} aria-label="لون الإطار / الخلفية" title="لون الإطار / الخلفية">
          <input ref={backgroundInput} type="color" value={/^#[\da-f]{6}$/i.test(background) ? background : "#f4f5f6"} aria-label="اختيار لون الإطار" onClick={(event) => event.stopPropagation()} onChange={(event) => colorChange("background", event.target.value)} />
        </button>
        <button type="button" className="tool-color-swatch tool-color-foreground" style={{ backgroundColor: foreground }} onClick={() => foregroundInput.current?.click()} aria-label="لون التعبئة / المقدمة" title="لون التعبئة / المقدمة">
          <input ref={foregroundInput} type="color" value={/^#[\da-f]{6}$/i.test(foreground) ? foreground : "#2563eb"} aria-label="اختيار لون التعبئة" onClick={(event) => event.stopPropagation()} onChange={(event) => colorChange("foreground", event.target.value)} />
        </button>
      </div>
    </aside>
  );
}

export function CollapsedPanelDock({
  side,
  onExpand,
  onTab,
}: {
  side: "left" | "right";
  onExpand: () => void;
  onTab: () => void;
}) {
  const Icon = side === "left" ? FolderOpen : Layers;
  return (
    <aside className="collapsed-panel-dock" aria-label={side === "left" ? "لوحة العناصر المطوية" : "لوحة الخصائص المطوية"}>
      <button type="button" className="collapsed-dock-expand" onClick={onExpand} title="توسيع اللوحة" aria-label="توسيع اللوحة"><ChevronsRight className="size-4" /></button>
      <button type="button" className="collapsed-dock-tab" onClick={onTab} title={side === "left" ? "فتح المكتبة" : "فتح الطبقات"} aria-label={side === "left" ? "فتح المكتبة" : "فتح الطبقات"}><Icon className="size-4" /></button>
    </aside>
  );
}
