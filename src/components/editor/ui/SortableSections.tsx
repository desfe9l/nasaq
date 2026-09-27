import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { GripVertical } from "lucide-react";
import { POINTER_SLOP } from "@/lib/editor/canvas-pointer";
import {
  moveSection,
  normalizeSectionOrder,
  SECTION_ORDER_KEY,
} from "@/lib/editor/section-order";

type SectionProps = { id: string; title: string; handle?: ReactNode };
type Ghost = {
  id: string;
  title: string;
  left: number;
  top: number;
  width: number;
};

/** Native pointer DnD, like library-pointer-drag: mouse, touch and Pencil share
 * a gesture. Section sorting is deliberately separate from card payloads so a
 * section can never accidentally insert an element on the canvas. */
export function SortableSections({ children }: { children: ReactNode }) {
  const sections = Children.toArray(children).filter(
    (child): child is ReactElement<SectionProps> =>
      isValidElement<SectionProps>(child) && typeof child.props.id === "string",
  );
  const [order, setOrder] = useState(() => {
    try {
      return normalizeSectionOrder(
        JSON.parse(localStorage.getItem(SECTION_ORDER_KEY) || "null"),
      );
    } catch {
      return normalizeSectionOrder(null);
    }
  });
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [announcement, announce] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const cancel = useRef<(() => void) | null>(null);
  const positions = useRef(new Map<string, number>());
  const hintId = useId();
  const currentOrder = useRef(order);
  currentOrder.current = order;

  const rememberPositions = () => {
    root.current
      ?.querySelectorAll<HTMLElement>("[data-sortable-section]")
      .forEach((el) => {
        positions.current.set(
          el.dataset.sortableSection!,
          el.getBoundingClientRect().top,
        );
      });
  };
  // FLIP: real DOM order, not just visual CSS order (keyboard and AT agree).
  useLayoutEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.current
        ?.querySelectorAll<HTMLElement>("[data-sortable-section]")
        .forEach((el) => {
          const before = positions.current.get(el.dataset.sortableSection!);
          if (before === undefined) return;
          const dy = before - el.getBoundingClientRect().top;
          if (Math.abs(dy) > 1) {
            el.getAnimations().forEach((animation) => animation.cancel());
            el.animate(
              [
                { transform: `translateY(${dy}px)` },
                { transform: "translateY(0)" },
              ],
              { duration: 180, easing: "cubic-bezier(.22,1,.36,1)" },
            );
          }
        });
    }
    positions.current.clear();
  }, [order]);
  useEffect(() => () => cancel.current?.(), []);

  const save = (next: string[], title: string) => {
    try {
      localStorage.setItem(SECTION_ORDER_KEY, JSON.stringify(next));
    } catch {
      /* Private/quota-limited storage: sorting still works this session. */
    }
    announce(`تم ترتيب ${title}`);
  };

  const start = (
    event: ReactPointerEvent<HTMLButtonElement>,
    id: string,
    title: string,
  ) => {
    if (event.button !== 0 || !event.isPrimary || cancel.current) return;
    const host = root.current;
    const scroller = host?.closest<HTMLElement>(".editor-pane-scroll");
    if (!host || !scroller) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const x0 = event.clientX,
      y0 = event.clientY;
    let x = x0,
      y = y0,
      active = false,
      frame = 0,
      lastTime = 0;
    const original = [...currentOrder.current];
    let next = original;
    host.setPointerCapture(pointerId);

    const update = () => {
      const bounds = scroller.getBoundingClientRect();
      const rect = host.getBoundingClientRect();
      const width = Math.max(
        0,
        Math.min(rect.width, bounds.width - 8, window.innerWidth - 8),
      );
      const left = Math.max(
        4,
        Math.min(rect.left, window.innerWidth - width - 4),
      );
      const top = Math.max(
        Math.max(4, bounds.top + 4),
        Math.min(y - 22, Math.min(bounds.bottom, window.innerHeight) - 48),
      );
      setGhost({ id, title, left, top, width });
      // Logical layout boxes ignore FLIP transforms, avoiding collision jitter.
      const rows = Array.from(
        host.querySelectorAll<HTMLElement>("[data-sortable-section]"),
      );
      const others = rows.filter((row) => row.dataset.sortableSection !== id);
      const localY = y - host.getBoundingClientRect().top;
      const index = others.filter(
        (row) => localY > row.offsetTop + row.offsetHeight / 2,
      ).length;
      const candidate = moveSection(next, id, index);
      if (candidate.join() !== next.join()) {
        rememberPositions();
        next = candidate;
        setOrder(next);
      }
    };
    const tick = (time: number) => {
      const rect = scroller.getBoundingClientRect();
      const elapsed = lastTime ? Math.min(time - lastTime, 32) : 16;
      lastTime = time;
      const edge = 44;
      const speed =
        y < rect.top + edge
          ? -Math.min(1, (rect.top + edge - y) / edge)
          : y > rect.bottom - edge
            ? Math.min(1, (y - rect.bottom + edge) / edge)
            : 0;
      if (speed) scroller.scrollTop += speed * elapsed * 0.5;
      update();
      frame = requestAnimationFrame(tick);
    };
    const finish = (commit: boolean) => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", abortPointer);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", abort);
      window.removeEventListener("resize", abort);
      host.removeEventListener("lostpointercapture", abort);
      cancel.current = null;
      if (host.hasPointerCapture(pointerId))
        host.releasePointerCapture(pointerId);
      if (active) {
        if (commit) save(next, title);
        else {
          setOrder(original);
          announce("تم إلغاء السحب");
        }
      }
      setGhost(null);
      host
        .querySelector<HTMLButtonElement>(`[data-section-handle="${id}"]`)
        ?.focus({ preventScroll: true });
    };
    const abort = () => finish(false);
    const abortPointer = (e: PointerEvent) => {
      if (e.pointerId === pointerId) abort();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        abort();
      }
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      x = e.clientX;
      y = e.clientY;
      if (!active && Math.hypot(x - x0, y - y0) < POINTER_SLOP) return;
      e.preventDefault();
      if (!active) {
        active = true;
        announce(`سحب ${title}. اضغط Escape للإلغاء.`);
        frame = requestAnimationFrame(tick);
      }
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === pointerId) finish(true);
    };
    cancel.current = abort;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", abortPointer);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", abort);
    window.addEventListener("resize", abort);
    host.addEventListener("lostpointercapture", abort);
  };

  return (
    <div
      ref={root}
      className="sortable-sections"
      aria-label="أقسام أدوات العناصر"
    >
      <span id={hintId} className="sr-only">
        اسحب لترتيب القسم أو استخدم السهمين للأعلى والأسفل. Escape لإلغاء السحب.
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      {order.map((id) => {
        const section = sections.find((child) => child.props.id === id);
        if (!section) return null;
        const { title } = section.props;
        return (
          <div
            key={id}
            data-sortable-section={id}
            className={
              ghost?.id === id ? "section-drop-placeholder" : undefined
            }
          >
            {cloneElement(section, {
              handle: (
                <button
                  type="button"
                  className="section-drag-handle"
                  data-section-handle={id}
                  aria-label={`ترتيب ${title}`}
                  aria-describedby={hintId}
                  title={`اسحب لترتيب ${title}`}
                  onPointerDown={(event) => start(event, id, title)}
                  onKeyDown={(event) => {
                    if (
                      ghost ||
                      !["ArrowUp", "ArrowDown", "Home", "End"].includes(
                        event.key,
                      )
                    )
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    const index = order.indexOf(id);
                    const to =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? order.length - 1
                          : index + (event.key === "ArrowUp" ? -1 : 1);
                    const next = moveSection(order, id, to);
                    rememberPositions();
                    setOrder(next);
                    save(next, title);
                  }}
                >
                  <GripVertical className="size-4" aria-hidden />
                </button>
              ),
            })}
          </div>
        );
      })}
      {ghost && (
        <div
          className="section-drag-ghost"
          aria-hidden
          style={{ left: ghost.left, top: ghost.top, width: ghost.width }}
        >
          <GripVertical className="size-4 shrink-0" />
          <span className="truncate">{ghost.title}</span>
        </div>
      )}
    </div>
  );
}
