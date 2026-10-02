import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tip } from "./Tip";
import {
  anchorMenuPlacement,
  clampParkedPoint,
  parseStoredPoint,
  type ScreenBox,
} from "@/lib/editor/ui-state";

/**
 * The one anchored popover of the studio.
 *
 * Every compact menu (the Add menu, the panels switcher, the view options, the
 * selection overflow) is this component, so they all behave identically: a
 * portal above every editor layer, no clipping, a measured size clamped inside
 * the viewport, Escape/arrow-key support, and an outside press that closes it.
 * The panel never takes part in the page layout, so opening a menu can never
 * reflow the canvas — the toolbar keeps its exact rectangle whether a group is
 * open or not.
 *
 * Two modes, one primitive:
 *
 *   • menu (default) — a list of one-shot commands. Activating a row closes it.
 *   • drawer (`drawer` prop) — a tool GROUP: a titled, closable and *movable*
 *     panel of live controls. It stays open while the author works with it, it
 *     remembers where it was parked, and it can be dismissed from its own bar,
 *     from the trigger, with Escape or by pressing outside. Drawers are how the
 *     toolbars stay icon-sized without hiding a single control.
 */
export interface AnchorMenuProps {
  /** The control that opens the menu. Receives the ARIA wiring. */
  trigger: (props: {
    ref: (node: HTMLButtonElement | null) => void;
    onClick: () => void;
    "aria-expanded": boolean;
    "aria-haspopup": "menu" | "dialog";
  }) => ReactNode;
  children: ReactNode;
  /** Preferred side; flipped automatically when the viewport has no room. */
  side?: "top" | "bottom";
  /** Physical edge the panel lines up with (RTL menus use `end`). */
  align?: "start" | "end" | "center";
  width?: number;
  className?: string;
  label: string;
  /** Controlled open state (optional — uncontrolled by default). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Render as a movable tool drawer instead of a command menu. The panel grows
   * a title bar with a drag grip and its own close control, keeps the author's
   * parked position between openings, and does not close when a control inside
   * it is used — a tool group is a workspace, not a list of commands.
   */
  drawer?: {
    /** Stable identity; the parked position is remembered under this key. */
    id: string;
    /** Title of the drawer bar — the group's name, never a paragraph. */
    title: string;
  };
}

const GAP = 6;
const MARGIN = 8;
/** Where a parked drawer position is remembered. */
const parkKey = (id: string) => `nasaq.drawer.${id}.pos`;

const readPark = (id: string) => {
  if (typeof localStorage === "undefined") return null;
  try {
    return parseStoredPoint(localStorage.getItem(parkKey(id)));
  } catch {
    return null;
  }
};
const writePark = (id: string, point: { x: number; y: number } | null) => {
  if (typeof localStorage === "undefined") return;
  try {
    if (point) localStorage.setItem(parkKey(id), JSON.stringify(point));
    else localStorage.removeItem(parkKey(id));
  } catch {
    /* the park stays for this session only */
  }
};

/**
 * Tells the rows inside a drawer that they are controls, not menu commands, so
 * they keep their native button semantics instead of claiming `menuitem`.
 */
const DrawerContext = createContext(false);
const MenuAncestors = createContext<string[]>([]);
export const useMenuAncestors = () => useContext(MenuAncestors);

