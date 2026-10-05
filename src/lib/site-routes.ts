/**
 * NASAQ route catalog — the ONE place every durable URL is written.
 *
 * THE RULE THIS MODULE EXISTS FOR
 * ------------------------------
 * A destination the visitor can reach must be an address the visitor can
 * type, bookmark, refresh, share, and come back to. Nothing important is
 * allowed to live behind component state.
 *
 * So every meaningful surface of the product has a stable path here, and every
 * link, button and redirect in the app is built from these constants instead of
 * a hand-written string. When a path has to change, it changes once — in
 * `LEGACY_ROUTE_REDIRECTS` — and old bookmarks keep working from the redirect
 * routes that read it.
 *
 * What is deliberately NOT here: the editor's transient authoring gestures
 * (a panel tab, a preview mode, a zoom level). Those are state of a document
 * that already has a URL, not destinations of their own.
 */

/** Canonical URL of the template library (`src/routes/templates/index.tsx`). */
export const TEMPLATES_ROUTE = "/templates";

/**
 * Canonical URL of the template-import service (`src/routes/import.tsx`).
 *
 * A file route (not a directory route), so the public path is exactly
 * `/import` with no trailing-slash redirect.
 */
export const IMPORT_ROUTE = "/import";

/** The studio Home of a licensed account. */
export const WORKSPACE_ROUTE = "/workspace";

/** The professional creation screen: choose format, size and orientation. */
export const CREATE_ROUTE = "/create";

/** The AI design generation studio. */
export const STUDIO_ROUTE = "/studio";

/**
 * `/ai` — «من محتوى خام إلى مستند» (`src/routes/ai.tsx`).
 *
 * The public demonstration of the real pipeline: the visitor pastes their own
 * content, the page measures it, composes a real A4 document with the shared
 * composer, runs the shared critic, and reports the before/after verdict. It
 * ends in a real editable NASAQ document, never a mock preview.
 */
export const AI_RAW_ROUTE = "/ai";

/** The editor. Bare `/editor` is an ENTRY, never a blank canvas — see routes. */
export const EDITOR_ROUTE = "/editor";

/** The project shelf. */
export const PROJECTS_ROUTE = "/projects";

/** The asset library. */
export const LIBRARY_ROUTE = "/library";

export const ACCOUNT_ROUTE = "/account";
export const LICENSE_ROUTE = "/license";
export const PURCHASE_ROUTE = "/purchase";
export const PRICING_ROUTE = "/pricing";
export const CUSTOM_DESIGN_ROUTE = "/custom-design";
export const BRAND_ROUTE = "/الهوية";
export const ABOUT_ROUTE = "/about";
export const CONTACT_ROUTE = "/contact";
export const PRIVACY_ROUTE = "/privacy";
export const TERMS_ROUTE = "/terms";
export const MY_TEMPLATES_ROUTE = "/my-templates";
export const OPEN_ROUTE = "/open";
export const DEMO_ROUTE = "/demo";
export const LOGIN_ROUTE = "/login";
export const OWNER_VAULT_ROUTE = "/owner-vault";

/**
 * Admin console sections — one URL per management function.
 *
 * The console is a real nested route tree (`src/routes/admin.tsx` layout plus
 * one route per section), so a section is a destination: it can be linked,
 * bookmarked, refreshed and shared with the team, and browser Back moves
 * between sections instead of being swallowed by a tab switch.
 */
export const ADMIN_ROUTES = {
  /** Operations dashboard: the state of the platform in one screen. */
  dashboard: "/admin",
  /** Client requests: the platform's own inbox for «تواصل معنا / اطلب خدمة». */
  requests: "/admin/requests",
  /** Template records: create, edit, duplicate, delete, publish, preview. */
  templates: "/admin/templates",
  /** The template studio: design-time authoring entry points. */
  studio: "/admin/studio",
  /** Content and messaging of the public site. */
  content: "/admin/content",
  /** Site imagery, institutional backgrounds and library assets. */
  assets: "/admin/assets",
  /** Brand identity: palettes, marks and identity presets. */
  branding: "/admin/branding",
  /** Users and accounts. */
  users: "/admin/users",
  /** Licences and entitlements. */
  licenses: "/admin/licenses",
  /** Manual payment requests and the payment gateway. */
  payments: "/admin/payments",
  /** Plans, prices and subscription state. */
  plans: "/admin/plans",
  /** System settings, including commercial configuration. */
  settings: "/admin/settings",
  /** Audit log of privileged actions. */
  audit: "/admin/audit",
  /** Template import service (PSD / package intake). */
  import: "/admin/import",
} as const;

export type AdminSectionId = keyof typeof ADMIN_ROUTES;

