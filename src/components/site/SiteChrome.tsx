import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { BRAND, CONTACT_PHONE_DISPLAY, NAV_ITEMS, telHref } from "@/lib/brand";
import { cn } from "@/lib/utils";

export function SiteHeader({ current }: { current: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [current]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur dark:border-white/10 dark:bg-[#111722]/95">
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
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-white dark:border-white/10 dark:bg-[#111722]">
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 sm:grid-cols-2 md:grid-cols-3">
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
            جميع الملفات تُحفظ في متصفحك وتُصدَّر محليًا، فلا تُرفع إلى أي سيرفر.
          </p>
        </div>
      </div>
      {/*
       * Legal line. The lockup prints once — `نَسَق` carries `NASAQ` inside
       * `BrandLockup`, so printing `BRAND.platform` again would duplicate it.
       */}
      <div className="border-t border-line px-4 py-4 dark:border-white/10">
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