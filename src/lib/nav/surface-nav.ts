/**
 * One navigation model for the site header and the editor surface.
 *
 * Routes stay the ones in `NAV_ITEMS`. Nothing here is a gesture, an edge
 * swipe, or a hamburger: every destination is an explicit item the chrome
 * renders inside the product, away from the physical screen edge.
 */
import { NAV_ITEMS } from "../brand.ts";

/** Practical minimum hit size for a finger (CSS px). */
export const NAV_TOUCH_TARGET = 44;

export interface SurfaceNavItem {
  id: string;
  /** Full name — accessible name and tooltip. */
  label: string;
  /** Compact visible label. Never empty. */
  shortLabel: string;
  /** Site routes. Editor items omit this and toggle a panel instead. */
  href?: string;
  title: string;
}

const SITE_SHORT: Record<string, string> = {
  "/": "الرئيسية",
  "/projects": "المشاريع",
  "/templates": "القوالب",
  "/purchase": "التراخيص",
  "/custom-design": "تصميم",
  "/الهوية": "الهوية",
  "/about": "المنصة",
  "/contact": "تواصل",
};

/** Every public route, in `NAV_ITEMS` order. No overflow menu, no drawer. */
export const SITE_SURFACE_NAV: readonly SurfaceNavItem[] = NAV_ITEMS.map(
  (item) => ({
    id: item.to,
    href: item.to,
    label: item.label,
    shortLabel: SITE_SHORT[item.to] ?? item.label,
    title: item.label,
  }),
);

/**
 * Editor surfaces that used to hide behind «عرض» or a drawer edge.
 * `pages` is the document pages tab (and reveals the page rail); the rest
 * are the six workspace windows.
 */
export const EDITOR_SURFACE_NAV: readonly SurfaceNavItem[] = [
  {
    id: "library",
    label: "المكتبة",
    shortLabel: "المكتبة",
    title: "المكتبة — صور وشعارات وملفات محفوظة",
  },
  {
    id: "elements",
    label: "العناصر",
    shortLabel: "العناصر",
    title: "لوحة العناصر",
  },
  {
    id: "tools",
    label: "الأدوات",
    shortLabel: "الأدوات",
    title: "أدوات العناصر",
  },
  {
    id: "pages",
    label: "الصفحات",
    shortLabel: "الصفحات",
    title: "صفحات المستند",
  },
  {
    id: "properties",
    label: "الخصائص",
    shortLabel: "الخصائص",
    title: "خصائص العنصر المحدد",
  },
  {
    id: "layers",
    label: "الطبقات",
    shortLabel: "الطبقات",
    title: "طبقات الصفحة",
  },
  {
    id: "report",
    label: "التقرير",
    shortLabel: "التقرير",
    title: "أدوات التقرير",
  },
];

export const EDITOR_SURFACE_IDS = EDITOR_SURFACE_NAV.map((item) => item.id);

/** True when every route is still an explicit nav item. */
export function coversRoutes(
  items: readonly { id: string }[],
  routes: readonly { to: string }[],
): boolean {
  return routes.every((route) => items.some((item) => item.id === route.to));
}