/** One admin section, in navigation order — the console's spatial model. */
export interface AdminSection {
  id: AdminSectionId;
  to: string;
  label: string;
  /** Short description, used as the section's own subtitle. */
  description: string;
  /** Groups the section in the console navigation. */
  group: "operations" | "content" | "identity";
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    id: "dashboard",
    to: ADMIN_ROUTES.dashboard,
    label: "لوحة القيادة",
    description: "حالة المنصة: المشتركون، المدفوعات، والقوالب في لمحة واحدة.",
    group: "operations",
  },
  {
    id: "requests",
    to: ADMIN_ROUTES.requests,
    label: "الطلبات والمراسلات",
    description: "طلبات العملاء الواردة من المنصة: المتابعة، الرد، وإعدادات التواصل.",
    group: "operations",
  },
  {
    id: "users",
    to: ADMIN_ROUTES.users,
    label: "المستخدمون",
    description: "حسابات المنصة: الحالة، الباقة، وتواريخ الاشتراك.",
    group: "operations",
  },
  {
    id: "licenses",
    to: ADMIN_ROUTES.licenses,
    label: "التراخيص",
    description: "إصدار التراخيص ومفاتيح التفعيل وربطها بالحسابات.",
    group: "operations",
  },
  {
    id: "payments",
    to: ADMIN_ROUTES.payments,
    label: "المدفوعات",
    description: "طلبات الدفع اليدوية، بوابة الشراء، والموافقات.",
    group: "operations",
  },
  {
    id: "plans",
    to: ADMIN_ROUTES.plans,
    label: "الباقات",
    description: "الخطط والأسعار والاشتراكات وحدود الاستخدام.",
    group: "operations",
  },
  {
    id: "templates",
    to: ADMIN_ROUTES.templates,
    label: "القوالب",
    description: "إدارة سجلات القوالب: إنشاء، تحرير، نسخ، نشر، ومعاينة.",
    group: "content",
  },
  {
    id: "studio",
    to: ADMIN_ROUTES.studio,
    label: "استوديو القوالب",
    description: "بناء قالب جديد وتحريره بصفحات نَسَق الحقيقية.",
    group: "content",
  },
  {
    id: "import",
    to: ADMIN_ROUTES.import,
    label: "استيراد القوالب",
    description: "استيراد ملفات PSD وحزم التصميم إلى مكتبة القوالب.",
    group: "content",
  },
  {
    id: "content",
    to: ADMIN_ROUTES.content,
    label: "محتوى الموقع",
    description: "نصوص الواجهة والإعلان وصفحات التسويق.",
    group: "content",
  },
  {
    id: "assets",
    to: ADMIN_ROUTES.assets,
    label: "صور الموقع",
    description: "صور الواجهة والخلفيات المؤسسية المستخدمة في القوالب.",
    group: "content",
  },
  {
    id: "branding",
    to: ADMIN_ROUTES.branding,
    label: "الهوية",
    description: "لوحات الهوية الافتراضية والألوان المعتمدة.",
    group: "identity",
  },
  {
    id: "settings",
    to: ADMIN_ROUTES.settings,
    label: "إعدادات النظام",
    description: "الأسعار، الدفع، وحدود المنصة.",
    group: "identity",
  },
  {
    id: "audit",
    to: ADMIN_ROUTES.audit,
    label: "سجل الإجراءات",
    description: "كل إجراء إداري، ومن نفّذه، ومتى.",
    group: "identity",
  },
] as const;

/** Titles of the admin section groups, in order. */
export const ADMIN_SECTION_GROUPS: readonly {
  id: AdminSection["group"];
  label: string;
}[] = [
  { id: "operations", label: "التشغيل" },
  { id: "content", label: "المحتوى والقوالب" },
  { id: "identity", label: "الهوية والنظام" },
] as const;

/** True for a section the visitor is currently on (exact or nested). */
export function isAdminSectionActive(
  current: string,
  section: { to: string },
): boolean {
  if (section.to === ADMIN_ROUTES.dashboard) return current === ADMIN_ROUTES.dashboard;
  return current === section.to || current.startsWith(`${section.to}/`);
}

/* ── path builders ────────────────────────────────────────────────────── */

/** Percent-encode one path segment without mangling Arabic slugs. */
function segment(value: string): string {
  return encodeURIComponent(String(value ?? "").trim());
}

/** `/editor/<projectId>` — a durable address for one document. */
export function editorPathFor(projectId: string): string {
  return `${EDITOR_ROUTE}/${segment(projectId)}`;
}

/** `/projects/<projectId>` — the project's own page. */
export function projectPathFor(projectId: string): string {
  return `${PROJECTS_ROUTE}/${segment(projectId)}`;
}

