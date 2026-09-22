import { useEffect, useRef, useState } from "react";
import { Check, Eye, Layers, RotateCw } from "lucide-react";
import { useEditor } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { AlignIcon } from "./ArrangeBar";

type MenuId = "align" | "arrange" | "transform" | "view";

const MENU_W = 248;

/**
 * Secondary-tool dropdowns for the editor toolbar.
 *
 * One design for all four menus (Alignment & Distribution, Arrange, Transform,
 * View): the panel is positioned `fixed` against the trigger's live rect, so
 * the toolbar's scroll container can never clip it, and every command here is
 * a real store action with an explicit disabled rule — nothing decorative.
 */
export function ToolbarMenus({ fitToScreen, fitToSelection }: { fitToScreen: () => void; fitToSelection: () => void }) {
  const [openId, setOpenId] = useState<MenuId | null>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const triggerRefs = useRef<Record<MenuId, HTMLButtonElement | null>>({ align: null, arrange: null, transform: null, view: null });
  const panelRef = useRef<HTMLDivElement>(null);

  const place = (id: MenuId) => {
    const r = triggerRefs.current[id]?.getBoundingClientRect();
    if (!r) return;
    setPos({
      top: r.bottom + 6,
      right: Math.max(8, window.innerWidth - r.right),
    });
  };

  const toggle = (id: MenuId) => {
    if (openId === id) {
      setOpenId(null);
      triggerRefs.current[id]?.focus();
      return;
    }
    place(id);
    setOpenId(id);
    // A menu opens with focus on its first enabled item, so Arrow keys work
    // immediately — the panel listens for them, but something must be inside
    // it for the roving focus to have a starting point.
    requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>("button[role='menuitem']:not(:disabled)")?.focus();
    });
  };

  // Outside press closes; Escape closes and returns focus to the trigger.
  useEffect(() => {
    if (!openId) return;
    const onPointerDown = (event: PointerEvent) => {
      const t = event.target as Node | null;
      if (panelRef.current?.contains(t)) return;
      if (Object.values(triggerRefs.current).some((n) => n?.contains(t))) return;
      setOpenId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenId(null);
      triggerRefs.current[openId]?.focus();
    };
    // Reposition, not close: the anchor follows its button on any layout shift.
    const reposition = () => place(openId);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [openId]);

  // Roving focus: ArrowUp/Down walk the enabled items, Home/End jump.
  const onPanelKeyDown = (event: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>("button[role='menuitem']:not(:disabled)") ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? Math.min(items.length - 1, current + 1)
        : event.key === "ArrowUp"
          ? Math.max(0, current - 1)
          : event.key === "Home"
            ? 0
            : items.length - 1;
    items[next === -1 ? 0 : next]?.focus();
  };

  return (
    <>
      <MenuTrigger
        id="align"
        title="المحاذاة والتوزيع (Alignment & Distribution)"
        open={openId === "align"}
        onToggle={toggle}
        triggerRef={(n) => (triggerRefs.current.align = n)}
      >
        <AlignGlyph />
      </MenuTrigger>
      <MenuTrigger
        id="arrange"
        title="ترتيب الطبقات"
        open={openId === "arrange"}
        onToggle={toggle}
        triggerRef={(n) => (triggerRefs.current.arrange = n)}
      >
        <Layers className="size-4" />
      </MenuTrigger>
      <MenuTrigger
        id="transform"
        title="تحويل"
        open={openId === "transform"}
        onToggle={toggle}
        triggerRef={(n) => (triggerRefs.current.transform = n)}
      >
        <RotateCw className="size-4" />
      </MenuTrigger>
      <MenuTrigger
        id="view"
        title="عرض"
        open={openId === "view"}
        onToggle={toggle}
        triggerRef={(n) => (triggerRefs.current.view = n)}
      >
        <Eye className="size-4" />
      </MenuTrigger>

      {openId && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={TITLE[openId]}
          onKeyDown={onPanelKeyDown}
          className="editor-dropdown-panel fixed z-[var(--z-dropdown)] rounded-[10px] border p-1.5 shadow-2xl"
          style={{ top: pos.top, right: pos.right, width: MENU_W }}
        >
          {openId === "align" && <AlignMenu />}
          {openId === "arrange" && <ArrangeMenu />}
          {openId === "transform" && <TransformMenu />}
          {openId === "view" && <ViewMenu fitToScreen={fitToScreen} fitToSelection={fitToSelection} close={() => setOpenId(null)} />}
        </div>
      )}
    </>
  );
}

const TITLE: Record<MenuId, string> = {
  align: "المحاذاة والتوزيع (Alignment & Distribution)",
  arrange: "ترتيب الطبقات",
  transform: "تحويل",
  view: "عرض",
};

