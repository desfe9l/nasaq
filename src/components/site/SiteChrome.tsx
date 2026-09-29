import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, FilePlus2, KeyRound, LogIn, LogOut, Menu, Moon, Sun, UserRound, X } from "lucide-react";
import { ThemedToaster } from "@/components/ui/ThemedToaster";
import {
  BRAND,
  NAV_ITEMS,
  PRIMARY_NAV_ITEMS,
  SECONDARY_NAV_ITEMS,
  WHATSAPP_MESSAGES,
  whatsappHref,
} from "@/lib/brand";
import { SocialLinks } from "@/components/site/SocialLinks";
import { readStoredTheme, writeStoredTheme, subscribeTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useSiteSettings } from "@/lib/admin/use-site-settings";
import { authEnabled, signOut } from "@/lib/auth/client";
import { useCurrentUserState, type AppUser } from "@/lib/auth/use-current-user";
import { accountIdentity } from "@/lib/auth/identity";
import { useEditorEntry } from "@/lib/auth/use-editor-entry";
import {
  WORKSPACE_HOME_PATH,
  openNewDocumentFlow,
  useWorkspaceEntry,
} from "@/lib/auth/use-workspace-entry";
import { AccountAvatar } from "./AccountAvatar";
import { AccountBadge, useAccountTier } from "./AccountBadge";
import {
  AccountMenuPanel,
  accountMenuItemClass,
  accountMenuItemMutedClass,
  useAccountMenuPlacement,
} from "./AccountMenuPanel";

/**
 * The editor call-to-action in the site chrome.
 *
 * A signed-in account walks straight into the editor — licensed, trial, expired,
 * revoked or registered without a licence alike. What that account may use is
 * settled inside the editor by the server-resolved entitlements, never by the
 * link that leads there, so nobody with an account is asked to "try" a product
 * they already signed up for. Only a visitor with no session is routed through
 * the limited `/demo` page.
 */
function EditorEntryLink({ variant = "header" }: { variant?: "header" | "mobile" }) {
  const { entry } = useEditorEntry();
  const workspace = useWorkspaceEntry();
  // Nothing until the session resolves, exactly like `HeaderAccount`: a
  // signed-in author must never see the demo wording flash first.
  if (!entry.ready) return null;
  // A licensed account starts from its Home (`/home`), so the door waits for
  // the server's licence answer instead of flashing «افتح المحرر» first.
  if (entry.direct && !workspace.ready) return null;
  const href = workspace.licensed ? WORKSPACE_HOME_PATH : entry.href;
  const label = workspace.licensed ? "مساحة العمل" : entry.label;
  return (
    <a
      href={href}
      className={cn(
        variant === "header"
          ? "hidden h-9 items-center whitespace-nowrap rounded-[8px] border border-brand px-3 text-[12px] font-extrabold text-brand lg:inline-flex"
          : "block rounded-[8px] px-3 py-2.5 text-[13px] font-bold text-muted lg:hidden",
      )}
    >
      {label}
    </a>
  );
}

/**
 * «مستند جديد» — the licensed author's fast path into a blank document.
 *
 * Rendered only while the account holds an ACTIVE licence (administrators
 * included): the licence state is the server's (`useAccountTier` →
 * `getLicenseStatusFn`), never the browser's, and the click opens the
 * «إنشاء مستند جديد» configuration on the licensed Home (`openNewDocumentFlow`).
 * Registered accounts without a licence keep «افتح المحرر» and the free-tier
 * restrictions; this shortcut simply does not appear for them.
 */
function NewDocumentButton({ variant = "header" }: { variant?: "header" | "mobile" }) {
  const { user, isPending } = useCurrentUserState();
  if (!authEnabled || isPending || !user) return null;
  return <NewDocumentForUser user={user} variant={variant} />;
}

