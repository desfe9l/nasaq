import { useEffect, useMemo, useState } from "react";
import {
  AlignCenter,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalJustifyCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalJustifyCenter,
  ClipboardPaste,
  Contrast,
  Copy,
  CopyPlus,
  Download,
  Eye,
  FlipHorizontal2,
  FlipVertical2,
  Focus,
  Group,
  Keyboard,
  Layers,
  Lock,
  Maximize2,
  Move,
  PenLine,
  Redo2,
  RotateCw,
  RotateCcw,
  Scaling,
  Scissors,
  Search,
  Settings2,
  Square,
  Trash2,
  Type,
  Ungroup,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEditor, type ContextMenuPoint } from "@/lib/editor/store";
import { normalizeFade } from "@/lib/editor/fade";
import { findElement } from "@/lib/editor/model";
import type { PrintGuideSettings } from "@/lib/editor/print-guides";
import { cn } from "@/lib/utils";

type MenuPoint = ContextMenuPoint;
type ContextAction = {
  label: string;
  icon: typeof Copy;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
  sepBefore?: boolean;
  hint?: string;
};

const ACTIONS = [
  { id: "undo", label: "تراجع", hint: "⌘ Z", icon: Undo2 },
  { id: "redo", label: "إعادة", hint: "⌘ ⇧ Z", icon: Redo2 },
  { id: "duplicate", label: "تكرار العنصر", hint: "⌘ D / ⌘ J", icon: Copy },
  { id: "group", label: "تجميع المحدد", hint: "⌘ G", icon: Group },
  { id: "ungroup", label: "فك التجميع", hint: "⌘ ⇧ G", icon: Ungroup },
  { id: "invert-selection", label: "عكس التحديد", hint: "", icon: FlipHorizontal2 },
  { id: "zoom-fit", label: "ملاءمة مساحة العمل", hint: "⌘ 0", icon: Maximize2 },
  { id: "zoom-in", label: "تكبير", hint: "⌘ +", icon: ZoomIn },
  { id: "zoom-out", label: "تصغير", hint: "⌘ -", icon: ZoomOut },
  { id: "focus", label: "وضع التركيز", hint: "", icon: Focus },
  { id: "export", label: "تصدير", hint: "⌘ E", icon: Download },
  { id: "tool-move", label: "أداة التحديد والتحريك", hint: "V", icon: Move },
  { id: "tool-text", label: "أداة النص (ارسم صندوقًا)", hint: "T", icon: Type },
  { id: "tool-shape", label: "أداة الأشكال (ارسم مستطيلًا)", hint: "R", icon: Square },
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
  const distribute = useEditor((s) => s.distribute);
  const bring = useEditor((s) => s.bring);
  const toggleLock = useEditor((s) => s.toggleLock);
  const toggleResizeLock = useEditor((s) => s.toggleResizeLock);
  const toggleWidthLock = useEditor((s) => s.toggleWidthLock);
  const toggleHeightLock = useEditor((s) => s.toggleHeightLock);
  const toggleAspectLock = useEditor((s) => s.toggleAspectLock);
  const flipSelected = useEditor((s) => s.flipSelected);
  const align = useEditor((s) => s.align);
  const setLeftTab = useEditor((s) => s.setLeftTab);
  const toggleHidden = useEditor((s) => s.toggleHidden);
  const toggle = useEditor((s) => s.toggle);
  const setZoom = useEditor((s) => s.setZoom);
  const zoom = useEditor((s) => s.zoom);
  const selectAll = useEditor((s) => s.selectAll);
  const invertSelection = useEditor((s) => s.invertSelection);
  const select = useEditor((s) => s.select);
  const selectedCount = useEditor((s) => s.selectedIds.length);
  const selectedElements = useEditor((s) => s.selectedElements);
  const clipboard = useEditor((s) => s.clipboard);

  const filtered = useMemo(
    () =>
      ACTIONS.filter(
        (action) =>
          action.label.includes(query.trim()) ||
          action.id.includes(query.trim().toLowerCase()),
      ),
    [query],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
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
      case "undo":
        undo();
        break;
      case "redo":
        redo();
        break;
      case "duplicate":
        duplicate();
        break;
      case "group":
        group();
        break;
      case "ungroup":
        ungroup();
        break;
      case "invert-selection":
        invertSelection();
        break;
      case "zoom-fit":
        fitToScreen();
        break;
      case "tool-move":
        window.dispatchEvent(new CustomEvent("nasaq:tool", { detail: null }));
        break;
      case "tool-text":
        setLeftTab("elements");
        window.dispatchEvent(new CustomEvent("nasaq:tool", { detail: "text" }));
        break;
      case "tool-shape":
        setLeftTab("shapes");
        window.dispatchEvent(new CustomEvent("nasaq:tool", { detail: "rect" }));
        break;
      case "zoom-in":
        setZoom(zoom + 0.08);
        break;
      case "zoom-out":
        setZoom(zoom - 0.08);
        break;
      case "focus":
        toggle("focusMode");
        break;
      case "export":
        toggle("exportOpen");
        break;
    }
    setCommandOpen(false);
    onCloseMenu();
  };

  const selectedTypes = selectedElements().map((item) => item.type);
  const applyMask = useEditor((s) => s.applyClipMask);
  const removeMask = useEditor((s) => s.removeClipMask);
  const selectedEls = selectedElements();
  const maskSource = selectedEls.find(
    (el) => el.type === "image" || el.type === "logo" || el.type === "qr",
  );
  const maskShape = selectedEls.find(
    (el) => el.type === "shape" || el.type === "svg",
  );
  const maskApplicable =
    !!maskSource && !!maskShape && selectedEls.length === 2;
  const maskRemovable = selectedEls.length === 1 && !!selectedEls[0].clippedBy;
  const toggleFadeOverlay = useEditor((s) => s.toggleFadeOverlay);
  const fadeApplicable = selectedEls.some(
    (el) => el.type === "image" || el.type === "logo" || el.type === "qr",
  );
  const fadePresent = selectedEls.some((el) =>
    Boolean(normalizeFade(el.style?.fade)),
  );
  const renameElement = useEditor((s) => s.renameElement);
  const primaryName = selectedEls.length
    ? selectedEls[selectedEls.length - 1].name
    : undefined;
  const primaryIsGroup =
    selectedEls.length === 1 &&
    selectedEls[selectedEls.length - 1].type === "group";
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
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
    useEditor.setState({ rightCollapsed: false, focusMode: false });
  };

  const rotateSelected = (deg: number) => {
    const state = useEditor.getState();
    const page = state.pages.find((p) => p.id === state.activePageId);
    if (!page) return;
    for (const el of selectedEls) {
      if (el.locked) continue;
      const nextRot = (el.rotation || 0) + deg;
      const normalized = (((nextRot % 360) + 540) % 360) - 180;
      state.replaceElement({ ...el, rotation: normalized }, true);
    }
    state.commit();
  };

  const scaleSelected = (factor: number) => {
    const state = useEditor.getState();
    for (const el of selectedEls) {
      if (el.locked || el.resizeLocked) continue;
      const newW = Math.max(4, el.w * factor);
      const newH = Math.max(4, el.h * factor);
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;
      state.replaceElement(
        { ...el, x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH },
        true,
      );
    }
    state.commit();
  };

  const contextActions: ContextAction[] = menu?.targetId
    ? [
        {
          label: "تحديد",
          icon: Move,
          run: () => {
            if (menu.targetId) select(menu.targetId);
          },
          hint: "Tap",
        },
        { label: "نسخ", icon: Copy, run: copy, hint: "⌘C" },
        {
          label: "قص",
          icon: Scissors,
          run: () => {
            copy();
            deleteSelected();
          },
          hint: "⌘X",
        },
        {
          label: "لصق",
          icon: ClipboardPaste,
          run: () => paste(),
          disabled: !clipboard,
          hint: "⌘V",
          sepBefore: true,
        },
        {
          label: "لصق في مكانه",
          icon: ClipboardPaste,
          run: () => paste(true),
          disabled: !clipboard,
          hint: "⇧⌘V",
        },
        {
          label: "تكرار العنصر",
          icon: CopyPlus,
          run: duplicate,
          hint: "⌘J",
        },
        {
          label: "حذف",
          icon: Trash2,
          run: deleteSelected,
          danger: true,
        },
        {
          label: "إحضار للأمام",
          icon: Layers,
          run: () => bring("forward"),
          hint: "⌘]",
          sepBefore: true,
        },
        {
          label: "إرسال للخلف",
          icon: Layers,
          run: () => bring("back"),
          hint: "⌘[",
        },
        {
          label: "إلى المقدمة تمامًا",
          icon: Layers,
          run: () => bring("front"),
          hint: "⇧⌘]",
        },
        {
          label: "إلى الخلف تمامًا",
          icon: Layers,
          run: () => bring("bottom"),
          hint: "⇧⌘[",
        },
        {
          label: "محاذاة يسار",
          icon: AlignStartHorizontal,
          run: () => align("left", "selection"),
          sepBefore: true,
        },
        {
          label: "محاذاة وسط أفقي",
          icon: AlignHorizontalJustifyCenter,
          run: () => align("center", "selection"),
        },
        {
          label: "محاذاة يمين",
          icon: AlignEndHorizontal,
          run: () => align("right", "selection"),
        },
        {
          label: "محاذاة أعلى",
          icon: AlignStartVertical,
          run: () => align("top", "selection"),
        },
        {
          label: "محاذاة وسط رأسي",
          icon: AlignVerticalJustifyCenter,
          run: () => align("middle", "selection"),
        },
        {
          label: "محاذاة أسفل",
          icon: AlignEndVertical,
          run: () => align("bottom", "selection"),
        },
        {
          label: "توزيع أفقي (مسافات متساوية)",
          icon: AlignHorizontalJustifyCenter,
          run: () => distribute("h"),
          disabled: selectedCount < 3,
        },
        {
          label: "توزيع رأسي (مسافات متساوية)",
          icon: AlignVerticalJustifyCenter,
          run: () => distribute("v"),
          disabled: selectedCount < 3,
        },
        {
          label: "تدوير 90° يمين",
          icon: RotateCw,
          run: () => rotateSelected(90),
          sepBefore: true,
        },
        {
          label: "تدوير 90° يسار",
          icon: RotateCcw,
          run: () => rotateSelected(-90),
        },
        {
          label: "تدوير 180°",
          icon: RotateCw,
          run: () => rotateSelected(180),
        },
        {
          label: "تكبير 10%",
          icon: ZoomIn,
          run: () => scaleSelected(1.1),
        },
        {
          label: "تصغير 10%",
          icon: ZoomOut,
          run: () => scaleSelected(0.9),
        },
        {
          label: "قلب أفقي",
          icon: FlipHorizontal2,
          run: () => flipSelected("x"),
          sepBefore: true,
        },
        {
          label: "قلب رأسي",
          icon: FlipVertical2,
          run: () => flipSelected("y"),
        },
        ...(selectedCount >= 2
          ? [
              {
                label: "تجميع العناصر",
                icon: Group,
                run: groupAndName,
                hint: "⌘G",
                sepBefore: true,
              } as ContextAction,
            ]
          : []),
        ...(primaryIsGroup
          ? [
              {
                label: "الدخول إلى المجموعة",
                icon: Group,
                run: () => enterGroup(selectedEls[selectedEls.length - 1].id),
              } as ContextAction,
            ]
          : []),
        ...(selectedTypes.includes("group")
          ? [
              {
                label: "فك تجميع العناصر",
                icon: Ungroup,
                run: ungroup,
                hint: "⇧⌘G",
              } as ContextAction,
            ]
          : []),
        ...(fadeApplicable
          ? [
              {
                label: fadePresent
                  ? "إزالة طبقة التلاشي"
                  : "إضافة طبقة تلاشي (Fade Overlay)",
                icon: Contrast,
                run: toggleFadeOverlay,
                sepBefore: true,
              } as ContextAction,
            ]
          : []),
        ...(maskApplicable
          ? [
              {
                label: "تطبيق قناع القص (Clipping Mask)",
                icon: Group,
                run: () => applyMask(maskSource!.id, maskShape!.id),
                sepBefore: true,
              } as ContextAction,
            ]
          : []),
        ...(maskRemovable
          ? [
              {
                label: "إزالة قناع القص",
                icon: Ungroup,
                run: () => removeMask(selectedEls[0].clippedBy!),
              } as ContextAction,
            ]
          : []),
        {
          label: "قفل العنصر / فتح قفل العنصر",
          icon: Lock,
          run: toggleLock,
          sepBefore: true,
        },
        {
          label: "قفل التحجيم / فتح قفل التحجيم",
          icon: Scaling,
          run: toggleResizeLock,
        },
        {
          label: "قفل العرض / فك قفل العرض",
          icon: AlignStartVertical,
          run: toggleWidthLock,
        },
        {
          label: "قفل الارتفاع / فك قفل الارتفاع",
          icon: AlignStartHorizontal,
          run: toggleHeightLock,
        },
        {
          label: "قفل النسبة / فك قفل النسبة",
          icon: Scaling,
          run: toggleAspectLock,
        },
        { label: "إخفاء / إظهار", icon: Eye, run: toggleHidden },
        {
          label: primaryIsGroup ? "تسمية المجموعة…" : "إعادة تسمية…",
          icon: PenLine,
          run: () =>
            setRenaming({ id: menu.targetId!, name: primaryName || "" }),
          disabled: selectedCount > 1,
        },
        { label: "الخصائص", icon: Settings2, run: openProperties, sepBefore: true },
      ]
    : [
        {
          label: "لصق",
          icon: ClipboardPaste,
          run: () => paste(),
          disabled: !clipboard,
          hint: "⌘V",
        },
        {
          label: "لصق في مكانه",
          icon: ClipboardPaste,
          run: () => paste(true),
          disabled: !clipboard,
          hint: "⇧⌘V",
        },
        { label: "تحديد الكل", icon: AlignCenter, run: selectAll, hint: "⌘A" },
        {
          label: "إلغاء التحديد",
          icon: X,
          run: () => select(null),
          hint: "⌘D",
          sepBefore: true,
        },
        ...(selectedCount >= 2
          ? [
              {
                label: "تجميع العناصر",
                icon: Group,
                run: groupAndName,
                hint: "⌘G",
                sepBefore: true,
              } as ContextAction,
            ]
          : []),
        ...(selectedTypes.includes("group")
          ? [
              {
                label: "فك تجميع العناصر",
                icon: Ungroup,
                run: ungroup,
                hint: "⇧⌘G",
              } as ContextAction,
            ]
          : []),
        { label: "عكس التحديد", icon: FlipHorizontal2, run: invertSelection, sepBefore: true },
        { label: "ملاءمة مساحة العمل", icon: Maximize2, run: fitToScreen, hint: "⌘0" },
        { label: "تكبير", icon: ZoomIn, run: () => setZoom(zoom + 0.12), hint: "⌘+" },
        { label: "تصغير", icon: ZoomOut, run: () => setZoom(Math.max(0.2, zoom - 0.12)), hint: "⌘-" },
        { label: "وضع التركيز", icon: Focus, run: () => toggle("focusMode"), sepBefore: true },
        {
          label: "إظهار / إخفاء الشبكة",
          icon: Eye,
          run: () => toggle("showGrid"),
        },
      ];

  const menuStyle = (() => {
    if (!menu) return {};
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const estimatedW = 260;
    const estimatedH = 520;
    let left = menu.x;
    let top = menu.y;
    if (left + estimatedW > vw - margin) left = vw - estimatedW - margin;
    if (top + estimatedH > vh - margin) top = vh - estimatedH - margin;
    if (left < margin) left = margin;
    if (top < margin) top = margin;
    return { left, top };
  })();

  return (
    <>
      {menu && (
        <div
          className="editor-context-backdrop fixed inset-0 z-[var(--z-context)]"
          onPointerDown={onCloseMenu}
          onContextMenu={(e) => {
            e.preventDefault();
            onCloseMenu();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCloseMenu();
            }
          }}
          tabIndex={-1}
          autoFocus
        >
          <div
            className="editor-context-menu fixed min-w-[240px] max-w-[280px] max-h-[85vh] overflow-auto rounded-[10px] border bg-white p-1.5 shadow-2xl dark:border-white/15 dark:bg-[#1e2633]"
            style={menuStyle}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            role="menu"
          >
            {contextActions.map((action) => {
              const Icon = action.icon;
              return (
                <div key={action.label}>
                  {action.sepBefore && (
                    <div className="my-1 border-t border-[var(--editor-border)]" />
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={action.disabled}
                    onClick={() => {
                      if (menu.targetId && selectedCount === 0)
                        select(menu.targetId);
                      action.run();
                      onCloseMenu();
                    }}
                    className={cn(
                      "editor-menu-item flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-right text-[11px] font-bold disabled:opacity-35 hover:bg-line-2 dark:hover:bg-white/10",
                      action.danger && "editor-menu-danger text-red-600 dark:text-red-400",
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="flex-1">{action.label}</span>
                    {action.hint && (
                      <span className="text-[9px] text-muted">{action.hint}</span>
                    )}
                  </button>
                </div>
              );
            })}
            <div className="my-1 border-t border-[var(--editor-border)]" />
            <span className="flex items-center gap-2 px-2.5 py-1.5 text-[9px] text-[var(--editor-text-secondary)]">
              <Keyboard className="size-3" /> اضغط Escape للإغلاق · Right-click داخل Artboard
            </span>
          </div>
        </div>
      )}

      {renaming && (
        <div
          className="fixed inset-0 z-[calc(var(--z-context)+1)] grid place-items-center bg-navy/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={primaryIsGroup ? "تسمية المجموعة" : "إعادة تسمية العنصر"}
          onKeyDown={(event) => {
            if (event.key === "Escape") setRenaming(null);
          }}
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
            <strong className="text-[13px]">
              {primaryIsGroup ? "تسمية المجموعة" : "إعادة تسمية العنصر"}
            </strong>
            <input
              autoFocus
              value={renaming.name}
              onChange={(event) =>
                setRenaming((r) => (r ? { ...r, name: event.target.value } : r))
              }
              aria-label="اسم العنصر"
              className="h-9 rounded-[7px] border border-line px-2 text-[12px] font-bold dark:border-white/15 dark:bg-white/5"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRenaming(null);
                  onCloseMenu();
                }}
                className="h-8 rounded-[6px] border border-line px-3 text-[11px] font-bold dark:border-white/10"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="h-8 rounded-[6px] bg-navy px-3 text-[11px] font-bold text-white"
              >
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}

      {commandOpen && (
        <div
          className="editor-command-backdrop fixed inset-0 z-[var(--z-command)] grid place-items-start justify-center pt-[15vh]"
          onPointerDown={() => setCommandOpen(false)}
        >
          <div
            className="editor-command-menu w-[min(520px,calc(100vw-32px))] overflow-hidden rounded-[10px] border shadow-2xl"
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-label="قائمة الأوامر"
          >
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="size-4 text-[var(--editor-text-secondary)]" />
              <input
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveIndex((index) =>
                      Math.min(index + 1, filtered.length - 1),
                    );
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveIndex((index) => Math.max(index - 1, 0));
                  }
                  if (event.key === "Enter" && filtered[activeIndex])
                    run(filtered[activeIndex].id);
                }}
                placeholder="ابحث عن أمر…"
                className="h-12 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
              />
            </div>
            <div className="max-h-[330px] overflow-auto p-1.5">
              {filtered.map((action, index) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => run(action.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2.5 text-right text-[12px] font-bold",
                      index === activeIndex && "editor-command-active",
                    )}
                  >
                    <Icon className="size-4" />
                    <span className="flex-1">{action.label}</span>
                    <kbd>{action.hint || ""}</kbd>
                  </button>
                );
              })}
              {!filtered.length && (
                <p className="p-5 text-center text-[11px] text-[var(--editor-text-secondary)]">
                  لا توجد أوامر مطابقة
                </p>
              )}
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
  const printGuides = useEditor((s) => s.printGuides);
  const togglePrintGuide = useEditor((s) => s.togglePrintGuide);
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const page = pages.find((item) => item.id === activePageId);
  return (
    <div
      data-editor-obstacle="status-bar"
      className="editor-status-bar flex h-7 shrink-0 items-center justify-between gap-3 border-t px-3 text-[10px] tabular-nums"
    >
      <span className="selectable-value min-w-0 truncate">
        {page?.name || "صفحة"}
        {page
          ? ` · ${Math.round(page.w || 210)} × ${Math.round(page.h || 297)} مم`
          : ""}
        {page ? ` · ${page.elements.length} عنصر` : ""}
      </span>
      <span className="selectable-value">
        {selectedIds.length ? `${selectedIds.length} محدد` : "لا يوجد تحديد"}
      </span>
      <span className="flex items-center gap-1">
        {GUIDE_TOGGLES.map((guide) => (
          <button
            key={guide.key}
            type="button"
            onClick={() => togglePrintGuide(guide.key)}
            aria-pressed={Boolean(printGuides?.[guide.key])}
            title={guide.hint}
            className={cn(
              "rounded-[5px] border px-1.5 py-0.5 text-[10px] font-extrabold",
              printGuides?.[guide.key]
                ? "border-navy-2 bg-navy-2/10 text-navy-2 dark:border-gold/50 dark:text-gold-2"
                : "border-transparent text-muted",
            )}
          >
            {guide.label}
          </button>
        ))}
        <span className="selectable-value">{Math.round(zoom * 100)}%</span>
      </span>
    </div>
  );
}

const GUIDE_TOGGLES: {
  key: keyof PrintGuideSettings;
  label: string;
  hint: string;
}[] = [
  {
    key: "safe",
    label: "المنطقة الآمنة",
    hint: "إظهار المنطقة الآمنة للنص (١٠ مم من حدّ القطع).",
  },
  {
    key: "gutter",
    label: "هامش التجليد",
    hint: "إظهار هامش التجليد ١٥ مم عند الحافة اليمنى.",
  },
  {
    key: "bleed",
    label: "القص الزائد",
    hint: "إظهار منطقة القص الزائد ٣ مم وعلامات القص.",
  },
];
