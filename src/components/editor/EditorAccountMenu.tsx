import { useCallback, useEffect, useRef, useState } from "react";
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
import { useAccountTier } from "@/components/site/AccountBadge";
import {
  AccountMenuPanel,
  accountMenuItemClass,
  accountMenuItemMutedClass,
  useAccountMenuPlacement,
} from "@/components/site/AccountMenuPanel";
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
 * card that opens from it rather than in the strip itself. The card itself is
 * shared with the site chrome (`AccountMenuPanel`) — geometry included — and is
 * portalled to `<body>` and measured from the TOOLBAR's bottom edge, so a
 * wrapped toolbar row can never end up under the card.
 */

/**
 * «مستند جديد» — opens the new-document configuration without leaving the
 * workspace (the same dialog the licensed Home uses).
 *
 * Licensed accounts only (administrators included): the tier is the server's
 * (`useAccountTier` → `getLicenseStatusFn`), and the store's own entitlement
 * ceiling still applies underneath (`createDocument`), so the item can never
 * widen free-tier access. Its own component so `useAccountTier` mounts only
 * while the card is open for a real session.
 */
function NewDocumentMenuItem({ user, onRequest }: { user: AppUser; onRequest: () => void }) {
  const tier = useAccountTier(user);
  if (tier !== "LICENSED" && tier !== "ADMIN") return null;
  return (
    <button type="button" role="menuitem" onClick={onRequest} className={accountMenuItemClass}>
      <FilePlus2 className="size-4 opacity-70" aria-hidden />
      مستند جديد
    </button>
  );
}

export function EditorAccountMenu() {
  const { user, isPending } = useCurrentUserState();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { placement, place, reset } = useAccountMenuPlacement({ triggerRef: buttonRef });

  /** Closing forgets the measurement too, so a stale card can never reopen. */
  const closeMenu = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", closeMenu);
    // The toolbar strip scrolls horizontally, which would strand a menu that
    // stays anchored to where the chip used to be.
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [open, closeMenu]);

  // Same rule as the site chrome: nothing renders until the session resolves,
  // so a signed-in author never sees a sign-in prompt flash on reload.
  if (!authEnabled || isPending) return null;

  /*
   * The divider travels with the control (rather than sitting in the toolbar)
   * so a header without an account area has no orphan separator in it.
   */
  const divider = <span className="mx-0.5 h-6 w-px shrink-0 bg-line" aria-hidden />;

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

  /** Measure first, then open: the card's first paint is already placed. */
  const openMenu = () => {
    if (!place()) return;
    setOpen(true);
  };

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
        onClick={() => (open ? closeMenu() : openMenu())}
        title={identity.label}
        className={cn(
          "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] border px-1.5 text-[12px] font-extrabold transition",
          open ? "border-navy-2 text-brand-hover" : "border-line hover:border-navy-2",
        )}
      >
        <AccountAvatar user={user} size={22} />
        <span className="hidden max-w-[128px] truncate md:inline">{identity.label}</span>
        <ChevronDown className="size-3.5 opacity-70" aria-hidden />
      </button>

      {open &&
        placement &&
        createPortal(
          /*
           * The scrim-less layer: full-viewport, above the toolbar's own layer,
           * so the card floats free of the strip it came from. Pointer-down
           * outside the card closes it; the card swallows its own.
           */
          <div
            className="fixed inset-0 z-[var(--z-dropdown)]"
            onPointerDown={closeMenu}
            tabIndex={-1}
          >
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
              <NewDocumentMenuItem
                user={user}
                onRequest={() => {
                  closeMenu();
                  setNewDocOpen(true);
                }}
              />
              <button
                type="button"
                role="menuitem"
                className={accountMenuItemClass}
                onClick={() => {
                  closeMenu();
                  window.dispatchEvent(new CustomEvent(OPEN_EDITOR_SETTINGS_EVENT, { detail: "account" }));
                }}
              >
                <Settings2 className="size-4 opacity-70" aria-hidden />
                الإعدادات
              </button>
              <a href="/account" role="menuitem" className={accountMenuItemClass}>
                <UserRound className="size-4 opacity-70" aria-hidden />
                حسابي والاشتراك
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
            </AccountMenuPanel>
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
