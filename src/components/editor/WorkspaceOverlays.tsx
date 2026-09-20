import { useEffect, useMemo, useState } from "react";
import {
  AlignCenter,
  Copy,
  Download,
  Eye,
  Focus,
  Group,
  Keyboard,
  Layers,
  Lock,
  Maximize2,
  Redo2,
  Search,
  Trash2,
  Ungroup,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEditor } from "@/lib/editor/store";
import { cn } from "@/lib/utils";

type MenuPoint = { x: number; y: number; targetId: string | null };
type ContextAction = { label: string; icon: typeof Copy; run: () => void; disabled?: boolean; danger?: boolean };

const ACTIONS = [
  { id: "undo", label: "تراجع", hint: "⌘ Z", icon: Undo2 },
  { id: "redo", label: "إعادة", hint: "⌘ ⇧ Z", icon: Redo2 },
  { id: "duplicate", label: "تكرار العنصر", hint: "⌘ D", icon: Copy },
  { id: "group", label: "تجميع المحدد", hint: "⌘ G", icon: Group },
  { id: "ungroup", label: "فك التجميع", hint: "⌘ ⇧ G", icon: Ungroup },
  { id: "zoom-fit", label: "ملاءمة مساحة العمل", hint: "⇧ 1", icon: Maximize2 },
  { id: "zoom-in", label: "تكبير", hint: "⌘ +", icon: ZoomIn },
  { id: "zoom-out", label: "تصغير", hint: "⌘ -", icon: ZoomOut },
  { id: "focus", label: "وضع التركيز", hint: "", icon: Focus },
  { id: "export", label: "تصدير", hint: "⌘ E", icon: Download },
];

