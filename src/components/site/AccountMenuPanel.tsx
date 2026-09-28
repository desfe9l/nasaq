import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ACCOUNT_MENU_BAR_SELECTOR,
  anchorBarBottom,
  placeAccountMenu,
  type MenuPlacement,
} from "@/lib/account-menu";
import { accountIdentity } from "@/lib/auth/identity";
import type { AppUser } from "@/lib/auth/use-current-user";
import { cn } from "@/lib/utils";
import { AccountAvatar } from "./AccountAvatar";
import { AccountBadge, useAccountTier } from "./AccountBadge";

/**
 * The identity card behind the account chip — one card for every surface.
 *
 * The site chrome and the editor toolbar both open "who is signed in, and where
 * does it lead": the same avatar, the same resolved name (`accountIdentity`),
 * the same server-resolved licence badge and the same action rows. Two copies of
 * that card drifted the moment one of them was restyled, so it lives here once,
 * with its geometry in `src/lib/account-menu.ts` and its surface in the
 * `.account-menu-panel` block of `src/styles.css`.
 *
 * What the card guarantees, on either surface:
 *   • it opens BELOW the bar that owns the chip, never over the toolbar's
 *     buttons (the placement is measured from the bar's bottom edge);
 *   • it stays inside the viewport on a phone: 280px floor, `100vw - 32px`
 *     ceiling, long names and addresses wrapping instead of pushing the edge;
 *   • it is fully opaque in both themes, above every background layer.
 */

/** One action row (icon + label). Shared so both surfaces style rows identically. */
export const accountMenuItemClass = "account-menu-item";

/** A secondary row — «تسجيل الخروج» and other quiet actions. */
export const accountMenuItemMutedClass = "account-menu-item account-menu-item-muted";

/**
 * The licence badge for a signed-in account.
 *
 * Its own component so `useAccountTier` (→ `useLicense`) mounts only while the
 * card is open: the hook has to be called unconditionally, and a collapsed chip
 * does not need a status round trip on every page load.
 */
function MenuTierBadge({ user }: { user: AppUser }) {
  const tier = useAccountTier(user);
  return <AccountBadge tier={tier} />;
}

/**
 * Measures where the card goes, from the trigger and the BAR it sits in.
 *
 * Measured when the card is opened (not in an effect), so its first paint is
 * already in its final place; while it is open a resize re-measures, because a
 * rotating tablet must not leave the card hanging off the bar it came from.
 */
export function useAccountMenuPlacement({
  triggerRef,
  barSelector = ACCOUNT_MENU_BAR_SELECTOR,
}: {
  triggerRef: RefObject<HTMLElement | null>;
  barSelector?: string;
}) {
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);

  const place = useCallback((): boolean => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return false;
    const anchor = trigger.getBoundingClientRect();
    setPlacement(
      placeAccountMenu({
        anchor,
        bar: anchorBarBottom(trigger, anchor, barSelector),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        dir: document.documentElement.getAttribute("dir") === "ltr" ? "ltr" : "rtl",
      }),
    );
    return true;
  }, [barSelector, triggerRef]);

  /** Forgetting the measurement is what closes the floating card. */
  const reset = useCallback(() => setPlacement(null), []);

  useEffect(() => {
    if (!placement) return;
    const refresh = () => void place();
    window.addEventListener("resize", refresh);
    return () => window.removeEventListener("resize", refresh);
  }, [placement, place]);

  return { placement, place, reset };
}

/**
 * The card itself: profile header (avatar, full name, address), the licence
 * badge, then the action rows passed as children.
 */
export function AccountMenuPanel({
  user,
  label,
  className,
  style,
  children,
}: {
  user: AppUser;
  /** Accessible name of the menu («قائمة الحساب»). */
  label: string;
  /** Placement: `account-menu-panel-floating` / `account-menu-panel-inline`. */
  className?: string;
  /** Geometry from `useAccountMenuPlacement`. */
  style?: CSSProperties;
  children: ReactNode;
}) {
  const identity = accountIdentity(user);
  return (
    <div
      role="menu"
      aria-label={label}
      className={cn("account-menu-panel", className)}
      style={style}
      /*
       * The card swallows pointer-down, so an outside-click layer behind it
       * cannot dismiss the menu while the author is working inside the card.
       */
      onPointerDown={(event) => event.stopPropagation()}
    >
      {/*
       * Profile header: the full name (never truncated — the card is where an
       * author confirms WHICH account is signed in) and the address, which is
       * secondary information beside it.
       */}
      <div className="account-menu-identity">
        <AccountAvatar user={user} size={30} />
        <div className="account-menu-fields">
          <p className="account-menu-name" title={identity.label}>
            {identity.label}
          </p>
          {identity.email && (
            <p className="account-menu-email" title={identity.email}>
              {/*
               * `bdi`: the address renders in its own (LTR) order while the row
               * keeps the card's RTL alignment, so neither the @host order nor
               * the Arabic layout is sacrificed.
               */}
              <bdi dir="ltr">{identity.email}</bdi>
            </p>
          )}
        </div>
      </div>

      {/* The licence state the server resolved for this account («مرخص» / «مجاني»). */}
      <div className="account-menu-badge">
        <MenuTierBadge user={user} />
      </div>

      <div className="account-menu-items">{children}</div>
    </div>
  );
}
