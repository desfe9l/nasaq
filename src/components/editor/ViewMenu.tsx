import { Eye, Printer, ZoomIn, ZoomOut } from "lucide-react";
import { zoomAnchoredAt } from "@/lib/editor/viewport";
import { useEditor } from "@/lib/editor/store";
import { OPEN_EDITOR_SETTINGS_EVENT } from "@/lib/editor/ui-state";
import { AnchorMenu, MenuGroup, MenuRow } from "./ui/AnchorMenu";
import { IconButton } from "./ui/IconButton";

/**
 * «عرض» — the view options, behind one icon.
 *
 * Grid, snapping, page preview, artboard columns, print guides, full screen and
 * the workspace appearance used to be permanent header switches and status-bar
 * text buttons competing with the document for attention. They are all
 * still here, still one click away, and none of them now holds a slot in the
 * bar: view state is something the author changes, not something they look at
 * all day.
 */
export function ViewMenu({
  fitToScreen,
  fitToSelection,
}: {
  fitToScreen: () => void;
  fitToSelection: () => void;
}) {
  const setZoom = useEditor((s) => s.setZoom);
  const showGrid = useEditor((s) => s.showGrid);
  const snapGrid = useEditor((s) => s.snapGrid);
  const snapElements = useEditor((s) => s.snapElements);
  const previewAll = useEditor((s) => s.previewAll);
  const focusMode = useEditor((s) => s.focusMode);
  const bubbleEnabled = useEditor((s) => s.bubbleEnabled);
  const artboardGridCols = useEditor((s) => s.artboardGridCols);
  const setArtboardGridCols = useEditor((s) => s.setArtboardGridCols);
  const toggle = useEditor((s) => s.toggle);
  const toggleBubble = useEditor((s) => s.toggleBubble);
  const printGuides = useEditor((s) => s.printGuides);
  const togglePrintGuide = useEditor((s) => s.togglePrintGuide);
  const zoom = useEditor((s) => s.zoom);
  /** Zoom around the middle of the live stage, so the page never jumps. */
  const zoomBy = (delta: number) => {
    const stage = document.querySelector<HTMLElement>(".editor-canvas-stage");
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    zoomAnchoredAt(
      stage,
      zoom,
      zoom + delta,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
  };

  return (
    <AnchorMenu
      label="عرض"
      width={264}
      trigger={({ ref, ...props }) => (
        <IconButton
          {...props}
          ref={ref}
          label="عرض"
          hint="الشبكة، المحاذاة، الأدلة وملء الشاشة"
          icon={<Eye className="size-4" strokeWidth={1.7} />}
        />
      )}
    >
      <MenuGroup title="المقياس" />
      <MenuRow
        icon={<ZoomIn className="size-4" />}
        label="تكبير"
        shortcut="⌘+"
        onSelect={() => zoomBy(0.08)}
      />
      <MenuRow
        icon={<ZoomOut className="size-4" />}
        label="تصغير"
        shortcut="⌘−"
        onSelect={() => zoomBy(-0.08)}
      />
      <MenuRow label="ملاءمة لوحة الصفحة" shortcut="⌘0" onSelect={fitToScreen} />
      <MenuRow label="ملاءمة التحديد" onSelect={fitToSelection} />
      <MenuRow label="مقياس 100%" onSelect={() => setZoom(1)} />
      <MenuRow
        label="ملء الشاشة"
        checked={typeof document !== "undefined" && !!document.fullscreenElement}
        onSelect={() => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.().catch(() => {});
        }}
      />
      <MenuGroup title="العرض" />
      <MenuRow
        label="عرض كل الصفحات"
        checked={previewAll}
        onSelect={() => toggle("previewAll")}
      />
      <MenuRow
        label="إظهار الشبكة"
        checked={showGrid}
        onSelect={() => toggle("showGrid")}
      />
      <MenuRow
        label="محاذاة للشبكة"
        checked={snapGrid}
        onSelect={() => toggle("snapGrid")}
      />
      <MenuRow
        label="محاذاة للعناصر"
        checked={snapElements}
        onSelect={() => toggle("snapElements")}
      />
      <MenuGroup title="أدلة الطباعة" />
      <MenuRow
        icon={<Printer className="size-4" />}
        label="المنطقة الآمنة"
        hint="حدّ النص ببعد ١٠ مم"
        checked={Boolean(printGuides?.safe)}
        onSelect={() => togglePrintGuide("safe")}
      />
      <MenuRow
        icon={<Printer className="size-4" />}
        label="هامش التجليد"
        hint="١٥ مم عند الحافة اليمنى"
        checked={Boolean(printGuides?.gutter)}
        onSelect={() => togglePrintGuide("gutter")}
      />
      <MenuRow
        icon={<Printer className="size-4" />}
        label="القص الزائد"
        hint="٣ مم وعلامات القص"
        checked={Boolean(printGuides?.bleed)}
        onSelect={() => togglePrintGuide("bleed")}
      />
      <MenuGroup title="مساحة العمل" />
      <div className="editor-menu-grid" dir="ltr">
        {[1, 2, 3, 4, 6].map((cols) => (
          <button
            key={cols}
            type="button"
            onClick={() => setArtboardGridCols(cols)}
            className={artboardGridCols === cols ? "is-active" : ""}
            title={`${cols} أعمدة للوحات`}
          >
            {cols}
          </button>
        ))}
      </div>
      <MenuRow
        label="مظهر المحرر"
        onSelect={() =>
          window.dispatchEvent(new CustomEvent(OPEN_EDITOR_SETTINGS_EVENT))
        }
      />
      <MenuRow
        label="الشريط العائم للعنصر المحدد"
        checked={bubbleEnabled}
        onSelect={() => toggleBubble()}
      />
      <MenuRow
        label="وضع التركيز"
        checked={focusMode}
        onSelect={() => toggle("focusMode")}
      />
    </AnchorMenu>
  );
}