export function AnchorMenu({
  trigger,
  children,
  side = "bottom",
  align = "end",
  width = 248,
  className,
  label,
  open: controlledOpen,
  onOpenChange,
  drawer,
}: AnchorMenuProps) {
  const menuId = useId();
  const ancestors = useContext(MenuAncestors);
  const ancestorsRef = useRef(ancestors);
  ancestorsRef.current = ancestors;
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = useCallback(
    (next: boolean) => {
      if (next)
        window.dispatchEvent(
          new CustomEvent("nasaq:menu-open", {
            detail: { id: menuId, ancestors: ancestorsRef.current },
          }),
        );
      if (controlledOpen === undefined) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange, menuId],
  );
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    side: "top" | "bottom";
  } | null>(null);
  /*
   * Primitives, not the inline `drawer` object: a caller re-renders far more
   * often than a drawer changes identity, and re-running the placement effect
   * on every one of those renders would fight a position the author parked.
   */
  const drawerId = drawer?.id;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** The panel's own contents — the drawer bar is not part of the menu. */
  const bodyRef = useRef<HTMLDivElement>(null);
  /** True once the author has placed the drawer; anchoring stops fighting it. */
  const parked = useRef(false);
  const dragState = useRef<{
    id: number;
    x: number;
    y: number;
    left: number;
    top: number;
    next: { x: number; y: number };
    moved: boolean;
    frame: number;
  } | null>(null);

  /** Where the panel goes when the author has not parked it. */
  const anchor = useCallback(() => {
    const box = triggerRef.current?.getBoundingClientRect();
    if (!box) return;
    const size = panelRef.current?.getBoundingClientRect();
    setPos(
      anchorMenuPlacement(
        box as ScreenBox,
        { width: size?.width || width, height: size?.height || 240 },
        { width: window.innerWidth, height: window.innerHeight },
        { side, align, gap: GAP, margin: MARGIN },
      ),
    );
  }, [align, side, width]);

  /** Where a parked drawer goes: its own spot, clamped back on screen. */
  const clampPark = useCallback(() => {
    const panel = panelRef.current;
    setPos((current) => {
      if (!current || !panel) return current;
      const size = panel.getBoundingClientRect();
      const at = clampParkedPoint(
        { x: current.left, y: current.top },
        { width: size.width, height: size.height },
        { width: window.innerWidth, height: window.innerHeight },
        MARGIN,
      );
      return at.x === current.left && at.y === current.top
        ? current
        : { ...current, left: at.x, top: at.y };
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      parked.current = false;
      return;
    }
    // A drawer opens where the author left it; a menu opens on its trigger.
    const stored = drawerId ? readPark(drawerId) : null;
    parked.current = Boolean(stored);
    const place = () => {
      if (parked.current && stored) {
        const size = panelRef.current?.getBoundingClientRect();
        const at = clampParkedPoint(
          stored,
          { width: size?.width || width, height: size?.height || 240 },
          { width: window.innerWidth, height: window.innerHeight },
          MARGIN,
        );
        setPos((current) => ({
          ...(current ?? { side }),
          left: at.x,
          top: at.y,
        }));
        return;
      }
      anchor();
    };
    place();
    // The panel is mounted empty on the first pass; one frame later it has its
    // real measured size, so the clamp uses the truth.
    const frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [open, anchor, drawerId, width, side]);

  useEffect(() => {
    if (!open) return;
    const onMenu = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; ancestors: string[] }>)
        .detail;
      if (detail.id !== menuId && !detail.ancestors.includes(menuId))
        setOpen(false);
    };
    const reset = () => setOpen(false);
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        panelRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      )
        return;
      /*
       * A drawer's own sub-surfaces are portals too: the colour picker that
       * opens from a swatch, a tooltip, another drawer. Pressing inside one of
       * them is still pressing inside the tool the author is working with, so
       * it must not dismiss the drawer underneath.
       */
      if (
        target instanceof Element &&
        (target.closest(".editor-tip") ||
          target
            .closest<HTMLElement>(".editor-anchor-menu, .color-field-pop")
            ?.dataset.menuAncestors?.split(" ")
            .includes(menuId))
      )
        return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // The deepest open surface owns Escape, even before a pointer user focuses it.
        if (
          document.querySelector(
            `[data-menu-ancestors~="${CSS.escape(menuId)}"]`,
          )
        )
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (
        event.target instanceof Element &&
        event.target.closest("input, select, textarea")
      )
        return;
      const items = [
        ...(bodyRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled)",
        ) ?? []),
      ];
      if (!items.length) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "ArrowDown"
          ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    /*
     * A parked drawer belongs to the author, not to its trigger: scrolling or
     * resizing only keeps it on screen, it never snaps the panel back to the
     * button. An anchored menu keeps following its trigger, as it must.
     */
    const reposition = () => (parked.current ? clampPark() : anchor());
    window.addEventListener("nasaq:menu-open", onMenu);
    window.addEventListener("nasaq:selection-ui-reset", reset);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("nasaq:panel-layout", reposition);
    return () => {
      window.removeEventListener("nasaq:menu-open", onMenu);
      window.removeEventListener("nasaq:selection-ui-reset", reset);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("nasaq:panel-layout", reposition);
    };
  }, [open, anchor, clampPark, setOpen, menuId]);

  // Open with the keyboard already inside: arrows work immediately.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      bodyRef.current
        ?.querySelector<HTMLElement>("button:not(:disabled)")
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  /** Drag locally at display rate and persist the drawer's park once on release. */
  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !event.isPrimary || !panelRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = panelRef.current.getBoundingClientRect();
    dragState.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
      next: { x: rect.left, y: rect.top },
      moved: false,
      frame: 0,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      dragState.current = null;
    }
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragState.current;
    const panel = panelRef.current;
    if (!drag || drag.id !== event.pointerId || !panel) return;
    event.preventDefault();
    event.stopPropagation();
    const size = panel.getBoundingClientRect();
    drag.next = clampParkedPoint(
      {
        x: drag.left + (event.clientX - drag.x),
        y: drag.top + (event.clientY - drag.y),
      },
      { width: size.width, height: size.height },
      { width: window.innerWidth, height: window.innerHeight },
      MARGIN,
    );
    drag.moved = true;
    parked.current = true;
    if (drag.frame) return;
    drag.frame = requestAnimationFrame(() => {
      drag.frame = 0;
      if (dragState.current === drag) {
        setPos((current) => ({
          ...(current ?? { side }),
          left: drag.next.x,
          top: drag.next.y,
        }));
      }
    });
  };

  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragState.current;
    const panel = panelRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (drag.frame) cancelAnimationFrame(drag.frame);
    const size = panel?.getBoundingClientRect();
    const at =
      event.type === "pointerup" && drag.moved && size
        ? clampParkedPoint(
            {
              x: drag.left + (event.clientX - drag.x),
              y: drag.top + (event.clientY - drag.y),
            },
            { width: size.width, height: size.height },
            { width: window.innerWidth, height: window.innerHeight },
            MARGIN,
          )
        : drag.next;
    dragState.current = null;
    if (!drag.moved || !drawerId) return;
    parked.current = true;
    setPos((current) => ({ ...(current ?? { side }), left: at.x, top: at.y }));
    writePark(drawerId, at);
  };

  useEffect(
    () => () => {
      if (dragState.current?.frame)
        cancelAnimationFrame(dragState.current.frame);
    },
    [],
  );

  return (
    <MenuAncestors.Provider value={[...ancestors, menuId]}>
      {trigger({
        ref: (node) => {
          triggerRef.current = node;
        },
        onClick: () => setOpen(!open),
        "aria-expanded": open,
        "aria-haspopup": drawer ? "dialog" : "menu",
      })}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            data-menu-id={menuId}
            data-menu-ancestors={ancestors.join(" ")}
            role={drawer ? "dialog" : "menu"}
            aria-label={drawer ? drawer.title : label}
            className={cn(
              "editor-anchor-menu",
              drawer && "is-drawer",
              className,
            )}
            style={{
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              width: drawer
                ? `min(${width}px, calc(100vw - 16px))`
                : width,
              maxWidth: "calc(100vw - 16px)",
              visibility: pos ? "visible" : "hidden",
            }}
            onClick={(event) => {
              /*
               * A command menu closes on activation — one press, one result. A
               * drawer holds live controls (a colour, a toggle, a scrubber)
               * that the author uses repeatedly, so it stays open until they
               * dismiss it from its own bar, the trigger, Escape or outside.
               */
              if (drawer) return;
              if ((event.target as HTMLElement).closest("button"))
                setOpen(false);
            }}
          >
            {drawer && (
              <div className="editor-drawer-bar">
                <button
                  type="button"
                  className="editor-drawer-grip"
                  aria-label={`نقل ${drawer.title}`}
                  title="اسحب لنقل اللوحة — نقرتان لإعادتها إلى الزر"
                  onPointerDown={startDrag}
                  onPointerMove={moveDrag}
                  onPointerUp={finishDrag}
                  onPointerCancel={finishDrag}
                  onLostPointerCapture={finishDrag}
                  onDoubleClick={() => {
                    parked.current = false;
                    writePark(drawer.id, null);
                    anchor();
                  }}
                >
                  <GripHorizontal size={14} aria-hidden="true" />
                </button>
                <span className="editor-drawer-title">{drawer.title}</span>
                <button
                  type="button"
                  className="editor-drawer-close"
                  aria-label={`إغلاق ${drawer.title}`}
                  title="إغلاق"
                  onClick={() => {
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            )}
            <div ref={bodyRef} className="editor-drawer-body">
              <DrawerContext.Provider value={Boolean(drawer)}>
                {children}
              </DrawerContext.Provider>
            </div>
          </div>,
          document.body,
        )}
    </MenuAncestors.Provider>
  );
}

