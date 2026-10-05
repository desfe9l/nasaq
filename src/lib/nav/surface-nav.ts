/**
 * One navigation model for the site header and the editor surface.
 *
 * Routes stay the ones in `NAV_ITEMS`. Nothing here is a gesture, an edge
 * swipe, or a hamburger: every destination is an explicit item the chrome
 * renders inside the product, away from the physical screen edge.
 */
import { NAV_ITEMS, type NavItem } from "../brand.ts";

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
  /**
   * The destination holds an account's own documents.
   *
   * Such a tab is only offered to a verified session: a visitor must not see
   * «المشاريع» in the chrome, and the route itself is separately guarded
   * (`RequireSignedIn`). Hide-until-resolved (rather than show-then-redirect)
   * is deliberate — the navigation a visitor sees never advertises a surface
   * they cannot open.
   */
  requiresSession?: boolean;
}

const SITE_SHORT: Record<string, string> = {
  "/": "الرئيسية",
  "/projects": "المشاريع",
  "/templates": "القوالب",
  "/purchase": "التراخيص",
  // «طلب تصميم» — a service REQUEST, never the editor's «إنشاء تصميم».
  "/custom-design": "طلب تصميم",
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
    requiresSession: item.requiresSession,
  }),
);

/**
 * The site strip a given session may see.
 *
 * One predicate, used by the header and the footer, so a visitor can never
 * reach «المشاريع» from one surface while it is hidden on another.
 */
export function siteNavFor(signedIn: boolean): readonly SurfaceNavItem[] {
  return SITE_SURFACE_NAV.filter((item) => !item.requiresSession || signedIn);
}

/** Footer links share the header's visibility rule (see `siteNavFor`). */
export function siteNavLabelsFor(signedIn: boolean): readonly NavItem[] {
  const allowed = new Set(siteNavFor(signedIn).map((item) => item.id));
  return NAV_ITEMS.filter((item) => allowed.has(item.to));
}

/**
 * Editor surfaces that used to hide behind «عرض» or a drawer edge.
 * Every existing left-panel tab and workspace window has a direct route.
 * These are navigation targets, not extra panels or editor state.
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
    id: "shapes",
    label: "الأشكال",
    shortLabel: "الأشكال",
    title: "الأشكال والرموز",
  },
  {
    id: "templates",
    label: "القوالب",
    shortLabel: "القوالب",
    title: "قوالب الصفحات",
  },
  {
    id: "theme",
    label: "الألوان",
    shortLabel: "الألوان",
    title: "ألوان المستند",
  },
  { id: "fonts", label: "الخطوط", shortLabel: "الخطوط", title: "خطوط النصوص" },
  {
    id: "settings",
    label: "الإعدادات",
    shortLabel: "الإعدادات",
    title: "إعدادات المستند",
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

/** Tabs hosted by the existing elements window, including custom groupings. */
export const EDITOR_ELEMENT_TAB_IDS = [
  "elements",
  "shapes",
  "templates",
  "theme",
  "fonts",
  "settings",
  "pages",
] as const;

export function isEditorElementTab(
  id: string,
): id is (typeof EDITOR_ELEMENT_TAB_IDS)[number] {
  return (EDITOR_ELEMENT_TAB_IDS as readonly string[]).includes(id);
}

/** Never mark Elements active while its Pages/Fonts/etc. child is showing. */
export function editorSurfaceActive(
  id: string,
  leftTab: string,
  panels: Readonly<Record<string, boolean>>,
): boolean {
  if (!isEditorElementTab(id)) return Boolean(panels[id]);
  const visibleTab =
    leftTab === "library" || leftTab === "tools" ? "elements" : leftTab;
  return Boolean(panels.elements) && visibleTab === id;
}