/** `/templates/<idOrSlug>` — a template's own page (never the editor). */
export function templatePathFor(idOrSlug: string): string {
  return `${TEMPLATES_ROUTE}/${segment(idOrSlug)}`;
}

/** `/templates/<idOrSlug>/preview` — the full-page preview. */
export function templatePreviewPathFor(idOrSlug: string): string {
  return `${templatePathFor(idOrSlug)}/preview`;
}

/** `/templates/<idOrSlug>/share` — the sharing surface of one template. */
export function templateSharePathFor(idOrSlug: string): string {
  return `${templatePathFor(idOrSlug)}/share`;
}

/**
 * `/templates/category/<id>` — a template category as its own page.
 *
 * Category browsing used to be query parameters only (`?pill=…`), which means a
 * category could not be linked, indexed, or shared as a destination. The
 * category id is validated by the page against `TEMPLATE_CATEGORIES`; this
 * builder only guarantees an absolute, encoded segment.
 */
export const TEMPLATE_CATEGORY_ROUTE = `${TEMPLATES_ROUTE}/category`;

export function categoryPathFor(categoryId: string): string {
  return `${TEMPLATE_CATEGORY_ROUTE}/${segment(categoryId)}`;
}

/**
 * `/templates/share/<token>` — a personally shared template copy.
 *
 * This used to build `/share/<token>`, an address no route ever served, so any
 * link produced with it was a 404. The real route lives under `/templates`,
 * and `/share/<token>` now redirects to the short form below.
 */
export function sharedTemplatePathFor(token: string): string {
  return `${TEMPLATES_ROUTE}/share/${segment(token)}`;
}

/* ── short share links ─────────────────────────────────────────────────── */

/**
 * `/t/<code>` — the short, professional address of a published template.
 *
 * Seven unambiguous characters instead of an internal id: `nasaq.app/t/k7m2p9q`
 * rather than `…/templates/tpl_9f2c1a7e-4b0d-4a55-9c31-0aa9d0b21f44`.
 */
export const SHORT_TEMPLATE_ROUTE = "/t";

/** `/s/<code>` — the short address of a personally shared template. */
export const SHORT_SHARE_ROUTE = "/s";

/** Short-code segment, or `null` when the value is not a code. */
function shortSegment(code: string): string | null {
  const raw = String(code || "").trim().toLowerCase();
  return /^[a-z0-9]{4,12}$/.test(raw) ? raw : null;
}

export function templateShortPathFor(code: string): string | null {
  const part = shortSegment(code);
  return part ? `${SHORT_TEMPLATE_ROUTE}/${part}` : null;
}

export function sharedShortPathFor(code: string): string | null {
  const part = shortSegment(code);
  return part ? `${SHORT_SHARE_ROUTE}/${part}` : null;
}

/**
 * `/create?…` — the creation screen, optionally pre-configured.
 *
 * `start` names the WAY the document begins (blank · template · ai · raw), so a
 * chosen entry point is an address the author can bookmark, share and return to,
 * not a transient panel state.
 */
export type CreateStartId = "blank" | "template" | "ai" | "raw";

export function createPathFor(
  params: { start?: CreateStartId; template?: string; size?: string } = {},
): string {
  const search = new URLSearchParams();
  if (params.start) search.set("start", params.start);
  if (params.template) search.set("template", params.template);
  if (params.size) search.set("size", params.size);
  const query = search.toString();
  return query ? `${CREATE_ROUTE}?${query}` : CREATE_ROUTE;
}

/** `/templates?…` — the gallery, optionally pre-filtered. */
export function templatesFilterPathFor(params: { pill?: string; q?: string } = {}): string {
  const search = new URLSearchParams();
  if (params.pill) search.set("pill", params.pill);
  if (params.q) search.set("q", params.q);
  const query = search.toString();
  return query ? `${TEMPLATES_ROUTE}?${query}` : TEMPLATES_ROUTE;
}

/* ── legacy addresses ─────────────────────────────────────────────────── */

/**
 * Paths that moved, mapped to their canonical destination.
 *
 * Read by the small redirect routes under `src/routes/` so a bookmark, a
 * previously shared link or an installed app's saved URL resolves to the
 * surface it always meant — never to the editor, and never to a 404.
 */
export const LEGACY_ROUTE_REDIRECTS: Readonly<Record<string, string>> = {
  "/home": WORKSPACE_ROUTE,
  "/admin-dashboard": ADMIN_ROUTES.templates,
  "/admin-licenses": ADMIN_ROUTES.licenses,
  "/brand-kit": BRAND_ROUTE,
  "/my-templates": `${TEMPLATES_ROUTE}?pill=custom`,
};

/** The canonical destination for a legacy path, or null when it is not one. */
export function legacyRedirectFor(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  return LEGACY_ROUTE_REDIRECTS[clean] ?? null;
}