export function WorkspaceOverlays({
  menu,
  onCloseMenu,
  fitToScreen,
}: {
  menu: MenuPoint | null;
  onCloseMenu: () => void;
  fitToScreen: () => void;
}) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const duplicate = useEditor((s) => s.duplicateSelected);
  const group = useEditor((s) => s.group);
  const ungroup = useEditor((s) => s.ungroup);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const copy = useEditor((s) => s.copySelected);
  const paste = useEditor((s) => s.pasteClipboard);
  const bring = useEditor((s) => s.bring);
  const toggleLock = useEditor((s) => s.toggleLock);
  const toggleHidden = useEditor((s) => s.toggleHidden);
  const toggle = useEditor((s) => s.toggle);
  const setZoom = useEditor((s) => s.setZoom);
  const zoom = useEditor((s) => s.zoom);
  const selectAll = useEditor((s) => s.selectAll);
  const select = useEditor((s) => s.select);
  const selectedCount = useEditor((s) => s.selectedIds.length);
  const selectedElements = useEditor((s) => s.selectedElements);
  const clipboard = useEditor((s) => s.clipboard);

  const filtered = useMemo(
    () => ACTIONS.filter((action) => action.label.includes(query.trim()) || action.id.includes(query.trim().toLowerCase())),
    [query],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (typing) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
        setQuery("");
        setActiveIndex(0);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        onCloseMenu();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCloseMenu]);

  const run = (id: string) => {
    switch (id) {
      case "undo": undo(); break;
      case "redo": redo(); break;
      case "duplicate": duplicate(); break;
      case "group": group(); break;
      case "ungroup": ungroup(); break;
      case "zoom-fit": fitToScreen(); break;
      case "zoom-in": setZoom(zoom + 0.08); break;
      case "zoom-out": setZoom(zoom - 0.08); break;
      case "focus": toggle("focusMode"); break;
      case "export": toggle("exportOpen"); break;
    }
    setCommandOpen(false);
    onCloseMenu();
  };

  const selectedTypes = selectedElements().map((item) => item.type);
  const contextActions: ContextAction[] = menu?.targetId
    ? [
        { label: "نسخ", icon: Copy, run: copy },
        { label: "تكرار", icon: Copy, run: duplicate },
        { label: "تقديم", icon: Layers, run: () => bring("forward") },
        { label: "إرسال للخلف", icon: Layers, run: () => bring("back") },
        ...(selectedCount >= 2 ? [{ label: "تجميع", icon: Group, run: group }] : []),
        ...(selectedTypes.includes("group") ? [{ label: "فك التجميع", icon: Ungroup, run: ungroup }] : []),
        { label: "قفل / فتح القفل", icon: Lock, run: toggleLock },
        { label: "إخفاء / إظهار", icon: Eye, run: toggleHidden },
        { label: "حذف", icon: Trash2, run: deleteSelected, danger: true },
      ]
    : [
        { label: "لصق", icon: Copy, run: paste, disabled: !clipboard },
        { label: "تحديد الكل", icon: AlignCenter, run: selectAll },
        { label: "تكبير", icon: ZoomIn, run: () => setZoom(zoom + 0.08) },
        { label: "تصغير", icon: ZoomOut, run: () => setZoom(zoom - 0.08) },
        { label: "ملاءمة مساحة العمل", icon: Maximize2, run: fitToScreen },
        { label: "وضع التركيز", icon: Focus, run: () => toggle("focusMode") },
        { label: "إظهار / إخفاء الشبكة", icon: Eye, run: () => toggle("showGrid") },
      ];

  return (
    <>
      {menu && (
        <div className="editor-context-backdrop fixed inset-0 z-[100]" onPointerDown={onCloseMenu} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCloseMenu(); } }} tabIndex={-1} autoFocus>
          <div
            className="editor-context-menu fixed min-w-[210px] rounded-[8px] border p-1.5 shadow-2xl"
            style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 360) }}
            onPointerDown={(event) => event.stopPropagation()}
            role="menu"
          >
            {contextActions.map((action) => {
              const Icon = action.icon;
              return <button key={action.label} type="button" role="menuitem" disabled={action.disabled} onClick={() => { if (menu.targetId && selectedCount === 0) select(menu.targetId); action.run(); onCloseMenu(); }} className={cn("editor-menu-item flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-right text-[11px] font-bold disabled:opacity-35", action.danger && "editor-menu-danger")}><Icon className="size-3.5 shrink-0" /><span>{action.label}</span></button>;
            })}
            <div className="my-1 border-t border-[var(--editor-border)]" />
            <span className="flex items-center gap-2 px-2.5 py-1.5 text-[9px] text-[var(--editor-text-secondary)]"><Keyboard className="size-3" /> اضغط Escape للإغلاق</span>
          </div>
        </div>
      )}

      {commandOpen && (
        <div className="editor-command-backdrop fixed inset-0 z-[110] grid place-items-start justify-center pt-[15vh]" onPointerDown={() => setCommandOpen(false)}>
          <div className="editor-command-menu w-[min(520px,calc(100vw-32px))] overflow-hidden rounded-[10px] border shadow-2xl" onPointerDown={(event) => event.stopPropagation()} role="dialog" aria-label="قائمة الأوامر">
            <div className="flex items-center gap-2 border-b px-3"><Search className="size-4 text-[var(--editor-text-secondary)]" /><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, filtered.length - 1)); } if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); } if (event.key === "Enter" && filtered[activeIndex]) run(filtered[activeIndex].id); }} placeholder="ابحث عن أمر…" className="h-12 min-w-0 flex-1 bg-transparent text-[13px] outline-none" /></div>
            <div className="max-h-[330px] overflow-auto p-1.5">
              {filtered.map((action, index) => { const Icon = action.icon; return <button key={action.id} type="button" onClick={() => run(action.id)} className={cn("flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2.5 text-right text-[12px] font-bold", index === activeIndex && "editor-command-active")}><Icon className="size-4" /><span className="flex-1">{action.label}</span><kbd>{action.hint || ""}</kbd></button>; })}
              {!filtered.length && <p className="p-5 text-center text-[11px] text-[var(--editor-text-secondary)]">لا توجد أوامر مطابقة</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export type { MenuPoint };

export function WorkspaceStatusBar() {
  const zoom = useEditor((s) => s.zoom);
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const page = pages.find((item) => item.id === activePageId);
  /*
   * The page summary lives here instead of a floating pill over the canvas:
   * a badge pinned inside the canvas area covered element labels and had to be
   * dodged by the arrange bar. The status bar is part of the workspace chrome,
   * so it can never overlap artwork.
   */
  return (
    <div className="editor-status-bar flex h-7 shrink-0 items-center justify-between gap-3 border-t px-3 text-[10px] tabular-nums">
      <span className="min-w-0 truncate">
        {page?.name || "صفحة"}
        {page ? ` · ${Math.round(page.w || 210)} × ${Math.round(page.h || 297)} مم` : ""}
        {page ? ` · ${page.elements.length} عنصر` : ""}
      </span>
      <span>{selectedIds.length ? `${selectedIds.length} محدد` : "لا يوجد تحديد"}</span>
      <span>{Math.round(zoom * 100)}%</span>
    </div>
  );
}
