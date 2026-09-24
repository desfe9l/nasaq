import { useEffect, useState } from "react";
import { Menu, Moon, Sun, X, LogIn, User } from "lucide-react";
import { Toaster } from "sonner";
import { BRAND, CONTACT_PHONE_DISPLAY, NAV_ITEMS, telHref } from "@/lib/brand";
import { readStoredTheme, writeStoredTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useSiteSettings } from "@/lib/admin/use-site-settings";
import { authEnabled, signIn, signOut, GOOGLE_PROVIDER_ID, SOCIAL_PROVIDERS } from "@/lib/auth/client";
import { useCurrentUser, useCurrentUserState } from "@/lib/auth/use-current-user";

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
  // Initialised from the shared preference; the root-level theme module has
  // already applied the class before any route renders, so this never
  // disagrees with what is on screen.
  const [dark, setDark] = useState(() => readStoredTheme() ?? false);
  const { user, isPending } = useCurrentUserState();

  useEffect(() => {
    setOpen(false);
  }, [current]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    writeStoredTheme(next);
  };

  const handleGoogleSignIn = async () => {
    await signIn(GOOGLE_PROVIDER_ID, { callbackURL: "/account", errorCallbackURL: "/login?oauth=error" });
  };

  const handleSignOut = async () => {
    await signOut("/");
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
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2.5">
          <BrandLogo />
        </a>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.to}
              href={item.to}
              className={cn(
                "rounded-[8px] px-3 py-2 text-[13px] font-bold transition",
                current === item.to
                  ? "bg-navy text-white"
                  : "text-muted hover:bg-line-2 hover:text-ink dark:hover:bg-white/5 dark:hover:text-white",
              )}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
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
            className="hidden h-9 items-center gap-2 rounded-[8px] border border-line px-3 text-[12px] font-bold sm:inline-flex dark:border-white/10"
          >
            <span className="tabular-nums" dir="ltr">
              {CONTACT_PHONE_DISPLAY}
            </span>
          </a>
          <a
            href="/demo"
            className="inline-flex h-9 items-center rounded-[8px] bg-navy px-3 text-[12px] font-extrabold text-white"
          >
            العرض التجريبي
          </a>

          {/* Auth state: sign-in button or user menu */}
          {isPending ? (
            <div className="grid size-9 place-items-center" aria-hidden="true">
              <span className="h-2 w-2 animate-pulse rounded-full bg-muted" />
            </div>
          ) : user ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-line px-3 text-[12px] font-bold transition hover:bg-line-2 dark:border-white/10 dark:hover:bg-white/5"
              >
                {user.profileImageUrl ? (
                  <img src={user.profileImageUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                ) : (
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-navy/10 text-[11px] font-extrabold text-navy-2 dark:bg-white/20 dark:text-white">
                    {(user.displayName ?? user.primaryEmail ?? "م").charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="hidden sm:inline max-w-[140px] truncate">
                  {user.displayName ?? user.primaryEmail ?? "حساب"}
                </span>
              </button>
            </div>
          ) : authEnabled ? (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-navy px-3 text-[12px] font-extrabold text-white transition hover:bg-navy-2"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" role="img">
                <path fill="#4285F4" d="M21.35 12.27c0-.7-.06-1.37-.18-2.02H12v3.83h5.23a4.47 4.47 0 0 1-1.94 2.93v2.44h3.14c1.84-1.7 2.92-4.2 2.92-7.18Z" />
                <path fill="#34A853" d="M12 21.6c2.63 0 4.84-.87 6.45-2.35l-3.14-2.44c-.87.58-1.98.92-3.31.92-2.54 0-4.7-1.72-5.47-4.04H3.28v2.52A9.74 9.74 0 0 0 12 21.6Z" />
                <path fill="#FBBC05" d="M6.53 13.69a5.86 5.86 0 0 1 0-3.38V7.79H3.28a9.74 9.74 0 0 0 0 8.42l3.25-2.52Z" />
                <path fill="#EA4335" d="M12 6.27c1.43 0 2.72.49 3.73 1.45l2.8-2.8C16.84 3.39 14.63 2.4 12 2.4a9.74 9.74 0 0 0-8.72 5.39l3.25 2.52C7.3 7.99 9.46 6.27 12 6.27Z" />
              </svg>
              <span>تسجيل الدخول</span>
            </button>
          ) : null}

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
          <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={dark}
            className="mt-1 flex w-full items-center gap-2 rounded-[8px] px-3 py-2.5 text-[13px] font-bold text-muted"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {dark ? "الوضع الفاتح" : "الوضع الداكن"}
          </button>
          {!isPending && !user && authEnabled && (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-[8px] bg-navy px-3 py-2.5 text-[13px] font-extrabold text-white"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" role="img">
                <path fill="#4285F4" d="M21.35 12.27c0-.7-.06-1.37-.18-2.02H12v3.83h5.23a4.47 4.47 0 0 1-1.94 2.93v2.44h3.14c1.84-1.7 2.92-4.2 2.92-7.18Z" />
                <path fill="#34A853" d="M12 21.6c2.63 0 4.84-.87 6.45-2.35l-3.14-2.44c-.87.58-1.98.92-3.31.92-2.54 0-4.7-1.72-5.47-4.04H3.28v2.52A9.74 9.74 0 0 0 12 21.6Z" />
                <path fill="#FBBC05" d="M6.53 13.69a5.86 5.86 0 0 1 0-3.38V7.79H3.28a9.74 9.74 0 0 0 0 8.42l3.25-2.52Z" />
                <path fill="#EA4335" d="M12 6.27c1.43 0 2.72.49 3.73 1.45l2.8-2.8C16.84 3.39 14.63 2.4 12 2.4a9.74 9.74 0 0 0-8.72 5.39l3.25 2.52C7.3 7.99 9.46 6.27 12 6.27Z" />
              </svg>
              تسجيل الدخول
            </button>
          )}
          {!isPending && user && (
            <button
              type="button"
              onClick={handleSignOut}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-[8px] border border-line px-3 py-2.5 text-[13px] font-bold text-muted"
            >
              <LogIn className="size-4" />
              تسجيل الخروج
            </button>
          )}
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
            من تطوير {BRAND.owner}
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
            المصمم والمطور <strong className="font-extrabold text-ink dark:text-white">{BRAND.developer}</strong>
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