/** True while rendering inside a tool drawer rather than a command menu. */
function useInDrawer(): boolean {
  return useContext(DrawerContext);
}

export function MenuRow({
  icon,
  label,
  shortcut,
  onSelect,
  disabled,
  danger,
  checked,
  separatorBefore,
  hint,
}: {
  icon?: ReactNode;
  label: string;
  /**
   * Keyboard shortcut, shown as a key cap. Render it in ONE place per action:
   * the shortcut belongs to the control that performs it, and a second badge
   * for the same keys is noise competing with the tool itself.
   */
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  separatorBefore?: boolean;
  /** Secondary line shown under the label in a wider menu. */
  hint?: string;
}) {
  const inDrawer = useInDrawer();
  return (
    <>
      {separatorBefore && <div className="editor-menu-sep" role="separator" />}
      <button
        type="button"
        role={inDrawer ? undefined : "menuitem"}
        disabled={disabled}
        aria-checked={checked === undefined ? undefined : checked}
        aria-pressed={inDrawer && checked !== undefined ? checked : undefined}
        className={cn("editor-menu-row", danger && "is-danger")}
        onClick={onSelect}
      >
        <span className="editor-menu-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="editor-menu-text">
          <span className="editor-menu-label">{label}</span>
          {hint && <span className="editor-menu-hint">{hint}</span>}
        </span>
        {checked && (
          <span className="editor-menu-check" aria-hidden="true">
            ✓
          </span>
        )}
        {shortcut && <kbd className="editor-menu-kbd">{shortcut}</kbd>}
      </button>
    </>
  );
}

