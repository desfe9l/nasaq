import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { GripVertical } from "lucide-react";
import {
  isSmartSectionId,
  moveSectionOrder,
  normalizeSectionOrder,
  readSectionOrder,
  resolveInsertIndex,
  writeSectionOrder,
  type SmartSectionId,
} from "@/lib/editor/section-order";

/**
 * Sortable accordion stack — the «أدوات العناصر» sections, reorderable by real
 * Drag & Drop.
 *
 * The gesture is pointer-based (mouse, touch, Apple Pencil) rather than HTML5
 * DnD, because HTML5 dragging is unavailable on iPad and cannot move DOM under
 * the finger. Three pieces make it feel physical:
 *
 *  · **Ghost** — a clone of the dragged section that follows the pointer,
 *    clamped inside the panel so it never leaves the interface;
 *  · **Placeholder** — a slot of the exact dragged height that slides through
 *    the list to show where the section will land;
 *  · **FLIP motion** — the sections in between animate to their new positions
 *    instead of teleporting (transform-only, so an open section's inputs keep
 *    working through the move).
 *
 * Dragging works the same whether a section is open or closed — the placeholder
 * takes the section's current height and the ghost caps its own, so a fully
 * expanded category is as easy to move as a collapsed one.
 *
 * Order + open/closed state persist across reloads (`section-order.ts` and
 * `Accordion`'s `useAccordionState` own the two localStorage slots).
 */

/** How far (px) from the scroller edge a drag triggers auto-scroll. */
const EDGE_ZONE = 48;
/** Max px per frame of drag auto-scroll. */
const MAX_SCROLL_STEP = 16;
/** Ghost height cap as a fraction of the panel body. */
const GHOST_HEIGHT_FRACTION = 0.55;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type SectionChild = ReactElement<{ id?: string; dragHandle?: ReactNode }>;

