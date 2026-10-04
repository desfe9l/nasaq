import { Eye, Moon, Printer, Sun, SunDim, ZoomIn, ZoomOut } from "lucide-react";
import { zoomAnchoredAt } from "@/lib/editor/viewport";
import { useEditor } from "@/lib/editor/store";
import { AnchorMenu, MenuGroup, MenuRow } from "./ui/AnchorMenu";
import { IconButton } from "./ui/IconButton";
import type { EditorPanelId } from "@/lib/editor/panel-groups";
import {
  DOCK_EDGE_LABELS,
  DOCK_EDGE_PREFERENCES,
  type DockEdgePreference,
} from "@/lib/editor/workspace-dock";

const APPEARANCE_MODES = [
  { id: "light", label: "فاتح", Icon: Sun },
  { id: "dim", label: "متوسط", Icon: SunDim },
  { id: "dark", label: "داكن", Icon: Moon },
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
  panelChecked,
  onTogglePanel,
  dockPref,
  onDockPref,
}: {
  fitToScreen: () => void;
  fitToSelection: () => void;
  /** Which of the six panels is actually on screen (grouping-aware). */
  panelChecked: Record<EditorPanelId, boolean>;
  onTogglePanel: (id: EditorPanelId) => void;
  /** The workspace's preferred pin edge for windows. */
  dockPref: DockEdgePreference;
  onDockPref: (pref: DockEdgePreference) => void;
}) {
  const setZoom = useEditor((s) => s.setZoom);
  const showGrid = useEditor((s) => s.showGrid);
  const snapGrid = useEditor((s) => s.snapGrid);
  const snapElements = useEditor((s) => s.snapElements);
  const previewAll = useEditor((s) => s.previewAll);
  const focusMode = useEditor((s) => s.focusMode);
  const appearance = useEditor((s) => s.appearance);
  const setAppearance = useEditor((s) => s.setAppearance);
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
  const clipExport = useEditor((s) => s.clipExport);
  const setClipExport = useEditor((s) => s.setClipExport);
  const activePage = useEditor((s) =>
    s.pages.find((page) => page.id === s.activePageId),
  );
  const setPageBackground = useEditor((s) => s.setPageBackground);
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
      {/* The six windows come FIRST — they are what authors open this menu
          for most. Fixed order, لوحة العناصر leading; grouping-aware: a panel
          that lives inside another window toggles THAT window on its tab. */}
      <MenuGroup title="نوافذ مساحة العمل" />
      <MenuRow
        label="التخطيط الافتراضي"
        hint="يعيد اللوحات والأحجام والمواضع دون المساس بالمشروع أو الصفحات"
        onSelect={() => useEditor.getState().resetWorkspaceLayout()}
      />
      {(
        [
          ["elements", "لوحة العناصر"],
          ["tools", "أدوات العناصر"],
          ["library", "المكتبة"],
          ["report", "أدوات التقرير"],
          ["properties", "الخصائص"],
          ["layers", "الطبقات"],
        ] as [EditorPanelId, string][]
      ).map(([id, label]) => (
        <MenuRow
          key={id}
          label={label}
          checked={panelChecked[id]}
          onSelect={() => onTogglePanel(id)}
        />
      ))}
      <MenuGroup title="حافة تثبيت النوافذ الافتراضية" />
      {DOCK_EDGE_PREFERENCES.map((pref) => (
        <MenuRow
          key={pref}
          label={DOCK_EDGE_LABELS[pref]}
          checked={dockPref === pref}
          onSelect={() => onDockPref(pref)}
        />
      ))}
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
      <MenuRow
        label="إعادة ضبط العرض"
        hint="الصفحة داخل المساحة المتاحة"
        onSelect={fitToScreen}
      />
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
      <MenuGroup title="أعمدة اللوحات" />
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
          icon={<mode.Icon className="size-4" />}
          label={mode.id === "dim" ? "متوسط / خافت" : mode.label}
          checked={appearance === mode.id}
          onSelect={() => setAppearance(mode.id)}
        />
      ))}
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
        label="إخفاء العناصر خارج الصفحة"
        checked={Boolean(activePage?.clipContent)}
        hint="يقص الظهور فقط — العناصر تبقى في الملف"
        onSelect={() => {
          if (!activePage) return;
          setPageBackground(activePage.id, {
            clipContent: !activePage.clipContent,
          });
        }}
      />
      <MenuRow
        label="قص التصدير على حدود الصفحة"
        checked={clipExport !== false}
        hint="لا يؤثر على أبعاد الصفحة ولا يحذف العناصر"
        onSelect={() => setClipExport(clipExport === false)}
      />
      <MenuRow
        label="وضع التركيز"
        checked={focusMode}
        onSelect={() => toggle("focusMode")}
      />
    </AnchorMenu>
  );
}