export function MenuGroup({ title }: { title: string }) {
  return <p className="editor-menu-group">{title}</p>;
}

/**
 * A grid of icon controls inside a menu or drawer.
 *
 * Groups of same-shaped actions (alignment, rotation, flips, sizing) read as a
 * keypad instead of a column of sentences: the icon is the control, the name is
 * the tooltip, and the whole group fits in the height of two text rows — which
 * is what keeps a tool drawer's controls above the fold.
 */
export function MenuGrid({
  columns = 3,
  label,
  children,
}: {
  columns?: 2 | 3 | 4 | 5 | 6;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("editor-menu-grid", `is-${columns}`)}
      role="group"
      aria-label={label}
      dir="ltr"
    >
      {children}
    </div>
  );
}

/**
 * One icon control of a `MenuGrid`: icon first, name as the tooltip.
 *
 * It wears the studio's shared tooltip rather than a bare `title`, so the name
 * is reachable on a touch screen too (long-press) — an icon in a drawer is no
 * more self-evident than an icon in the bar.
 */
export function MenuCell({
  icon,
  label,
  onSelect,
  disabled,
  active,
  danger,
}: {
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        className={cn(active && "is-active", danger && "is-danger")}
        onClick={onSelect}
      >
        {icon}
      </button>
    </Tip>
  );
}
