import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  FileText,
  Files,
  FolderKanban,
  FolderOpen,
  Home,
  KeyRound,
  Layers,
  LayoutTemplate,
  MessagesSquare,
  Palette,
  PenLine,
  Shapes,
  SlidersHorizontal,
  Wrench,
} from "lucide-react";
import type { SurfaceNavItem } from "@/lib/nav/surface-nav";
import { cn } from "@/lib/utils";

/*
 * One glyph per destination, chosen so no two things an author could confuse
 * look alike: the template shelf is a layout, the editor's elements are shapes,
 * the report tools are a document, the platform page is the institution, and
 * contact is a conversation — not a generic «info».
 */
const ICONS: Record<string, LucideIcon> = {
  "/": Home,
  "/projects": FolderKanban,
  "/templates": LayoutTemplate,
  "/purchase": KeyRound,
  "/custom-design": PenLine,
  "/الهوية": Palette,
  "/about": Building2,
  "/contact": MessagesSquare,
  library: FolderOpen,
  elements: Shapes,
  tools: Wrench,
  pages: Files,
  properties: SlidersHorizontal,
  layers: Layers,
  report: FileText,
};

/**
 * The one navigation strip.
 *
 * Site links and editor panel toggles share it: a horizontal scroller that
 * lives inside the product chrome, never on the physical screen edge, and
 * never behind a hamburger. Vertical page scrolling is left to the browser
 * (`pan-x pan-y`, no preventDefault). A drag that actually moves the strip
 * does not also activate the item under the finger.
 */
export function ProductNav({
  label,
  items,
  activeId,
  isActive,
  onSelect,
  className,
}: {
  label: string;
  items: readonly SurfaceNavItem[];
  /** Single current page (site). Ignored when `isActive` is set. */
  activeId?: string | null;
  /** Editor panels can be open together, so activity is per item. */
  isActive?: (id: string) => boolean;
  /** When set, items are toggles. Otherwise they are links (`item.href`). */
  onSelect?: (id: string) => void;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const down = useRef(false);
  const origin = useRef({ x: 0, y: 0 });

  const activeKey = items
    .filter((item) => (isActive ? isActive(item.id) : item.id === activeId))
    .map((item) => item.id)
    .join("|");

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const current = scroller.querySelector<HTMLElement>("[data-nav-active='true']");
    if (!current) return;
    const strip = scroller.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    if (item.left >= strip.left - 1 && item.right <= strip.right + 1) return;
    current.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeKey]);

  return (
    <nav className={cn("product-nav", className)} aria-label={label} data-product-nav="">
      <div
        ref={scrollerRef}
        className="product-nav-scroll"
        onPointerDown={(event) => {
          down.current = true;
          moved.current = false;
          origin.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          if (!down.current) return;
          if (
            Math.abs(event.clientX - origin.current.x) > 8 ||
            Math.abs(event.clientY - origin.current.y) > 8
          ) {
            moved.current = true;
          }
        }}
        onPointerUp={() => {
          down.current = false;
        }}
        onPointerCancel={() => {
          down.current = false;
          moved.current = false;
        }}
        onClickCapture={(event) => {
          if (!moved.current) return;
          event.preventDefault();
          event.stopPropagation();
          moved.current = false;
        }}
      >
        {items.map((item) => {
          const Icon = ICONS[item.id] ?? Home;
          const active = isActive ? isActive(item.id) : item.id === activeId;
          const className = cn("product-nav-tab", active && "is-active");
          const body = (
            <>
              <Icon className="product-nav-icon" strokeWidth={1.75} aria-hidden />
              <span className="product-nav-label">{item.shortLabel}</span>
            </>
          );
          if (onSelect) {
            return (
              <button
                key={item.id}
                type="button"
                className={className}
                aria-pressed={active}
                aria-label={item.label}
                title={item.title}
                data-nav-active={active ? "true" : undefined}
                onClick={() => onSelect(item.id)}
              >
                {body}
              </button>
            );
          }
          return (
            <a
              key={item.id}
              href={item.href ?? item.id}
              className={className}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              title={item.title}
              data-nav-active={active ? "true" : undefined}
            >
              {body}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
