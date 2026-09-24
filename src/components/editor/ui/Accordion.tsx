import { useCallback, useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Collapsible inspector section.
 *
 * Two rules drive this component, both coming from the touch-first brief:
 *  · the header is a **44px** minimum tap target (Apple HIG) — no more 36px
 *    rows that a thumb misses;
 *  · the chevron is a real rotating indicator, not a `+`/`−` glyph, so the
 *    open/closed state is readable at a glance in both themes.
 *
 * The body is rendered conditionally (not just hidden) because property panels
 * hold hundreds of inputs; keeping closed sections in the DOM costs layout time
 * on every canvas frame.
 */
export function AccordionSection({
  title,
  id,
  open,
  onToggle,
  children,
  badge,
}: {
  title: string;
  id: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Small trailing hint (e.g. the element type a section applies to). */
  badge?: ReactNode;
}) {
  const panelId = useId();
  return (
    <section className="editor-accordion" data-inspector-section={id} data-open={open || undefined}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="editor-accordion-header"
      >
        <span className="min-w-0 flex-1 truncate text-start">{title}</span>
        {badge}
        <ChevronDown className={cn("editor-accordion-chevron size-4 shrink-0", open && "is-open")} aria-hidden />
      </button>
      {open && (
        <div id={panelId} className="editor-accordion-body">
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * Sub-group inside an accordion (used where a group holds several visual
 * clusters, e.g. «النص» → typography + Arabic handling). Keeps a quiet heading
 * instead of a second row of heavy accordion chrome.
 */
export function SubGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="editor-subgroup">
      <h4 className="editor-subgroup-title">{title}</h4>
      <div className="grid gap-2.5">{children}</div>
    </div>
  );
}

const STORAGE_PREFIX = "nasaq.accordion.";

/**
 * Accordion open/closed state that survives reloads.
 *
 * Property panels are personal: someone who keeps «الخلفية والحدود» closed will
 * want it closed tomorrow too. State is namespaced per panel so the library and
 * the properties inspector never share a key.
 */
export function useAccordionState<T extends string>(
  panelKey: string,
  defaults: Partial<Record<T, boolean>> = {},
) {
  const storageKey = `${STORAGE_PREFIX}${panelKey}`;
  const [state, setState] = useState<Record<string, boolean>>(() => {
    const seed = { ...defaults } as Record<string, boolean>;
    if (typeof localStorage === "undefined") return seed;
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) || "{}");
      return { ...seed, ...((raw && typeof raw === "object" ? raw : {}) as Record<string, boolean>) };
    } catch {
      return seed;
    }
  });

  const toggle = useCallback(
    (key: T) => {
      setState((current) => {
        const next = { ...current, [key]: !(current[key] ?? false) };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* private mode: state simply stops persisting */
        }
        return next;
      });
    },
    [storageKey],
  );

  const isOpen = useCallback((key: T, fallback = false) => state[key] ?? fallback, [state]);

  return { isOpen, toggle, state };
}

/** Non-persistent variant for surfaces where remembering state is unwanted. */
export function useLocalAccordion<T extends string>(defaults: Partial<Record<T, boolean>> = {}) {
  const [state, setState] = useState<Record<string, boolean>>(() => ({ ...defaults }) as Record<string, boolean>);
  return {
    isOpen: (key: T, fallback = false) => state[key] ?? fallback,
    toggle: (key: T) => setState((current) => ({ ...current, [key]: !(current[key] ?? false) })),
  };
}
