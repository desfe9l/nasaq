import { Eye, Printer, ZoomIn, ZoomOut } from "lucide-react";
import { zoomAnchoredAt } from "@/lib/editor/viewport";
import { useEditor } from "@/lib/editor/store";
import { AnchorMenu, MenuGroup, MenuRow } from "./ui/AnchorMenu";
import { IconButton } from "./ui/IconButton";

const APPEARANCE_MODES = [
  { id: "light", label: "فاتح" },
  { id: "dim", label: "متوسط" },
  { id: "dark", label: "داكن" },
] as const;

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
  const leftOpen = useEditor((s) => s.leftOpen);
  const rightOpen = useEditor((s) => s.rightOpen);
  const layersOpen = useEditor((s) => s.layersOpen);
  const reportToolsOpen = useEditor((s) => s.reportToolsOpen);
  const libraryOpen = useEditor((s) => s.libraryOpen);
  const toolsOpen = useEditor((s) => s.toolsOpen);
  const pagesRailCollapsed = useEditor((s) => s.pagesRailCollapsed);
  const pagesRailHidden = useEditor((s) => s.pagesRailHidden);
  const togglePagesRail = useEditor((s) => s.togglePagesRail);
  const togglePagesRailHidden = useEditor((s) => s.togglePagesRailHidden);
  const bubbleEnabled = useEditor((s) => s.bubbleEnabled);
  const artboardGridCols = useEditor((s) => s.artboardGridCols);
  const setArtboardGridCols = useEditor((s) => s.setArtboardGridCols);
  const toggle = useEditor((s) => s.toggle);
  const toggleBubble = useEditor((s) => s.toggleBubble);
  const printGuides = useEditor((s) => s.printGuides);
  const togglePrintGuide = useEditor((s) => s.togglePrintGuide);
  const zoom = useEditor((s) => s.zoom);
  const appearance = useEditor((s) => s.appearance);
  const setAppearance = useEditor((s) => s.setAppearance);
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
          hint="الزوم، المظهر، الصفحات واللوحات"
          icon={<Eye className="size-4" strokeWidth={1.7} />}
          data-tour="view"
        />
      )}
    >
      {/* The zoom keys are printed once, on the header's zoom cluster — the
          control an author actually presses. Repeating ⌘+/⌘−/⌘0 here put the
          same three badges in two places for no gain. */}
      <MenuGroup title="المقياس" />
      <MenuRow
        icon={<ZoomIn className="size-4" />}
        label="تكبير"
        onSelect={() => zoomBy(0.08)}
      />
      <MenuRow
        icon={<ZoomOut className="size-4" />}
        label="تصغير"
        onSelect={() => zoomBy(-0.08)}
      />
      <MenuRow label="ملاءمة لوحة الصفحة" onSelect={fitToScreen} />
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
      <MenuGroup title="مظهر مساحة العمل" />
      {APPEARANCE_MODES.map((mode) => (
        <MenuRow
          key={mode.id}
          label={mode.id === "dim" ? "متوسط / خافت" : mode.label}
          checked={appearance === mode.id}
          onSelect={() => setAppearance(mode.id)}
        />
      ))}
      {/* The six independent windows — each can be on at the same time. */}
      <MenuRow
        label="المكتبة"
        checked={libraryOpen}
        onSelect={() => toggle("libraryOpen")}
      />
      <MenuRow
        label="أدوات العناصر"
        checked={toolsOpen}
        onSelect={() => toggle("toolsOpen")}
      />
      <MenuRow
        label="لوحة العناصر"
        checked={leftOpen}
        onSelect={() => toggle("leftOpen")}
      />
      <MenuRow
        label="الخصائص"
        checked={rightOpen}
        onSelect={() => toggle("rightOpen")}
      />
      <MenuRow
        label="الطبقات"
        checked={layersOpen}
        onSelect={() => toggle("layersOpen")}
      />
      <MenuRow
        label="أدوات التقرير"
        checked={reportToolsOpen}
        onSelect={() => toggle("reportToolsOpen")}
      />
      <MenuRow
        label="شريط الصفحات المصغّر"
        checked={!pagesRailCollapsed && !pagesRailHidden}
        onSelect={() => togglePagesRail()}
      />
      <MenuRow
        label="إخفاء شريط الصفحات"
        checked={pagesRailHidden}
        hint="يزيد مساحة العمل — أعيده من هنا أو من شريط الحالة"
        onSelect={() => togglePagesRailHidden()}
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