/** Own component so `useAccountTier` only mounts for a real signed-in session. */
function NewDocumentForUser({
  user,
  variant,
}: {
  user: AppUser;
  variant: "header" | "mobile";
}) {
  const tier = useAccountTier(user);
  const { entry } = useEditorEntry();
  // Nothing until the session AND the licence state resolve — exactly like
  // `EditorEntryLink`, a licensed author must not see the button flash late.
  if (!entry.ready || !entry.direct) return null;
  if (tier !== "LICENSED" && tier !== "ADMIN") return null;
  return (
    <button
      type="button"
      // Always through the configuration step on Home — never a silent blank.
      onClick={() => openNewDocumentFlow()}
      title="مستند جديد"
      className={cn(
        variant === "header"
          ? "hidden h-9 items-center gap-1.5 whitespace-nowrap rounded-[8px] bg-navy px-3 text-[12px] font-extrabold text-on-brand transition hover:bg-navy-2 lg:inline-flex"
          : "mt-1 flex w-full items-center gap-2 rounded-[8px] px-3 py-2.5 text-[13px] font-bold text-muted lg:hidden",
      )}
    >
      <FilePlus2 className="size-4" aria-hidden />
      مستند جديد
    </button>
  );
}

/**
 * «مرخص» / «مجاني» badge for the signed-in account.
 *
 * Its own component so `useAccountTier` (→ `useLicense`) mounts only once a real
 * user is on screen: the hook must be called unconditionally, and the signed-out
 * branch of `HeaderAccount` returns before that point.
 */
function SignedInBadge({ user }: { user: AppUser }) {
  const tier = useAccountTier(user);
  return <AccountBadge tier={tier} />;
}

/**
 * «تسجيل الدخول / إنشاء حساب» and the signed-in identity chip.
 *
 * One entry point for the whole site chrome, driven by the existing Better Auth
 * session (`useCurrentUserState`). While the session resolves it renders nothing
 * so a signed-in visitor never sees a sign-in flash on reload. Editing does not
 * require an account — only exporting does (see `SignInRequiredModal`).
 */
