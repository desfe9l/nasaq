import { useEffect, useMemo, useState } from "react";
import {
  AlignCenter,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  Eye,
  Focus,
  Group,
  Keyboard,
  Layers,
  Lock,
  Maximize2,
  PenLine,
  Redo2,
  Scissors,
  Search,
  Settings2,
  Trash2,
  Ungroup,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEditor, type ContextMenuPoint } from "@/lib/editor/store";
import { findElement } from "@/lib/editor/model";
import { cn } from "@/lib/utils";

/**
 * The menu is opened by the canvas AND by the layer tree; both write the same
 * store slot, so the type lives there (`ContextMenuPoint`) and this file only
 * re-exports it for the shell.
 */
type MenuPoint = ContextMenuPoint;
type ContextAction = { label: string; icon: typeof Copy; run: () => void; disabled?: boolean; danger?: boolean; sepBefore?: boolean };

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
  const enterGroup = useEditor((s) => s.enterGroup);
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
  /*
   * قناع القص (Clipping Mask): applies only when the selection is exactly an
   * image-family element (image/logo/svg/qr) + a shape — the only pair the
   * mask has meaning for. Any other selection hides the entries entirely.
   */
  const applyMask = useEditor((s) => s.applyClipMask);
  const removeMask = useEditor((s) => s.removeClipMask);
  const selectedEls = selectedElements();
  const maskSource = selectedEls.find((el) => el.type === "image" || el.type === "logo" || el.type === "qr");
  const maskShape = selectedEls.find((el) => el.type === "shape" || el.type === "svg");
  const maskApplicable = !!maskSource && !!maskShape && selectedEls.length === 2;
  const maskRemovable = selectedEls.length === 1 && !!selectedEls[0].clippedBy;
  const renameElement = useEditor((s) => s.renameElement);
  // selectedElements() preserves selection order with the primary LAST.
  const primaryName = selectedEls.length ? selectedEls[selectedEls.length - 1].name : undefined;
  const primaryIsGroup = selectedEls.length === 1 && selectedEls[selectedEls.length - 1].type === "group";
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  /** Group, then open the naming dialog for the fresh group right away — grouping
   *  without naming leaves «مجموعة 1» rows that nobody can tell apart. */
  const groupAndName = () => {
    const id = group();
    if (!id) return;
    const state = useEditor.getState();
    const page = state.pages.find((p) => p.id === state.activePageId);
    const created = page ? findElement(page.elements, id)?.el : undefined;
    setRenaming({ id, name: created?.name || "" });
  };
  const openProperties = () => {
    const state = useEditor.getState();
    state.setRightTab("properties");
    // The properties tab is useless while the panel is collapsed or focus mode
    // is hiding it — the action must actually bring the panel up.
    useEditor.setState({ rightCollapsed: false, focusMode: false });
  };
  const contextActions: ContextAction[] = menu?.targetId
    ? [
        { label: "نسخ", icon: Copy, run: copy },
        { label: "قص", icon: Scissors, run: () => { copy(); deleteSelected(); } },
        { label: "لصق", icon: ClipboardPaste, run: paste, disabled: !clipboard, sepBefore: true },
        { label: "تكرار العنصر", icon: CopyPlus, run: duplicate },
        { label: "إحضار للأمام", icon: Layers, run: () => bring("forward"), sepBefore: true },
        { label: "إرسال للخلف", icon: Layers, run: () => bring("back") },
        { label: "إلى المقدمة تمامًا", icon: Layers, run: () => bring("front") },
        { label: "إلى الخلف تمامًا", icon: Layers, run: () => bring("bottom") },
        ...(selectedCount >= 2 ? [{ label: "تجميع العناصر", icon: Group, run: groupAndName, sepBefore: true } as ContextAction] : []),
        ...(primaryIsGroup ? [{ label: "الدخول إلى المجموعة", icon: Group, run: () => enterGroup(selectedEls[selectedEls.length - 1].id) } as ContextAction] : []),
        ...(selectedTypes.includes("group") ? [{ label: "فك تجميع العناصر", icon: Ungroup, run: ungroup } as ContextAction] : []),
        ...(maskApplicable ? [{ label: "تطبيق قناع القص (Clipping Mask)", icon: Group, run: () => applyMask(maskSource!.id, maskShape!.id), sepBefore: true } as ContextAction] : []),
        ...(maskRemovable ? [{ label: "إزالة قناع القص", icon: Ungroup, run: () => removeMask(selectedEls[0].clippedBy!) } as ContextAction] : []),
        { label: "قفل العنصر / فتح قفل العنصر", icon: Lock, run: toggleLock, sepBefore: true },
        { label: "إخفاء / إظهار", icon: Eye, run: toggleHidden },
        {
          label: primaryIsGroup ? "تسمية المجموعة…" : "إعادة تسمية…",
          icon: PenLine,
          run: () => setRenaming({ id: menu.targetId!, name: primaryName || "" }),
          disabled: selectedCount > 1,
        },
        { label: "الخصائص", icon: Settings2, run: openProperties },
        { label: "حذف", icon: Trash2, run: deleteSelected, danger: true, sepBefore: true },
      ]
    : [
        { label: "لصق", icon: ClipboardPaste, run: paste, disabled: !clipboard },
        /*
         * The selection — not the point — decides grouping here: a right-click
         * that missed the artwork still has the selected elements in the store,
         * so تجميع/فك التجميع must appear exactly as they do over an element.
         * Their absence here is what hid grouping from the empty-space menu
         * even with several elements selected.
         */
        ...(selectedCount >= 2 ? [{ label: "تجميع العناصر", icon: Group, run: groupAndName, sepBefore: true } as ContextAction] : []),
        ...(selectedTypes.includes("group") ? [{ label: "فك تجميع العناصر", icon: Ungroup, run: ungroup } as ContextAction] : []),
        { label: "تحديد الكل", icon: AlignCenter, run: selectAll },
        { label: "عرض الصفحة بالكامل", icon: Maximize2, run: fitToScreen },
        { label: "وضع التركيز", icon: Focus, run: () => toggle("focusMode") },
        { label: "إظهار / إخفاء الشبكة", icon: Eye, run: () => toggle("showGrid") },
      ];

  return (
    <>
      {menu && (
        <div className="editor-context-backdrop fixed inset-0 z-[var(--z-context)]" onPointerDown={onCloseMenu} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCloseMenu(); } }} tabIndex={-1} autoFocus>
          <div
            className="editor-context-menu fixed min-w-[210px] rounded-[8px] border p-1.5 shadow-2xl"
            style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 480) }}
            onPointerDown={(event) => event.stopPropagation()}
            role="menu"
          >
            {contextActions.map((action) => {
              const Icon = action.icon;
              return (
                <div key={action.label}>
                  {action.sepBefore && <div className="my-1 border-t border-[var(--editor-border)]" />}
                  <button type="button" role="menuitem" disabled={action.disabled} onClick={() => { if (menu.targetId && selectedCount === 0) select(menu.targetId); action.run(); onCloseMenu(); }} className={cn("editor-menu-item flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-right text-[11px] font-bold disabled:opacity-35", action.danger && "editor-menu-danger")}><Icon className="size-3.5 shrink-0" /><span>{action.label}</span></button>
                </div>
              );
            })}
            <div className="my-1 border-t border-[var(--editor-border)]" />
            <span className="flex items-center gap-2 px-2.5 py-1.5 text-[9px] text-[var(--editor-text-secondary)]"><Keyboard className="size-3" /> اضغط Escape للإغلاق</span>
          </div>
        </div>
      )}

      {renaming && (
        /* Inline rename for the element the menu was opened on — the same
           contract as the library dialogs: backdrop does not confirm, focus
           starts on the input, Enter saves, Escape cancels. */
        <div
          className="fixed inset-0 z-[calc(var(--z-context)+1)] grid place-items-center bg-navy/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={primaryIsGroup ? "تسمية المجموعة" : "إعادة تسمية العنصر"}
          onKeyDown={(event) => { if (event.key === "Escape") setRenaming(null); }}
          onPointerDown={onCloseMenu}
        >
          <form
            className="grid w-full max-w-xs gap-3 rounded-[10px] border border-line bg-white p-4 shadow-xl dark:border-white/10 dark:bg-[#161c26]"
            onPointerDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              const next = renaming.name.trim();
              if (next) renameElement(renaming.id, next);
              setRenaming(null);
              onCloseMenu();
            }}
          >
            <strong className="text-[13px]">{primaryIsGroup ? "تسمية المجموعة" : "إعادة تسمية العنصر"}</strong>
            <input
              autoFocus
              value={renaming.name}
              onChange={(event) => setRenaming((r) => (r ? { ...r, name: event.target.value } : r))}
              aria-label="اسم العنصر"
              className="h-9 rounded-[7px] border border-line px-2 text-[12px] font-bold dark:border-white/15 dark:bg-white/5"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setRenaming(null); onCloseMenu(); }} className="h-8 rounded-[6px] border border-line px-3 text-[11px] font-bold dark:border-white/10">إلغاء</button>
              <button type="submit" className="h-8 rounded-[6px] bg-navy px-3 text-[11px] font-bold text-white">حفظ</button>
            </div>
          </form>
        </div>
      )}

      {commandOpen && (
        <div className="editor-command-backdrop fixed inset-0 z-[var(--z-command)] grid place-items-start justify-center pt-[15vh]" onPointerDown={() => setCommandOpen(false)}>
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
    <div
      data-editor-obstacle="status-bar"
      className="editor-status-bar flex h-7 shrink-0 items-center justify-between gap-3 border-t px-3 text-[10px] tabular-nums"
    >
      {/*
        * `selectable-value`: page size / element count / zoom are numbers an
        * author copies into a brief, so they opt back into text selection while
        * the rest of the chrome stays unselectable.
        */}
      <span className="selectable-value min-w-0 truncate">
        {page?.name || "صفحة"}
        {page ? ` · ${Math.round(page.w || 210)} × ${Math.round(page.h || 297)} مم` : ""}
        {page ? ` · ${page.elements.length} عنصر` : ""}
      </span>
      <span className="selectable-value">{selectedIds.length ? `${selectedIds.length} محدد` : "لا يوجد تحديد"}</span>
      <span className="selectable-value">{Math.round(zoom * 100)}%</span>
    </div>
  );
}
