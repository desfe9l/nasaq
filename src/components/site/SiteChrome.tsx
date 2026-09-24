import { useEffect, useState } from "react";
import { ChevronDown, LogIn, LogOut, Menu, Moon, Sun, UserRound, X } from "lucide-react";
import { Toaster } from "sonner";
import {
  BRAND,
  CONTACT_PHONE_DISPLAY,
  NAV_ITEMS,
  PRIMARY_NAV_ITEMS,
  SECONDARY_NAV_ITEMS,
  telHref,
} from "@/lib/brand";
import { readStoredTheme, writeStoredTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useSiteSettings } from "@/lib/admin/use-site-settings";
import { authEnabled, signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

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

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  if (!authEnabled || isPending) return null;

  if (!user) {
    return (
      <a
        href="/login"
        className={cn(
          "items-center gap-1.5 rounded-[8px] border border-line px-3 font-bold text-ink transition hover:border-navy-2 hover:text-navy-2 dark:border-white/15 dark:text-white dark:hover:border-gold-2 dark:hover:text-gold-2",
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

  const label = user.displayName ?? user.primaryEmail ?? "حسابي";
  const avatar = user.profileImageUrl ? (
    <img src={user.profileImageUrl} alt="" className="size-6 rounded-full object-cover" />
  ) : (
    <span className="grid size-6 place-items-center rounded-full bg-navy text-[10px] font-extrabold text-white">
      {label.charAt(0).toUpperCase()}
    </span>
  );

  return (
    <div className={cn("relative", variant === "mobile" && "mt-1 w-full")}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "flex items-center gap-2 rounded-[8px] border border-line bg-surface/60 font-bold transition hover:border-navy-2 dark:border-white/15 dark:bg-white/5",
          variant === "header" ? "h-9 px-2 text-[12px]" : "w-full px-3 py-2 text-[13px]",
        )}
      >
        {avatar}
        <span className={cn("max-w-[140px] truncate", variant === "header" && "hidden sm:inline")}>
          {label}
        </span>
        <ChevronDown className="size-3.5 opacity-70" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "z-50 grid w-52 gap-1 rounded-[10px] border border-line bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-[#161c26]",
            variant === "header" ? "absolute end-0 mt-1.5" : "mt-1.5",
          )}
        >
          <a
            href="/account#settings"
            role="menuitem"
            className="flex items-center gap-2 rounded-[8px] px-3 py-2 text-[12px] font-bold hover:bg-line-2 dark:hover:bg-white/5"
          >
            <UserRound className="size-4 opacity-70" aria-hidden />
            الحساب والإعدادات
          </a>
          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void signOut("/").catch(() => setSigningOut(false));
            }}
            className="flex items-center gap-2 rounded-[8px] px-3 py-2 text-right text-[12px] font-bold text-muted hover:bg-line-2 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-white/5"
          >
            <LogOut className="size-4 opacity-70" aria-hidden />
            {signingOut ? "جارٍ الخروج…" : "تسجيل الخروج"}
          </button>
        </div>
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
      ? "bg-amber-500/15 text-amber-900 dark:text-amber-200"
      : announcement.tone === "success"
        ? "bg-emerald-600 text-white"
        : "bg-navy text-white";
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
    <Toaster position="top-center" richColors dir="rtl" />
    <AnnouncementBar />
    {/*
     * Glassmorphic sticky nav.
     *
     * `backdrop-filter: blur(12px)` over a translucent surface keeps the page
     * visible through the bar as it scrolls, while the hairline bottom border +
     * `shadow-sm` keep a crisp edge against the content underneath (without them
     * a blurred bar smears into the page it is floating over).
     */}
    <header className="sticky top-0 z-40 border-b border-line/60 bg-white/80 shadow-sm backdrop-blur-[12px] dark:border-white/10 dark:bg-[#111722]/80">
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
                  ? "bg-navy text-white"
                  : "text-muted hover:bg-line-2 hover:text-ink dark:hover:bg-white/5 dark:hover:text-white",
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
              className="flex h-9 items-center gap-1 whitespace-nowrap rounded-[8px] px-2.5 text-[12px] font-bold text-muted transition hover:bg-line-2 hover:text-ink dark:hover:bg-white/5 dark:hover:text-white xl:text-[13px]"
            >
              المزيد
              <ChevronDown className={cn("size-3.5 transition", moreOpen && "rotate-180")} aria-hidden />
            </button>
            {moreOpen && (
              <div
                role="menu"
                className="absolute end-0 top-11 z-50 grid w-52 gap-1 rounded-[10px] border border-line bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-[#161c26]"
              >
                {SECONDARY_NAV_ITEMS.map((item) => (
                  <a
                    key={item.to}
                    href={item.to}
                    role="menuitem"
                    className={cn(
                      "whitespace-nowrap rounded-[8px] px-3 py-2.5 text-[12px] font-bold transition",
                      current === item.to
                        ? "bg-navy text-white"
                        : "text-muted hover:bg-line-2 hover:text-ink dark:hover:bg-white/5 dark:hover:text-white",
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
            className="grid size-9 place-items-center rounded-[8px] border border-line dark:border-white/10"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <a
            href={telHref()}
            className="hidden h-9 items-center gap-2 whitespace-nowrap rounded-[8px] border border-line px-3 text-[12px] font-bold xl:inline-flex dark:border-white/10"
          >
            <span className="tabular-nums" dir="ltr">
              {CONTACT_PHONE_DISPLAY}
            </span>
          </a>
          <a
            href="/demo"
            className="hidden h-9 items-center whitespace-nowrap rounded-[8px] border border-navy px-3 text-[12px] font-extrabold text-navy lg:inline-flex dark:text-white"
          >
            العرض التجريبي
          </a>
          <HeaderAccount />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="القائمة"
            className="grid size-9 place-items-center rounded-[8px] border border-line lg:hidden dark:border-white/10"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-line px-4 pb-3 lg:hidden dark:border-white/10">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.to}
              href={item.to}
              className={cn(
                "block rounded-[8px] px-3 py-2.5 text-[13px] font-bold",
                current === item.to ? "bg-navy text-white" : "text-muted",
              )}
            >
              {item.label}
            </a>
          ))}
          <a
            href="/demo"
            className="block rounded-[8px] px-3 py-2.5 text-[13px] font-bold text-muted lg:hidden"
          >
            العرض التجريبي
          </a>
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
    <footer className="border-t border-line/60 bg-white dark:border-white/10 dark:bg-[#111722]">
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-12 sm:grid-cols-2 sm:px-6 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-2.5">
            <BrandLogo compact />
          </div>
          <p className="mt-3 text-[12px] leading-6 text-muted">{BRAND.tagline}</p>
          <p className="mt-2 text-[11px] leading-5 text-muted">
            تُطوَّر وتُدار بواسطة {BRAND.team}
          </p>
        </div>
        <div>
          <h3 className="mb-2 text-[12px] font-extrabold text-muted">روابط</h3>
          <ul className="grid gap-1.5">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <a href={item.to} className="text-[13px] font-bold hover:text-navy-2">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-[12px] font-extrabold text-muted">التواصل</h3>
          <a
            href={telHref()}
            className="inline-flex h-9 items-center rounded-[8px] border border-line px-3 text-[13px] font-bold tabular-nums dark:border-white/10"
            dir="ltr"
          >
            {CONTACT_PHONE_DISPLAY}
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
      <div className="border-t border-line/60 px-4 py-4 dark:border-white/10">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[11px] text-muted sm:justify-between">
          <span>
            © {new Date().getFullYear()} <BrandLockup />
          </span>
          {/* Designer signature: small, elegant, part of the footer identity —
              never competing with the platform name. */}
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-px bg-line dark:bg-white/15" />
            بواسطة <strong className="font-extrabold text-ink dark:text-white">{BRAND.team}</strong>
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
    <span className="inline-flex items-baseline gap-1.5 font-extrabold text-ink dark:text-white">
      <span>نَسَق</span>
      <span aria-hidden className="text-muted">|</span>
      <span className="text-[10px] tracking-[0.16em] text-muted" dir="ltr">NASAQ</span>
    </span>
  );
}