function HeaderAccount({ variant = "header" }: { variant?: "header" | "mobile" }) {
  const { user, isPending } = useCurrentUserState();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { placement, place, reset } = useAccountMenuPlacement({ triggerRef: buttonRef });

  /** Closing forgets the measurement too, so a stale card can never reopen. */
  const closeMenu = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    /*
     * Outside clicks fall THROUGH to whatever they landed on — no scrim stands
     * between the visitor and the page — which is why this is a window listener
     * rather than a full-screen layer.
     */
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, closeMenu]);

  if (!authEnabled || isPending) return null;

  if (!user) {
    return (
      <a
        href="/login"
        className={cn(
          "items-center gap-1.5 rounded-[8px] border border-line px-3 font-bold text-ink transition hover:border-brand hover:text-brand-hover",
          variant === "header"
            ? "inline-flex h-9 max-w-[150px] items-center px-2 text-[11px] sm:px-3 sm:text-[12px] lg:max-w-none"
            : "mt-1 flex w-full px-3 py-2.5 text-[13px]",
        )}
      >
        <LogIn className="size-4" aria-hidden />
        <span className="truncate">
          تسجيل الدخول / إنشاء حساب
        </span>
      </a>
    );
  }

  // Resolved by the shared identity helper, so this chip and the editor's
  // account area always print the same name for the same session.
  const { label } = accountIdentity(user);
  const avatar = <AccountAvatar user={user} size={24} />;

  /** Measure first, then open: the card's first paint is already placed. */
  const openMenu = () => {
    if (!place()) return;
    setOpen(true);
  };

  /*
   * The card's actions. They are the same rows on both layouts; only the way the
   * card is placed differs (floating portal in the header, in the flow inside
   * the collapsed nav).
   */
  const items = (
    <>
      <a href="/account#settings" role="menuitem" className={accountMenuItemClass}>
        <UserRound className="size-4 opacity-70" aria-hidden />
        الحساب والإعدادات
      </a>
      <a href="/license" role="menuitem" className={accountMenuItemClass}>
        <KeyRound className="size-4 opacity-70" aria-hidden />
        ترخيصي وتفعيله
      </a>
      <button
        type="button"
        role="menuitem"
        disabled={signingOut}
        onClick={() => {
          setSigningOut(true);
          void signOut("/").catch(() => setSigningOut(false));
        }}
        className={accountMenuItemMutedClass}
      >
        <LogOut className="size-4 opacity-70" aria-hidden />
        {signingOut ? "جارٍ الخروج…" : "تسجيل الخروج"}
      </button>
    </>
  );

  return (
    <div className={cn("relative", variant === "mobile" && "mt-1 w-full")}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          if (open) closeMenu();
          else openMenu();
        }}
        className={cn(
          "flex items-center gap-2 rounded-[8px] border border-line bg-surface/60 font-bold transition hover:border-brand",
          variant === "header" ? "h-9 px-2 text-[12px]" : "w-full px-3 py-2 text-[13px]",
        )}
      >
        {avatar}
        {/*
         * The account identity block: the FULL name (never truncated mid-word
         * by a 140px cap — it collapses with `truncate` only when the chrome
         * genuinely runs out of room) plus the licence-state badge.
         */}
        <span className="flex min-w-0 flex-col items-start leading-tight">
          <span
            className={cn(
              "max-w-[180px] truncate text-[12px] font-extrabold",
              variant === "header" && "hidden lg:inline",
            )}
            title={label}
          >
            {label}
          </span>
          <SignedInBadge user={user} />
        </span>
        <ChevronDown className="size-3.5 opacity-70" aria-hidden />
      </button>

      {open &&
        variant === "header" &&
        placement &&
        createPortal(
          /*
           * The floating card: `absolute` inside a full-viewport fixed layer, so
           * the header's stacking context or a scroll container can never clip
           * it. The placement is measured from the HEADER's bottom edge (not the
           * chip's), which is what keeps the card clear of the toolbar and its
           * buttons instead of starting inside the bar. `pointer-events-none`
           * lets an outside click fall through to the page beneath (the window
           * listener above closes the card).
           */
          <div className="pointer-events-none fixed inset-0 z-[var(--z-dropdown)]">
            <AccountMenuPanel
              user={user}
              label="قائمة الحساب"
              className="account-menu-panel-floating"
              style={{
                insetInlineEnd: placement.insetInlineEnd,
                top: placement.top,
                maxWidth: placement.maxWidth,
                maxHeight: placement.maxHeight,
              }}
            >
              {items}
            </AccountMenuPanel>
          </div>,
          document.body,
        )}

      {/*
       * The collapsed nav's copy stays in the flow: there the card is part of
       * the opened sheet, so it has nothing to float above.
       */}
      {open && variant === "mobile" && (
        <AccountMenuPanel user={user} label="قائمة الحساب" className="account-menu-panel-inline">
          {items}
        </AccountMenuPanel>
      )}
    </div>
  );
}

/** Admin-managed announcement bar (/admin → محتوى الموقع). */
function AnnouncementBar() {
  const { announcement } = useSiteSettings();
  if (!announcement.enabled || !announcement.text.trim()) return null;
  const tone =
    announcement.tone === "warning"
      ? "bg-gold/15 text-warning"
      : announcement.tone === "success"
        ? "bg-navy text-on-brand"
        : "bg-navy text-on-brand";
  const body = <span className="font-bold">{announcement.text}</span>;
  return (
    <div className={cn("px-4 py-2 text-center text-[12px]", tone)} role="region" aria-label="إعلان">
      {announcement.href ? (
        <a href={announcement.href} className="underline-offset-4 hover:underline">
          {body}
        </a>
      ) : (
        body
      )}
    </div>
  );
}