function MenuTrigger({
  id,
  title,
  open,
  onToggle,
  triggerRef,
  children,
}: {
  id: MenuId;
  title: string;
  open: boolean;
  onToggle: (id: MenuId) => void;
  triggerRef: (n: HTMLButtonElement | null) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => onToggle(id)}
      title={title}
      aria-label={title}
      aria-haspopup="menu"
      aria-expanded={open}
      className={cn(
        // Same frame-less 36px control as the rest of the toolbar strip; the
        // open state is the filled navy pill, which reads without any border.
        "inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] transition hover:bg-line-2 dark:hover:bg-white/10",
        open ? "bg-navy text-white hover:bg-navy dark:bg-navy dark:text-white" : "",
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------- Alignment ------------------------------- */

function AlignMenu() {
  const count = useEditor((s) => s.selectedIds.length);
  const align = useEditor((s) => s.align);
  const distribute = useEditor((s) => s.distribute);
  const matchSize = useEditor((s) => s.matchSize);
  // With one element the only meaningful frame is the artboard itself; with
  // several, the shared selection box — overridable below.
  const [override, setOverride] = useState<"selection" | "page" | null>(null);
  const frame = override ?? (count >= 2 ? "selection" : "page");

  const edges: { edge: "right" | "center" | "left" | "top" | "middle" | "bottom"; label: string; icon: string }[] = [
    { edge: "right", label: "محاذاة لليمين", icon: "right" },
    { edge: "center", label: "توسيط أفقي", icon: "center-h" },
    { edge: "left", label: "محاذاة لليسار", icon: "left" },
    { edge: "top", label: "محاذاة للأعلى", icon: "top" },
    { edge: "middle", label: "توسيط رأسي", icon: "center-v" },
    { edge: "bottom", label: "محاذاة للأسفل", icon: "bottom" },
  ];

  return (
    <>
      <p className="px-2 pb-1 pt-0.5 text-[10px] font-extrabold text-[var(--editor-text-secondary,inherit)] opacity-70">محاذاة إلى</p>
      <div className="mb-1 grid grid-cols-2 gap-1">
        {([["selection", "التحديد"], ["page", "لوحة الصفحة"]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="menuitem"
            aria-pressed={frame === id}
            onClick={() => setOverride(id)}
            className={cn(
              "h-7 rounded-[6px] border text-[10px] font-extrabold",
              frame === id ? "border-navy bg-navy text-white" : "border-line dark:border-white/10",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {edges.map((b) => (
          <button
            key={b.edge}
            type="button"
            role="menuitem"
            title={b.label}
            aria-label={b.label}
            disabled={!count}
            onClick={() => align(b.edge, frame)}
            className="grid h-9 place-items-center rounded-[6px] border border-line disabled:opacity-35 dark:border-white/10"
          >
            <AlignIcon kind={b.icon} />
          </button>
        ))}
      </div>
      <MenuSep />
      <MenuItem
        label="توزيع أفقي متساوٍ"
        icon={<AlignIcon kind="dist-h" />}
        disabled={count < 3}
        onClick={() => distribute("h")}
      />
      <MenuItem
        label="توزيع رأسي متساوٍ"
        icon={<AlignIcon kind="dist-v" />}
        disabled={count < 3}
        onClick={() => distribute("v")}
      />
      <MenuSep />
      <MenuItem label="نفس العرض" disabled={count < 2} onClick={() => matchSize("width")} />
      <MenuItem label="نفس الارتفاع" disabled={count < 2} onClick={() => matchSize("height")} />
      <MenuItem label="نفس الحجم" disabled={count < 2} onClick={() => matchSize("both")} />
    </>
  );
}

/* -------------------------------- Arrange -------------------------------- */

function ArrangeMenu() {
  const count = useEditor((s) => s.selectedIds.length);
  const hasGroup = useEditor((s) => {
    const page = s.pages.find((p) => p.id === s.activePageId);
    return s.selectedIds.some((id) => page?.elements.some((e) => e.id === id && e.type === "group"));
  });
  const bring = useEditor((s) => s.bring);
  const group = useEditor((s) => s.group);
  const ungroup = useEditor((s) => s.ungroup);
  const toggleLock = useEditor((s) => s.toggleLock);
  const toggleHidden = useEditor((s) => s.toggleHidden);

  return (
    <>
      <MenuItem label="نقل إلى الأمام" disabled={!count} onClick={() => bring("forward")} />
      <MenuItem label="نقل إلى الخلف" disabled={!count} onClick={() => bring("back")} />
      <MenuItem label="إلى المقدمة تمامًا" disabled={!count} onClick={() => bring("front")} />
      <MenuItem label="إلى الخلف تمامًا" disabled={!count} onClick={() => bring("bottom")} />
      <MenuSep />
      <MenuItem label="تجميع (⌘G)" disabled={count < 2} onClick={() => group()} />
      <MenuItem label="فك التجميع (⇧⌘G)" disabled={!hasGroup} onClick={() => ungroup()} />
      <MenuSep />
      <MenuItem label="قفل / فتح القفل" disabled={!count} onClick={() => toggleLock()} />
      <MenuItem label="إخفاء / إظهار" disabled={!count} onClick={() => toggleHidden()} />
    </>
  );
}

/* ------------------------------- Transform ------------------------------- */

function TransformMenu() {
  const count = useEditor((s) => s.selectedIds.length);
  const selected = useEditor((s) => s.selectedElements());
  const commit = useEditor((s) => s.commit);
  const align = useEditor((s) => s.align);
  const fitTextBox = useEditor((s) => s.fitTextBox);
  const singleText = count === 1 && selected[0] && ["text", "box", "stat", "stamp", "progress"].includes(selected[0].type);

  const rotate = (delta: number) => {
    const state = useEditor.getState();
    for (const el of state.selectedElements()) {
      if (el.locked) continue;
      const next = ((((el.rotation || 0) + delta) % 360) + 360) % 360;
      state.updateElement(el.id, { rotation: next }, true);
    }
    commit();
  };

  return (
    <>
      <MenuItem label="تدوير 90°↺" disabled={!count} onClick={() => rotate(-90)} />
      <MenuItem label="تدوير 90°↻" disabled={!count} onClick={() => rotate(90)} />
      <MenuItem
        label="تصفير الدوران"
        disabled={!count || selected.every((el) => !el.rotation)}
        onClick={() => {
          const state = useEditor.getState();
          for (const el of state.selectedElements()) {
            if (el.locked) continue;
            state.updateElement(el.id, { rotation: 0 }, true);
          }
          commit();
        }}
      />
      <MenuSep />
      <MenuItem label="توسيط أفقي في الصفحة" disabled={!count} onClick={() => align("center", "page")} />
      <MenuItem label="توسيط رأسي في الصفحة" disabled={!count} onClick={() => align("middle", "page")} />
      <MenuSep />
      <MenuItem
        label="ملاءمة صندوق النص للنص"
        disabled={!singleText}
        onClick={() => selected[0] && fitTextBox(selected[0].id)}
      />
    </>
  );
}

/* --------------------------------- View ---------------------------------- */

function ViewMenu({ fitToScreen, fitToSelection, close }: { fitToScreen: () => void; fitToSelection: () => void; close: () => void }) {
  const setZoom = useEditor((s) => s.setZoom);
  const showGrid = useEditor((s) => s.showGrid);
  const snapGrid = useEditor((s) => s.snapGrid);
  const snapElements = useEditor((s) => s.snapElements);
  const previewAll = useEditor((s) => s.previewAll);
  const focusMode = useEditor((s) => s.focusMode);
  const toggle = useEditor((s) => s.toggle);

  const ToggleItem = ({ label, value, onClick }: { label: string; value: boolean; onClick: () => void }) => (
    <MenuItem
      label={label}
      checked={value}
      onClick={onClick}
    />
  );

  return (
    <>
      {/*
       * Zoom in/out are NOT menu items: they sit permanently on the strip
       * right beside this menu's trigger (with the pinned fit button), so
       * listing them here only lengthened the menu with duplicates.
       */}
      <MenuItem
        label="ملاءمة لوحة الصفحة (⌘0)"
        onClick={() => {
          close();
          fitToScreen();
        }}
      />
      <MenuItem label="مقياس 100%" onClick={() => setZoom(1)} />
      <MenuItem label="ملاءمة التحديد" onClick={() => { close(); fitToSelection(); }} />
      <MenuSep />
      <ToggleItem label="إظهار الشبكة" value={showGrid} onClick={() => toggle("showGrid")} />
      <ToggleItem label="محاذاة للشبكة" value={snapGrid} onClick={() => toggle("snapGrid")} />
      <ToggleItem label="محاذاة للعناصر" value={snapElements} onClick={() => toggle("snapElements")} />
      <ToggleItem label="عرض كل الصفحات" value={previewAll} onClick={() => toggle("previewAll")} />
      <ToggleItem label="وضع التركيز" value={focusMode} onClick={() => toggle("focusMode")} />
    </>
  );
}

/* ------------------------------ Shared bits ------------------------------ */

function MenuItem({
  label,
  icon,
  checked,
  disabled,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  checked?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-right text-[11px] font-bold hover:bg-[var(--editor-hover,rgba(127,127,127,0.14))] disabled:opacity-35",
      )}
    >
      {icon ? <span className="grid size-4 shrink-0 place-items-center">{icon}</span> : <span className="size-4 shrink-0" />}
      <span className="flex-1">{label}</span>
      {checked && <Check className="size-3.5 shrink-0 text-ok" aria-hidden />}
    </button>
  );
}

function MenuSep() {
  return <div className="my-1 border-t border-[var(--editor-border)]" />;
}

/** The toolbar trigger glyph for the alignment menu — classic align bars. */
function AlignGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
      <path d="M8 1.5v13" />
      <rect x="3" y="3" width="10" height="3.2" />
      <rect x="4.6" y="9.8" width="6.8" height="3.2" />
    </svg>
  );
}
