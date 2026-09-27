import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  FilePlus2,
  KeyRound,
  LogIn,
  LogOut,
  Settings2,
  UserRound,
} from "lucide-react";
import { authEnabled, signOut } from "@/lib/auth/client";
import { useCurrentUserState, type AppUser } from "@/lib/auth/use-current-user";
import { accountIdentity } from "@/lib/auth/identity";
import { AccountAvatar } from "@/components/site/AccountAvatar";
import { AccountBadge, useAccountTier } from "@/components/site/AccountBadge";
import { cn } from "@/lib/utils";
import { OPEN_EDITOR_SETTINGS_EVENT } from "@/lib/editor/ui-state";
import { NewDocumentDialog } from "@/components/site/NewDocumentDialog";

/**
 * The editor's account area: who is signed in, and the door to their settings.
 *
 * Identity comes from the verified session (`useCurrentUserState` → Better
 * Auth) through the same resolver the site chrome uses (`accountIdentity`), so
 * the editor and the account area can never name the same person differently.
 * Licence state is the server's too — `useAccountTier` → `getLicenseStatusFn` —
 * and is displayed, never decided, here.
 *
 * Deliberately compact: an avatar plus the account name. The toolbar is one
 * line at every width, so the licence badge and the full identity live in the
 * menu that opens from it rather than in the strip itself.
 */

const MENU_WIDTH = 252;

/**
 * The licence badge for a signed-in account.
 *
 * Its own component so `useAccountTier` (→ `useLicense`) only mounts while the
 * menu is open: the hook has to be called unconditionally, and the collapsed
 * chip does not need a status round trip on every editor load.
 */
function MenuBadge({ user }: { user: AppUser }) {
  const tier = useAccountTier(user);
  return <AccountBadge tier={tier} />;
}

/**
 * «مستند جديد» — opens the new-document configuration without leaving the
 * workspace (the same dialog the licensed Home uses).
 *
 * Licensed accounts only (administrators included): the tier is the server's
 * (`useAccountTier` → `getLicenseStatusFn`), and the store's own entitlement
 * ceiling still applies underneath (`createDocument`), so the item can never
 * widen free-tier access. Its own component so `useAccountTier` mounts only
 * while the menu is open for a real session, exactly like `MenuBadge`.
 */
function NewDocumentMenuItem({
  user,
  className,
  onRequest,
}: {
  user: AppUser;
  className: string;
  onRequest: () => void;
}) {
  const tier = useAccountTier(user);
  if (tier !== "LICENSED" && tier !== "ADMIN") return null;
  return (
    <button type="button" role="menuitem" onClick={onRequest} className={className}>
      <FilePlus2 className="size-4 opacity-70" aria-hidden />
      مستند جديد
    </button>
  );
}

export function EditorAccountMenu() {
  const { user, isPending } = useCurrentUserState();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    // The toolbar strip scrolls horizontally, which would strand a menu that
    // stays anchored to where the chip used to be.
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  // Same rule as the site chrome: nothing renders until the session resolves,
  // so a signed-in author never sees a sign-in prompt flash on reload.
  if (!authEnabled || isPending) return null;

  /*
   * The divider travels with the control (rather than sitting in the toolbar)
   * so a header without an account area has no orphan separator in it.
   */
  const divider = (
    <span
      className="mx-0.5 h-6 w-px shrink-0 bg-line"
      aria-hidden
    />
  );

  if (!user) {
    return (
      <>
        {divider}
        <a
          href="/login"
          title="تسجيل الدخول / إنشاء حساب"
          aria-label="تسجيل الدخول / إنشاء حساب"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] border border-line px-2 text-[12px] font-extrabold transition hover:border-navy-2 hover:text-navy-2"
        >
          <LogIn className="size-4" aria-hidden />
        </a>
      </>
    );
  }

  const identity = accountIdentity(user);

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) {
      setOpen(true);
      return;
    }
    setAt({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8)),
      top: rect.bottom + 6,
    });
    setOpen(true);
  };

  const menuItem =
    "flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-start text-[12px] font-bold hover:bg-line-2";

  return (
    <>
      {divider}
      {/*
       * The chip: last item on the toolbar strip, so the account sits at the
       * far edge of the RTL header where it is expected and never between the
       * author and a tool.
       */}
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`حساب ${identity.label}`}
        onClick={openMenu}
        title={identity.label}
        className={cn(
          "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] border px-1.5 text-[12px] font-extrabold transition",
          open
            ? "border-navy-2 text-brand-hover"
            : "border-line hover:border-navy-2",
        )}
      >
        <AccountAvatar user={user} size={22} />
        <span className="hidden max-w-[128px] truncate md:inline">{identity.label}</span>
        <ChevronDown className="size-3.5 opacity-70" aria-hidden />
      </button>

      {open &&
        at &&
        createPortal(
          <div
            className="fixed inset-0 z-[var(--z-dropdown)]"
            onPointerDown={() => setOpen(false)}
            tabIndex={-1}
          >
            <div
              role="menu"
              aria-label="قائمة الحساب"
              onPointerDown={(e) => e.stopPropagation()}
              style={{ left: at.left, top: at.top, width: MENU_WIDTH }}
              className="absolute grid gap-1 rounded-[10px] border border-line bg-surface p-1.5 shadow-xl"
            >
              {/*
               * The identity block: the full name in the one place an author
               * goes to confirm WHICH account is editing, plus the licence
               * state the server resolved for it.
               */}
              <div className="border-b border-line px-3 pb-2.5 pt-1.5">
                <div className="flex items-center gap-2">
                  <AccountAvatar user={user} size={28} />
                  <div className="min-w-0">
                    <p
                      className="truncate text-[12px] font-extrabold"
                      title={identity.label}
                    >
                      {identity.label}
                    </p>
                    {identity.email && (
                      <p
                        className="truncate text-[10px] font-medium text-muted"
                        dir="ltr"
                        title={identity.email}
                      >
                        {identity.email}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-2">
                  <MenuBadge user={user} />
                </div>
              </div>

              <NewDocumentMenuItem
                user={user}
                className={menuItem}
                onRequest={() => {
                  setOpen(false);
                  setNewDocOpen(true);
                }}
              />
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                onClick={() => {
                  setOpen(false);
                  window.dispatchEvent(new CustomEvent(OPEN_EDITOR_SETTINGS_EVENT, { detail: "account" }));
                }}
              >
                <Settings2 className="size-4 opacity-70" aria-hidden />
                الإعدادات
              </button>
              <a href="/account" role="menuitem" className={menuItem}>
                <UserRound className="size-4 opacity-70" aria-hidden />
                حسابي والاشتراك
              </a>
              <a href="/license" role="menuitem" className={menuItem}>
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
                className={cn(
                  menuItem,
                  "text-muted disabled:cursor-wait disabled:opacity-60",
                )}
              >
                <LogOut className="size-4 opacity-70" aria-hidden />
                {signingOut ? "جارٍ الخروج…" : "تسجيل الخروج"}
              </button>
            </div>
          </div>,
          document.body,
        )}

      {/*
       * The store applies the new project in place — no navigation, no reload.
       * Portaled to <body>: the toolbar is its own stacking context, so a
       * dialog left inside it would sit under the side drawers on a tablet.
       */}
      {newDocOpen &&
        createPortal(
          <NewDocumentDialog
            submitLabel="إنشاء المستند"
            onClose={() => setNewDocOpen(false)}
            onCreated={() => setNewDocOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}