export function SiteHeader({ current }: { current: string }) {
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Initialised from the shared preference; the root-level theme module has
  // already applied the class before any route renders, so this never
  // disagrees with what is on screen.
  const [dark, setDark] = useState(() => readStoredTheme() ?? false);
  useEffect(() => subscribeTheme(setDark), []);

  useEffect(() => {
    setOpen(false);
    setMoreOpen(false);
  }, [current]);

  useEffect(() => {
    if (!moreOpen) return;
    const close = () => setMoreOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [moreOpen]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    writeStoredTheme(next);
  };

  return (
    /*
     * Site-wide toast host. The editor mounts its own inside EditorApp, so
     * putting one here (every marketing/site page renders SiteHeader) gives
     * those pages live feedback — imports, saves, clipboard — without ever
     * doubling up on /editor.
     */
    <>
    <ThemedToaster position="top-center" richColors dir="rtl" />
    <AnnouncementBar />
    {/*
     * Glassmorphic sticky nav.
     *
     * `backdrop-filter: blur(12px)` over a translucent surface keeps the page
     * visible through the bar as it scrolls, while the hairline bottom border +
     * `shadow-sm` keep a crisp edge against the content underneath (without them
     * a blurred bar smears into the page it is floating over).
     */}
    <header className="sticky top-0 z-40 border-b border-line bg-page">
      <div className="mx-auto grid min-h-16 w-full max-w-7xl grid-cols-[auto_1fr] items-center gap-x-3 px-4 sm:gap-x-4 sm:px-6 lg:flex">
        <a href="/" className="flex shrink-0 items-center gap-2.5">
          <BrandLogo />
        </a>

        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 lg:flex" aria-label="الروابط الرئيسية">
          {PRIMARY_NAV_ITEMS.map((item) => (
            <a
              key={item.to}
              href={item.to}
              className={cn(
 "whitespace-nowrap rounded-[8px] px-2.5 py-2 text-[12px] font-bold transition xl:text-[13px]",
                current === item.to
                  ? "bg-navy text-on-brand"
                  : "text-muted hover:bg-line-2 hover:text-ink",
              )}
            >
              {item.label}
            </a>
          ))}
          <div className="relative">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setMoreOpen((value) => !value);
              }}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              className="flex h-9 items-center gap-1 whitespace-nowrap rounded-[8px] px-2.5 text-[12px] font-bold text-muted transition hover:bg-line-2 hover:text-ink xl:text-[13px]"
            >
              المزيد
              <ChevronDown className={cn("size-3.5 transition", moreOpen && "rotate-180")} aria-hidden />
            </button>
            {moreOpen && (
              <div
                role="menu"
                className="absolute end-0 top-11 z-50 grid w-52 gap-1 rounded-[10px] border border-line bg-surface p-1.5 shadow-xl"
              >
                {SECONDARY_NAV_ITEMS.map((item) => (
                  <a
                    key={item.to}
                    href={item.to}
                    role="menuitem"
                    className={cn(
 "whitespace-nowrap rounded-[8px] px-3 py-2.5 text-[12px] font-bold transition",
                      current === item.to
                        ? "bg-navy text-on-brand"
                        : "text-muted hover:bg-line-2 hover:text-ink",
                    )}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </nav>

        <div className="flex items-center justify-end gap-1.5 sm:gap-2">
          {/* Light/Dark is the visitor's choice: one toggle, applied site-wide
              and persisted (lib/theme.ts), so every page loads on the same
              mode instead of each page forcing its own. */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={dark}
            aria-label={dark ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن"}
            title={dark ? "الوضع الفاتح" : "الوضع الداكن"}
            className="grid size-9 place-items-center rounded-[8px] border border-line"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <a
            href={whatsappHref(WHATSAPP_MESSAGES.support)}
            className="hidden h-9 items-center gap-2 whitespace-nowrap rounded-[8px] border border-line px-3 text-[12px] font-bold xl:inline-flex"
          >
            <span className="tabular-nums" dir="rtl">
              تواصل عبر واتساب
            </span>
          </a>
          <NewDocumentButton />
          <EditorEntryLink />
          <HeaderAccount />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="القائمة"
            className="grid size-9 place-items-center rounded-[8px] border border-line lg:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-line px-4 pb-3 lg:hidden">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.to}
              href={item.to}
              className={cn(
 "block rounded-[8px] px-3 py-2.5 text-[13px] font-bold",
                current === item.to ? "bg-navy text-on-brand" : "text-muted",
              )}
            >
              {item.label}
            </a>
          ))}
          <EditorEntryLink variant="mobile" />
          <NewDocumentButton variant="mobile" />
          <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={dark}
            className="mt-1 flex w-full items-center gap-2 rounded-[8px] px-3 py-2.5 text-[13px] font-bold text-muted"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {dark ? "الوضع الفاتح" : "الوضع الداكن"}
          </button>
          <HeaderAccount variant="mobile" />
        </nav>
      )}
    </header>
    </>
  );
}