export function SortableSectionStack({
  children,
}: {
  /**
   * One `AccordionSection` per smart-library id (`id="shapes"` …). The stack
   * reorders them and injects `dragHandle`; any other node (overlays, hints)
   * renders untouched above the stack. Open/closed state stays with the
   * section; the stack owns order + the drag gesture.
   */
  children: ReactNode;
}) {
  const [order, setOrder] = useState<SmartSectionId[]>(() =>
    readSectionOrder(),
  );
  const [drag, setDrag] = useState<{
    id: SmartSectionId;
    height: number;
  } | null>(null);
  const [liveOrder, setLiveOrder] = useState<SmartSectionId[] | null>(null);

  /* Pick the section children out of the caller's JSX once per render. */
  const sections = new Map<SmartSectionId, SectionChild>();
  const extras: { key: string; node: ReactNode }[] = [];
  Children.forEach(children, (child, index) => {
    if (
      isValidElement(child) &&
      isSmartSectionId((child.props as { id?: unknown }).id)
    ) {
      sections.set(
        (child.props as { id: SmartSectionId }).id,
        child as SectionChild,
      );
    } else if (child !== null && child !== undefined && child !== false) {
      extras.push({
        key: (isValidElement(child) && child.key) || `extra-${index}`,
        node: child,
      });
    }
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const slotRefs = useRef(new Map<SmartSectionId, HTMLElement>());
  const ghostRef = useRef<HTMLElement | null>(null);
  const liveOrderRef = useRef<SmartSectionId[] | null>(null);
  const dragIdRef = useRef<SmartSectionId | null>(null);
  const touchLiftRef = useRef(0);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const grabRef = useRef({ x: 0, y: 0 });
  const scrollRafRef = useRef<number | null>(null);
  const flipRef = useRef<Map<SmartSectionId, number>>(new Map());
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Removes the active window listeners (exact instances from `startDrag`). */
  const detachRef = useRef<(() => void) | null>(null);

  /* Keep the ref in step with state so the gesture handlers see fresh data. */
  useEffect(() => {
    liveOrderRef.current = liveOrder;
  }, [liveOrder]);

  const registerSlot = useCallback(
    (id: SmartSectionId, node: HTMLElement | null) => {
      if (node) slotRefs.current.set(id, node);
      else slotRefs.current.delete(id);
    },
    [],
  );

  /** Bounds the ghost must stay inside: the scrolling panel body. */
  const panelBounds = useCallback((): DOMRect | null => {
    const container = containerRef.current;
    if (!container) return null;
    const scroller = container.closest(".editor-pane-scroll");
    return (scroller ?? container).getBoundingClientRect();
  }, []);

  const scrollerEl = useCallback((): HTMLElement | null => {
    const container = containerRef.current;
    return container?.closest<HTMLElement>(".editor-pane-scroll") ?? container;
  }, []);

  const moveGhost = useCallback(
    (clientX: number, clientY: number) => {
      const ghost = ghostRef.current;
      if (!ghost) return;
      const bounds = panelBounds();
      const gw = ghost.offsetWidth;
      const gh = ghost.offsetHeight;
      /* Touch drags lift the ghost above the finger so it stays visible. */
      const lift = touchLiftRef.current;
      let left = clientX - grabRef.current.x;
      let top = clientY - grabRef.current.y + lift;
      if (bounds) {
        const minX = bounds.left + 8;
        const maxX = bounds.right - gw - 8;
        const minY = bounds.top + 8;
        const maxY = bounds.bottom - gh - 8;
        left = Math.max(minX, Math.min(left, Math.max(minX, maxX)));
        top = Math.max(minY, Math.min(top, Math.max(minY, maxY)));
      }
      ghost.style.left = `${left}px`;
      ghost.style.top = `${top}px`;
    },
    [panelBounds],
  );

  /**
   * Drop position from the pointer's Y over the live rows (the dragged one
   * excluded — its slot is the placeholder and must not vote).
   */
  const resolveTarget = useCallback((clientY: number): number | null => {
    const live = liveOrderRef.current;
    const dragId = dragIdRef.current;
    if (!live || !dragId) return null;
    const slots: { top: number; bottom: number }[] = [];
    for (const id of live) {
      if (id === dragId) continue;
      const node = slotRefs.current.get(id);
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      slots.push({ top: rect.top, bottom: rect.bottom });
    }
    return resolveInsertIndex(slots, clientY);
  }, []);

  /** Slide the placeholder to the pointer's row (no-op when already there). */
  const reposition = useCallback(
    (clientY: number) => {
      const live = liveOrderRef.current;
      const dragId = dragIdRef.current;
      if (!live || !dragId) return;
      const target = resolveTarget(clientY);
      if (target === null) return;
      const from = live.indexOf(dragId);
      if (from < 0 || target === from) return;
      const next = moveSectionOrder(live, from, target);
      liveOrderRef.current = next;
      setLiveOrder(next);
    },
    [resolveTarget],
  );

  /**
   * FLIP: after the placeholder jumps, every displaced section animates from
   * its previous position. Positions are read via `offsetTop` (layout-relative),
   * so drag auto-scroll cannot poison the deltas.
   */
  useLayoutEffect(() => {
    if (!drag) return;
    const previous = flipRef.current;
    const moving: { node: HTMLElement; dy: number }[] = [];
    const next = new Map<SmartSectionId, number>();
    for (const [id, node] of slotRefs.current) {
      const top = node.offsetTop;
      next.set(id, top);
      const before = previous.get(id);
      if (before !== undefined && before !== top) {
        moving.push({ node, dy: before - top });
      }
    }
    flipRef.current = next;
    if (moving.length === 0 || prefersReducedMotion()) return;

    for (const { node, dy } of moving) {
      node.style.transition = "none";
      node.style.transform = `translateY(${dy}px)`;
    }
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (const { node } of moving) {
          node.style.transition =
            "transform 190ms cubic-bezier(0.22, 1, 0.36, 1)";
          node.style.transform = "";
        }
      });
    });
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      for (const node of slotRefs.current.values()) {
        node.style.transition = "";
        node.style.transform = "";
      }
    }, 240);
    return () => cancelAnimationFrame(frame);
  }, [liveOrder, drag]);

  /** Tear down listeners, ghost and timers — safe to call at any point. */
  const endDrag = useCallback(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    detachRef.current?.();
    detachRef.current = null;
    ghostRef.current?.remove();
    ghostRef.current = null;
    document.body.classList.remove("is-sorting-sections");
    for (const node of slotRefs.current.values()) {
      node.style.transition = "";
      node.style.transform = "";
    }
    dragIdRef.current = null;
    touchLiftRef.current = 0;
    pointerRef.current = null;
    setDrag(null);
    setLiveOrder(null);
    liveOrderRef.current = null;
  }, []);

  /** Drop: persist the placeholder's final position. */
  const commit = useCallback(() => {
    const live = liveOrderRef.current;
    endDrag();
    if (live) {
      const normalized = normalizeSectionOrder(live);
      setOrder(normalized);
      writeSectionOrder(normalized);
    }
  }, [endDrag]);

  /** Drag auto-scroll near the panel's top/bottom edges. */
  const startAutoScroll = useCallback(() => {
    const step = () => {
      const scroller = scrollerEl();
      const pointer = pointerRef.current;
      if (scroller && pointer && dragIdRef.current) {
        const rect = scroller.getBoundingClientRect();
        let dy = 0;
        if (pointer.y < rect.top + EDGE_ZONE) {
          dy = -Math.min(
            MAX_SCROLL_STEP,
            Math.ceil((rect.top + EDGE_ZONE - pointer.y) * 0.35),
          );
        } else if (pointer.y > rect.bottom - EDGE_ZONE) {
          dy = Math.min(
            MAX_SCROLL_STEP,
            Math.ceil((pointer.y - (rect.bottom - EDGE_ZONE)) * 0.35),
          );
        }
        if (dy !== 0) {
          const before = scroller.scrollTop;
          scroller.scrollTop += dy;
          if (scroller.scrollTop !== before) reposition(pointer.y);
        }
      }
      scrollRafRef.current = requestAnimationFrame(step);
    };
    scrollRafRef.current = requestAnimationFrame(step);
  }, [reposition, scrollerEl]);

  const startDrag = useCallback(
    (id: SmartSectionId) => (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const slot = slotRefs.current.get(id);
      const section = slot?.querySelector<HTMLElement>(".editor-accordion");
      if (!slot || !section) return;

      /*
       * Threshold: a tap on the grip is not a drag — the ghost and placeholder
       * appear only once the pointer travels a few pixels, so a casual press
       * never flashes the list.
       */
      const start = { x: e.clientX, y: e.clientY };
      const pointerId = e.pointerId;
      let begun = false;

      const begin = (clientX: number, clientY: number) => {
        begun = true;
        const rect = slot.getBoundingClientRect();
        const bounds = panelBounds();
        grabRef.current = {
          x: start.x - rect.left,
          y: start.y - rect.top,
        };
        touchLiftRef.current = e.pointerType === "touch" ? -36 : 0;

        /* Ghost: the section itself, cloned before the placeholder replaces it. */
        const ghost = section.cloneNode(true) as HTMLElement;
        ghost
          .querySelectorAll("[id]")
          .forEach((node) => node.removeAttribute("id"));
        ghost.removeAttribute("data-inspector-section");
        ghost.setAttribute("aria-hidden", "true");
        ghost.classList.add("sortable-ghost");
        ghost.style.width = `${rect.width}px`;
        if (bounds) {
          ghost.style.maxHeight = `${Math.max(
            140,
            Math.min(rect.height, bounds.height * GHOST_HEIGHT_FRACTION),
          )}px`;
        }
        document.body.appendChild(ghost);
        ghostRef.current = ghost;

        dragIdRef.current = id;
        setDrag({ id, height: rect.height });
        const next = [...order];
        liveOrderRef.current = next;
        setLiveOrder(next);
        /* Seed FLIP anchors so the first placeholder jump animates. */
        const anchors = new Map<SmartSectionId, number>();
        for (const [slotId, node] of slotRefs.current) {
          anchors.set(slotId, node.offsetTop);
        }
        flipRef.current = anchors;

        pointerRef.current = { x: start.x, y: start.y };
        moveGhost(clientX, clientY);
        document.body.classList.add("is-sorting-sections");
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(pointerId);
        } catch {
          /* capture is a nicety; the window listeners carry the gesture */
        }
        startAutoScroll();
      };

      /* Self-removing listeners: `detach` holds these exact instances. */
      const onMove = (ev: PointerEvent) => {
        if (!begun) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) {
            return;
          }
          begin(ev.clientX, ev.clientY);
        }
        pointerRef.current = { x: ev.clientX, y: ev.clientY };
        moveGhost(ev.clientX, ev.clientY);
        reposition(ev.clientY);
      };
      const detach = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      };
      const onUp = () => {
        detach();
        detachRef.current = null;
        /* A tap (no drag) is not a reorder: nothing was begun, nothing lands. */
        if (begun) commit();
        else endDrag();
      };
      const onCancel = () => {
        detach();
        detachRef.current = null;
        endDrag();
      };
      detachRef.current = detach;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [
      order,
      moveGhost,
      panelBounds,
      reposition,
      commit,
      endDrag,
      startAutoScroll,
    ],
  );

  /* Never leave a ghost or listeners behind if the panel unmounts mid-drag. */
  useEffect(() => () => endDrag(), [endDrag]);

  const grip = (id: SmartSectionId) => (
    <span
      className="sortable-grip"
      role="button"
      tabIndex={-1}
      aria-label="اسحب لإعادة ترتيب القسم"
      title="اسحب لإعادة ترتيب القسم"
      data-sort-grip={id}
      onPointerDown={startDrag(id)}
      onClick={(e) => e.stopPropagation()}
    >
      <GripVertical className="size-3.5" />
    </span>
  );

  return (
    <>
      {extras.map((extra) => (
        <Fragment key={extra.key}>{extra.node}</Fragment>
      ))}
      <div className="smart-sections" ref={containerRef}>
        {(liveOrder ?? order).map((id) => {
          const child = sections.get(id);
          if (drag?.id === id) {
            return (
              <div
                key={id}
                ref={(node) => registerSlot(id, node)}
                data-sort-id={id}
                data-sort-placeholder=""
                className="sortable-section-slot is-placeholder"
                style={{ height: drag.height }}
              />
            );
          }
          if (!child) return null;
          return (
            <div
              key={id}
              ref={(node) => registerSlot(id, node)}
              data-sort-id={id}
              className="sortable-section-slot"
            >
              {cloneElement(child, { dragHandle: grip(id) })}
            </div>
          );
        })}
      </div>
    </>
  );
}
