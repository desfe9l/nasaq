/*
 * The NASAQ admin console shell.
 *
 * One nested route tree under `/admin`, one URL per management function, and a
 * navigation strip made of real links — never a `useState` tab that a refresh
 * forgets. The console is shared by two authorities (the platform
 * administrator and the content owner), so access is resolved ONCE here and
 * every section is told what it may show:
 *
 *   · `commercial` — `amIAdmin`: plans, payments, customers, licences, audit.
 *   · `content`    — `adminTemplatesAccessFn`: template records, the studio,
 *                    site content, imagery, brand presets, imports.
 *
 * Neither probe is the security boundary: every server function re-verifies.
 * The probes decide what the shell *renders*, and nothing else.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import {
  Bot,
  Boxes,
  Image as ImageIcon,
  KeyRound,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Megaphone,
  Package,
  Palette,
  ReceiptText,
  ScrollText,
  Settings,
  Share2,
  Shield,
  Sparkles,
  Store,
  Tags,
  Users,
  Vault,
} from "lucide-react";
import { ThemedToaster } from "@/components/ui/ThemedToaster";
import { amIAdmin } from "@/lib/commercial/admin-functions";
import { adminTemplatesAccessFn } from "@/lib/admin/functions";
import { signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  ADMIN_ROUTES,
  ADMIN_SECTIONS,
  ADMIN_SECTION_GROUPS,
  BRAND_ROUTE,
  type AdminSection,
  isAdminSectionActive,
} from "@/lib/site-routes";
import { cn } from "@/lib/utils";

export interface AdminAccess {
  /** Both probes answered — safe to render a decision. */
  ready: boolean;
  /** May manage the platform: customers, plans, payments, licences, audit. */
  commercial: boolean;
  /** May manage templates and site content. */
  content: boolean;
  /** Which probe failed last, for the denial screen. */
  error: string | null;
}

const AdminAccessContext = createContext<AdminAccess>({
  ready: false,
  commercial: false,
  content: false,
  error: null,
});

export function useAdminAccess(): AdminAccess {
  return useContext(AdminAccessContext);
}

/** Resolve both authorities for the signed-in session. */
export function resolveAdminAccess(): Promise<AdminAccess> {
  return Promise.all([
    amIAdmin()
      .then((result) => Boolean(result.isAdmin))
      .catch(() => false),
    adminTemplatesAccessFn()
      .then((result) => result.ok)
      .catch(() => false),
  ]).then(([commercial, content]) => ({
    ready: true,
    commercial,
    content,
    error: null,
  }));
}

/** One icon per section — the console's navigation is scannable at a glance. */
const SECTION_ICONS: Record<string, typeof Users> = {
  dashboard: LayoutDashboard,
  users: Users,
  licenses: KeyRound,
  payments: ReceiptText,
  plans: Package,
  templates: LayoutTemplate,
  studio: Sparkles,
  import: Layers,
  content: Megaphone,
  assets: ImageIcon,
  branding: Palette,
  settings: Settings,
  audit: ScrollText,
  store: Store,
  categories: Tags,
  sharing: Share2,
  ai: Bot,
  vault: Vault,
};

