import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { X } from "lucide-react";
import {
  ACCOUNT_MENU_BAR_SELECTOR,
  anchorBarBottom,
  createMenuFrameScheduler,
  installAccountMenuDismiss,
  placeAccountMenu,
  sameMenuPlacement,
  type MenuPlacement,
} from "@/lib/account-menu";
import { accountIdentity } from "@/lib/auth/identity";
import type { AppUser } from "@/lib/auth/use-current-user";
import { cn } from "@/lib/utils";
import { AccountAvatar } from "./AccountAvatar";

/**
 * The identity card behind the account chip — one card for every surface.
 *
 * The site chrome and the editor toolbar both open "who is signed in, and where
 * does it lead": the same avatar, the same resolved name (`accountIdentity`),
 * the same action rows. Status belongs only to the owning account trigger. Two copies of
 * that card drifted the moment one of them was restyled, so it lives here once,
 * with its geometry in `src/lib/account-menu.ts` and its surface in the
 * `.account-menu-panel` block of `src/styles.css`.
 *
 * What the card guarantees, on either surface:
 *   • it opens BELOW the bar that owns the chip, never over the toolbar's
 *     buttons (the placement is measured from the bar's bottom edge);
 *   • it stays inside the viewport on a phone: 280px floor, `100vw - 32px`
 *     ceiling, long names and addresses wrapping instead of pushing the edge;
 *   • it is fully opaque in both themes, above every background layer, and it
 *     floats on the shared dropdown layer (`account-menu-layer`) so no panel,
 *     drawer or dialog can end up painted on top of it;
 *   • it only closes when the author asks: a press clearly outside the card,
 *     Escape, the card's own close button, or choosing an item. A press inside
 *     the card — on its padding, its identity block, the gap between rows — is
 *     the author USING the card, and nothing may dismiss it for that.
 */

/** One action row (icon + label). Shared so both surfaces style rows identically. */
export const accountMenuItemClass = "account-menu-item";

/** A secondary row — «تسجيل الخروج» and other quiet actions. */
export const accountMenuItemMutedClass = "account-menu-item account-menu-item-muted";

/** The layer a floating card is portalled into (see `.account-menu-layer`). */
export const accountMenuLayerClass = "account-menu-layer";

/**
 * The slot a tier-gated row occupies BEFORE the server has answered.
 *
 * It is the exact height of `.account-menu-item`, so the rows under it never
 * slide up and back down when the licence resolves — that sliding is the "the
 * options appear out of order / jump around" the card used to show, and it is
 * also why a card measured before the answer arrives ended the wrong height.
 */
export function AccountMenuRowSlot() {
  return (
    <div className="account-menu-item account-menu-row-skeleton" aria-hidden>
      <span />
    </div>
  );
}

/**
 * Measures where the card goes, from the trigger and the BAR it sits in.
 *
 * Measured when the card is opened (not in an effect), so its first paint is
 * already in its final place. While it is open the card is re-measured — not
 * closed — by anything that can move the bar under it: a scroll, a rotation, or
 * the chip's own reflow (the identity chip changes width when the status badge
 * resolves, and a card that kept its old measurement would sit off the chip
 * that opened it). Repositioning is coalesced into one frame and a measurement
 * that changed nothing never re-renders the card.
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
    const next = placeAccountMenu({
      anchor,
      bar: anchorBarBottom(trigger, anchor, barSelector),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dir: document.documentElement.getAttribute("dir") === "ltr" ? "ltr" : "rtl",
    });
    // Same pixels ⇒ same object ⇒ no repaint. This is what keeps an open card
    // from shimmering while the page scrolls beneath it.
    setPlacement((prev) => (sameMenuPlacement(prev, next) ? prev : next));
    return true;
  }, [barSelector, triggerRef]);

  /** Forgetting the measurement is what closes the floating card. */
  const reset = useCallback(() => setPlacement(null), []);

  const measured = placement !== null;
  useEffect(() => {
    if (!measured) return;
    const { schedule, cancel } = createMenuFrameScheduler({
      measure: place,
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle as number),
    });
    window.addEventListener("resize", schedule);
    /*
     * Capture phase, so a scroll inside a scrolling toolbar strip or a scroll
     * container re-measures too. Closing on scroll was the old behaviour and it
     * is what made the card "vanish at a touch": a phone's URL bar collapsing
     * fires both a scroll and a resize.
     */
    window.addEventListener("scroll", schedule, true);
    let observer: ResizeObserver | undefined;
    const trigger = triggerRef.current;
    if (trigger && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(schedule);
      observer.observe(trigger);
    }
    return () => {
      cancel();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      observer?.disconnect();
    };
  }, [measured, place, triggerRef]);

  return { placement, place, reset };
}

/**
 * Keeps the card open until the author closes it.
 *
 * The wiring is here; the RULE is `installAccountMenuDismiss` in
 * `@/lib/account-menu`, so both surfaces answer the question the same way and the
 * answer is unit-tested. In short: a press that lands outside the card, or
 * Escape, or the card's own close button. The three behaviours this replaces are
 * the ones that made the card "vanish at any touch": the site chrome listened for
 * `click` on `window` (so a tap on the card's own padding closed it), the editor
 * laid an invisible full-viewport sheet over the page that swallowed every press
 * AND closed on it, and both closed on `scroll`/`resize` — a phone's URL bar
 * collapsing, or a scroll inside the card itself, is exactly that.
 */
export function useAccountMenuDismiss({
  open,
  panelRef,
  triggerRef,
  onClose,
}: {
  open: boolean;
  panelRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    return installAccountMenuDismiss({
      events: window,
      panel: () => panelRef.current,
      trigger: () => triggerRef.current,
      onClose,
    });
  }, [open, onClose, panelRef, triggerRef]);
}

/**
 * The card itself: full identity and actions, never a second status badge.
 */
export function AccountMenuPanel({
  user,
  label,
  className,
  style,
  panelRef,
  onClose,
  closeLabel = "إغلاق القائمة",
  children,
}: {
  user: AppUser;
  /** Accessible name of the menu («قائمة الحساب»). */
  label: string;
  /** Placement: `account-menu-panel-floating` / `account-menu-panel-inline`. */
  className?: string;
  /** Geometry from `useAccountMenuPlacement`. */
  style?: CSSProperties;
  /** The element the dismissal rule measures containment against. */
  panelRef?: RefObject<HTMLDivElement | null>;
  /** Explicit close — the ✕ in the header. Also how a chosen item steps out. */
  onClose?: () => void;
  /** Accessible name of the close button. */
  closeLabel?: string;
  children: ReactNode;
}) {
  const identity = accountIdentity(user);
  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      className={cn("account-menu-panel", className)}
      style={style}
      /*
       * The card swallows pointer-down and click, so an ancestor's own
       * dismiss-as-side-effect (a toolbar that closes its popovers on any
       * press) cannot treat a press inside the card as a press elsewhere.
       * Dismissal of THIS card is decided by containment in
       * `useAccountMenuDismiss`, which runs on the capture phase and is
       * therefore unaffected by this.
       */
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
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
        {onClose && (
          <button
            type="button"
            className="account-menu-close"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      <div className="account-menu-items">{children}</div>
    </div>
  );
}
