import {
  FolderKanban,
  FilePlus2,
  FileUp,
  Home,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface CoreNavItem {
  id: string;
  href: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
}

export const CORE_NAV_ITEMS: CoreNavItem[] = [
  {
    id: "/",
    href: "/",
    label: "الرئيسية",
    shortLabel: "الرئيسية",
    icon: Home,
  },
  {
    id: "/workspace",
    href: "/workspace",
    label: "مساحة العمل",
    shortLabel: "مساحة العمل",
    icon: FolderKanban,
  },
  {
    id: "/create",
    href: "/create",
    label: "مستند جديد",
    shortLabel: "مستند جديد",
    icon: FilePlus2,
  },
  {
    id: "/services/import",
    href: "/services/import",
    label: "الاستيراد الذكي",
    shortLabel: "الاستيراد",
    icon: FileUp,
  },
  {
    id: "/contact",
    href: "/contact",
    label: "التواصل والدعم",
    shortLabel: "التواصل",
    icon: MessagesSquare,
  },
];

export function isNavActive(itemId: string, currentPath: string): boolean {
  if (itemId === "/") {
    return currentPath === "/" || currentPath === "";
  }
  if (itemId === "/workspace") {
    return (
      currentPath.startsWith("/workspace") ||
      currentPath.startsWith("/projects") ||
      currentPath === "/home"
    );
  }
  if (itemId === "/create") {
    return currentPath.startsWith("/create");
  }
  if (itemId === "/services/import") {
    return (
      currentPath.startsWith("/services/import") ||
      currentPath.startsWith("/import")
    );
  }
  if (itemId === "/contact") {
    return currentPath.startsWith("/contact");
  }
  return currentPath === itemId;
}

/**
 * Desktop Segmented Control Bar: Broad, centered, zero horizontal scrolling,
 * 100% visible 5 core pillars at all times.
 */
export function DesktopSegmentedNav({
  current,
  className,
}: {
  current: string;
  className?: string;
}) {
  return (
    <nav
      className={cn(
        "hidden md:flex items-center gap-1 rounded-xl border border-line/80 bg-surface-2/70 p-1 shadow-xs",
        className,
      )}
      aria-label="الروابط الرئيسية"
    >
      {CORE_NAV_ITEMS.map((item) => {
        const active = isNavActive(item.id, current);
        const Icon = item.icon;
        return (
          <a
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold transition-all duration-150",
              "active:scale-[0.98]",
              active
                ? "bg-navy text-on-brand shadow-xs ring-1 ring-brand/30"
                : "text-muted hover:bg-surface hover:text-ink",
            )}
          >
            <Icon className="size-4 shrink-0" strokeWidth={active ? 2 : 1.75} />
            <span>{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

/**
 * Mobile Adaptive Navigation:
 * Fixed 5-column bottom dock with clear labels and icons in a single unified view.
 * Zero horizontal scrolling. Zero hidden tabs behind a menu.
 */
export function MobileBottomNav({
  current,
  className,
}: {
  current: string;
  className?: string;
}) {
  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 md:hidden border-t border-line/80 bg-surface/95 backdrop-blur-md pb-[max(0.35rem,env(safe-area-inset-bottom))]",
        className,
      )}
      aria-label="شريط التنقل الرئيسي للجوال"
    >
      <div className="grid grid-cols-5 h-14 items-center">
        {CORE_NAV_ITEMS.map((item) => {
          const active = isNavActive(item.id, current);
          const Icon = item.icon;
          return (
            <a
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-1 h-full text-center transition-colors duration-150",
                active ? "text-brand" : "text-muted hover:text-ink",
              )}
            >
              <div
                className={cn(
                  "grid size-7 place-items-center rounded-lg transition-transform",
                  active ? "bg-navy/10 scale-105" : "bg-transparent",
                )}
              >
                <Icon
                  className="size-4 shrink-0"
                  strokeWidth={active ? 2.2 : 1.75}
                />
              </div>
              <span
                className={cn(
                  "text-[10px] font-bold leading-none truncate max-w-[90%]",
                  active ? "text-brand font-extrabold" : "text-muted",
                )}
              >
                {item.shortLabel}
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