export function AdminConsole({ children }: { children?: ReactNode }) {
  const { user } = useCurrentUserState();
  const pathname = useLocation({ select: (location) => location.pathname });
  const [access, setAccess] = useState<AdminAccess>({
    ready: false,
    commercial: false,
    content: false,
    error: null,
  });

  useEffect(() => {
    let alive = true;
    void resolveAdminAccess().then((next) => {
      if (alive) setAccess(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!access.ready) {
    return (
      <div dir="rtl" className="grid min-h-screen place-items-center bg-paper">
        <ThemedToaster position="top-center" richColors dir="rtl" />
        <p className="text-[13px] text-muted">جارٍ التحقق من الصلاحيات…</p>
      </div>
    );
  }

  if (!access.commercial && !access.content) {
    return (
      <div dir="rtl" className="grid min-h-screen place-items-center bg-paper p-4">
        <ThemedToaster position="top-center" richColors dir="rtl" />
        <section className="w-full max-w-md rounded-2xl border border-danger/30 bg-surface p-6 shadow-card">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-danger/10 text-error">
              <Shield className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-[17px] font-black text-ink">لا تملك صلاحية الوصول</h1>
              <p className="text-[12px] text-muted">لوحة الإدارة مخصّصة للمسؤولين والمالك الموثّق.</p>
            </div>
          </div>
          <p className="mt-4 text-[12.5px] leading-6 text-muted">
            إذا كنت تعتقد أن هذا خطأ، تواصل مع إدارة المنصة. وإذا كانت قاعدة
            البيانات جديدة بلا مسؤول بعد، يمكنك تفعيل حسابك كأول مسؤول.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={BRAND_ROUTE}
              className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-[12px] font-bold"
            >
              الموقع
            </a>
            <button
              type="button"
              onClick={async () => {
                const { adminBootstrapFirst } = await import("@/lib/commercial/admin-functions");
                const result = await adminBootstrapFirst();
                if (result.ok) window.location.reload();
              }}
              className="inline-flex h-9 items-center rounded-lg bg-navy px-3 text-[12px] font-extrabold text-on-brand"
            >
              تفعيل كأول مسؤول
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <AdminAccessContext.Provider value={access}>
      <div dir="rtl" className="min-h-screen bg-paper text-ink">
        <ThemedToaster position="top-center" richColors dir="rtl" />
        <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-[10px] bg-navy/10 text-brand">
                <Shield className="size-4" aria-hidden />
              </span>
              <div className="leading-tight">
                <p className="text-[9px] font-extrabold tracking-[0.2em] text-muted">
                  NASAQ · CONSOLE
                </p>
                <strong className="text-[14.5px] font-black">لوحة الإدارة</strong>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="hidden max-w-[220px] items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[10px] font-bold text-muted sm:inline-flex"
                title={user?.primaryEmail ?? user?.id ?? ""}
              >
                <Shield className="size-3 text-brand" aria-hidden />
                <span className="truncate" dir="ltr">
                  {user?.primaryEmail || user?.displayName || user?.id || "—"}
                </span>
              </span>
              <Link
                to={BRAND_ROUTE}
                className="inline-flex h-9 items-center rounded-[9px] border border-line px-3 text-[12px] font-bold transition hover:border-brand"
              >
                الموقع
              </Link>
              <Link
                to={ADMIN_ROUTES.dashboard}
                className="inline-flex h-9 items-center rounded-[9px] border border-line px-3 text-[12px] font-bold transition hover:border-brand"
              >
                لوحة القيادة
              </Link>
              <button
                type="button"
                onClick={() => void signOut("/")}
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-line px-3 text-[12px] font-bold text-muted transition hover:border-danger/50 hover:text-error"
              >
                <LogOut className="size-3.5" aria-hidden />
                خروج
              </button>
            </div>
          </div>

          {/*
           * Compact chip row — the sidebar's twin for short screens (phones,
           * iPad in split view). Same links, same order, same active rule.
           */}
          <nav
            aria-label="أقسام لوحة الإدارة"
            className="mx-auto max-w-7xl overflow-x-auto px-4 pb-2 lg:hidden"
          >
            <ul className="flex min-w-max items-center gap-1">
              {sectionListFor(access).map((section) => (
                <li key={section.id}>
                  <AdminNavLink section={section} pathname={pathname} variant="chip" />
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
          {/*
           * The ONE admin navigation: a grouped sidebar on wide screens.
           * Every management function in the platform lives in this tree with
           * its own direct URL — nothing admin is scattered on unrelated pages.
           */}
          <aside className="sticky top-[104px] hidden h-max w-56 shrink-0 flex-col gap-4 lg:flex">
            {ADMIN_SECTION_GROUPS.map((group) => {
              const items = sectionListFor(access).filter(
                (section) => section.group === group.id,
              );
              if (!items.length) return null;
              return (
                <nav
                  key={group.id}
                  aria-label={`مجموعة ${group.label}`}
                  className="grid gap-1"
                >
                  <p className="px-2 text-[9px] font-black tracking-[0.18em] text-muted">
                    {group.label}
                  </p>
                  {items.map((section) => (
                    <AdminNavLink
                      key={section.id}
                      section={section}
                      pathname={pathname}
                      variant="row"
                    />
                  ))}
                </nav>
              );
            })}
          </aside>

          <main className="min-w-0 flex-1">{children ?? <Outlet />}</main>
        </div>
      </div>
    </AdminAccessContext.Provider>
  );
}

/** One navigation entry — sidebar row or compact chip; one rule for both. */
function AdminNavLink({
  section,
  pathname,
  variant,
}: {
  section: AdminSection;
  pathname: string;
  variant: "row" | "chip";
}) {
  const Icon = SECTION_ICONS[section.id] ?? Boxes;
  const active = isAdminSectionActive(pathname, section);
  return (
    <Link
      to={section.to}
      aria-current={active ? "page" : undefined}
      title={section.description}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg font-extrabold transition",
        variant === "chip"
          ? "h-9 px-3 text-[12.5px]"
          : "h-9 w-full px-2.5 text-[12.5px]",
        active
          ? "bg-navy text-on-brand"
          : "text-muted hover:bg-line-2 hover:text-ink",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {section.label}
    </Link>
  );
}

/** The sections this session may see — nothing is shown it cannot open. */
export function sectionListFor(access: AdminAccess) {
  return ADMIN_SECTIONS.filter((section) => {
    const needsContent =
      section.id === "templates" ||
      section.id === "studio" ||
      section.id === "import" ||
      section.id === "content" ||
      section.id === "assets" ||
      section.id === "branding" ||
      section.id === "categories" ||
      section.id === "sharing" ||
      section.id === "ai";
    return needsContent ? access.content : access.commercial;
  });
}

/**
 * The standard section frame: a titled masthead and one child.
 *
 * Every admin page opens by saying which section it is and what it manages, so
 * a deep link never lands the operator on an unlabeled panel.
 */
export function AdminSection({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 rounded-[14px] border border-line bg-surface px-5 py-4">
        <div className="min-w-0">
          <h1 className="text-[18px] font-extrabold text-ink">{title}</h1>
          <p className="mt-1 max-w-3xl text-[12px] leading-6 text-muted">{description}</p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/**
 * Renders a section only for a session holding that authority; otherwise the
 * section says which authority it needs instead of showing an empty panel.
 */
export function AdminGate({
  need,
  children,
}: {
  need: "content" | "commercial";
  children: ReactNode;
}) {
  const access = useAdminAccess();
  const allowed = need === "content" ? access.content : access.commercial;
  if (!allowed) return <AdminSectionDenied need={need} />;
  return <>{children}</>;
}

/** Rendered when a session may open the console but not this authority. */
export function AdminSectionDenied({ need }: { need: "content" | "commercial" }) {
  return (
    <section className="rounded-[14px] border border-gold/50 bg-gold/10 p-6">
      <h2 className="text-[15px] font-extrabold text-ink">هذا القسم يتطلب صلاحية أخرى</h2>
      <p className="mt-2 max-w-2xl text-[12.5px] leading-6 text-muted">
        {need === "content"
          ? "إدارة القوالب والمحتوى متاحة لحساب المالك الموثّق. يمكنك استخدام أقسام التشغيل والتراخيص من هذه اللوحة."
          : "إدارة العملاء والمدفوعات والباقات متاحة لمسؤول المنصة. يمكنك استخدام أقسام القوالب والمحتوى من هذه اللوحة."}
      </p>
    </section>
  );
}
