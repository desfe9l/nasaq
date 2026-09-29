import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { anchorMenuPlacement, type ScreenBox } from "@/lib/editor/ui-state";

/**
 * The one anchored popover of the studio.
 *
 * Every compact menu (the Add menu, the panels switcher, the view options, the
 * selection overflow) is this component, so they all behave identically: a
 * portal above every editor layer, no clipping, a measured size clamped inside
 * the viewport, Escape/arrow-key support, and an outside press that closes it.
 * The panel never takes part in the page layout, so opening a menu can never
 * reflow the canvas.
 */
export interface AnchorMenuProps {
  /** The control that opens the menu. Receives the ARIA wiring. */
  trigger: (props: {
    ref: (node: HTMLButtonElement | null) => void;
    onClick: () => void;
    "aria-expanded": boolean;
    "aria-haspopup": "menu";
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
}

const GAP = 6;
const MARGIN = 8;

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
}: AnchorMenuProps) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );
  const [pos, setPos] = useState<{ left: number; top: number; side: "top" | "bottom" } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const anchor = triggerRef.current;
    if (!anchor) return;
    const box: ScreenBox = anchor.getBoundingClientRect();
    const size = panelRef.current?.getBoundingClientRect();
    setPos(
      anchorMenuPlacement(
        box,
        { width: size?.width || width, height: size?.height || 240 },
        { width: window.innerWidth, height: window.innerHeight },
        { side, align, gap: GAP, margin: MARGIN },
      ),
    );
  }, [align, side, width]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // The panel is mounted empty on the first pass; one frame later it has its
    // real measured size, so the clamp uses the truth.
    const frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = [...(panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
      if (!items.length) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "ArrowDown"
          ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    const reposition = () => place();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("nasaq:panel-layout", reposition);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("nasaq:panel-layout", reposition);
    };
  }, [open, place, setOpen]);

  // Open with the keyboard already inside: arrows work immediately.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <>
      {trigger({
        ref: (node) => {
          triggerRef.current = node;
        },
        onClick: () => setOpen(!open),
        "aria-expanded": open,
        "aria-haspopup": "menu",
      })}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            className={cn("editor-anchor-menu", className)}
            style={{
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              width,
              visibility: pos ? "visible" : "hidden",
            }}
            onClick={(event) => {
              // Any command closes the menu — one press, one result.
              if ((event.target as HTMLElement).closest("button")) setOpen(false);
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
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
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  separatorBefore?: boolean;
  /** Secondary line shown under the label in a wider menu. */
  hint?: string;
}) {
  return (
    <>
      {separatorBefore && <div className="editor-menu-sep" role="separator" />}
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        aria-checked={checked === undefined ? undefined : checked}
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
        {checked && <span className="editor-menu-check" aria-hidden="true">✓</span>}
        {shortcut && <kbd className="editor-menu-kbd">{shortcut}</kbd>}
      </button>
    </>
  );
}

export function MenuGroup({ title }: { title: string }) {
  return <p className="editor-menu-group">{title}</p>;
}