export function SiteFooter() {
  const { texts } = useSiteSettings();
  return (
    <footer className="border-t border-line/60 bg-page">
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:grid-cols-2 sm:px-6 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-2.5">
            <BrandLogo compact />
          </div>
          <p className="mt-3 text-[12px] leading-6 text-muted">{BRAND.tagline}</p>
          <p className="mt-2 text-[11px] leading-5 text-muted">
            تُطوَّر وتُدار بواسطة {BRAND.team}
          </p>
          {/* Official accounts, next to the NASAQ badge — icon-only so the
              column keeps its weight on every breakpoint. */}
          <SocialLinks className="mt-2" />
        </div>
        <div>
          <h3 className="mb-2 text-[12px] font-extrabold text-muted">روابط</h3>
          <ul className="grid gap-1.5">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <a href={item.to} className="text-[13px] font-bold hover:text-brand-hover">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-[12px] font-extrabold text-muted">التواصل</h3>
          <a
            href={whatsappHref(WHATSAPP_MESSAGES.footer)}
            className="inline-flex h-9 items-center rounded-[8px] border border-line px-3 text-[13px] font-bold tabular-nums"
            dir="rtl"
          >
            تواصل عبر واتساب
          </a>
          <p className="mt-3 text-[11px] leading-5 text-muted">
            {texts.footerNote.trim() || "تُحفظ المشاريع في متصفحك وتُصدَّر محليًا، مع اتصال عند الحاجة للترخيص أو الذكاء الاصطناعي."}
          </p>
        </div>
      </div>
      {/*
       * Legal line. The lockup prints once — `نَسَق` carries `NASAQ` inside
       * `BrandLockup`, so printing `BRAND.platform` again would duplicate it.
       */}
      <div className="border-t border-line/60 px-4 py-4">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[11px] text-muted sm:justify-between">
          <span>
            © {new Date().getFullYear()} <BrandLockup />
          </span>
          {/* Designer signature: small, elegant, part of the footer identity —
              never competing with the platform name. */}
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-px bg-line" />
            بواسطة <strong className="font-extrabold text-ink">{BRAND.team}</strong>
          </span>
        </div>
      </div>
    </footer>
  );
}

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="نَسَق | NASAQ">
      {/*
       * Dark-mode swap: the mark's dark fills (#063b35/#1a1a1a) vanish on the
       * dark chrome, so the dark theme loads the light-fill variant of the
       * SAME artwork (only the <style> fills differ — geometry is untouched).
       * Both files are always fetched from the same origin; the swap is pure
       * CSS, no JS, and the light variant keeps its original colors.
       */}
      <img
        src="/nasaq-mark.svg"
        alt=""
        aria-hidden
        className={cn(compact ? "size-8 shrink-0" : "size-9 shrink-0", "dark:hidden")}
      />
      <img
        src="/nasaq-mark-inv.svg"
        alt=""
        aria-hidden
        className={cn(compact ? "size-8 shrink-0" : "size-9 shrink-0", "hidden dark:block")}
      />
      <span className="grid leading-none">
        <strong className={compact ? "text-[14px] font-extrabold" : "text-[15px] font-extrabold"}>نَسَق</strong>
        <span className="mt-1 text-[8px] font-bold tracking-[0.16em] text-muted" dir="ltr">NASAQ</span>
      </span>
    </span>
  );
}

/**
 * Text-only bilingual lockup for tight rows (legal lines, signatures).
 * Renders `نَسَق | NASAQ` once — never repeated with a second copy of the name.
 */
export function BrandLockup() {
  return (
    <span className="inline-flex items-baseline gap-1.5 font-extrabold text-ink">
      <span>نَسَق</span>
      <span aria-hidden className="text-muted">|</span>
      <span className="text-[10px] tracking-[0.16em] text-muted" dir="ltr">NASAQ</span>
    </span>
  );
}
