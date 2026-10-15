import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACCOUNT_MENU_BAR_SELECTOR,
  ACCOUNT_MENU_GAP,
  ACCOUNT_MENU_MARGIN,
  ACCOUNT_MENU_MIN_HEIGHT,
  ACCOUNT_MENU_MIN_WIDTH,
  anchorBarBottom,
  createMenuFrameScheduler,
  installAccountMenuDismiss,
  isDismissalPress,
  placeAccountMenu,
  sameMenuPlacement,
  shouldDismissAccountMenu,
  type MenuAnchorRect,
  type MenuTriggerLike,
} from "./account-menu.ts";

/**
 * The geometry that keeps the account card off the toolbar it opens from.
 *
 * These are the invariants the bug report pinned down: the card must start
 * BELOW the bar (never on top of its buttons) and must never leave the viewport
 * on any screen it is opened on — which is what the CSS mirrors in
 * `.account-menu-panel` (also asserted here, since the two halves have to agree).
 */

/* A chip inside a 64px-tall header, at the inline (left, in RTL) edge. */
const RTL_CHIP: MenuAnchorRect = { top: 14, right: 120, bottom: 50, left: 84 };
const HEADER_BOTTOM = 64;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 360, height: 640 };

test("the card opens below the bar that owns the chip, never over the toolbar", () => {
  const placement = placeAccountMenu({
    anchor: RTL_CHIP,
    bar: HEADER_BOTTOM,
    viewport: DESKTOP,
  });
  assert.equal(placement.top, HEADER_BOTTOM + ACCOUNT_MENU_GAP);
  assert.ok(
    placement.top > HEADER_BOTTOM,
    "the card must clear the header's bottom edge, not start inside the bar",
  );
  assert.ok(placement.top > RTL_CHIP.bottom, "and it must clear the chip itself");
});

test("RTL aligns the card to the chip's inline edge (the screen edge side)", () => {
  const placement = placeAccountMenu({
    anchor: RTL_CHIP,
    bar: HEADER_BOTTOM,
    viewport: DESKTOP,
    dir: "rtl",
  });
  assert.equal(placement.insetInlineEnd, RTL_CHIP.left);
});

test("LTR aligns the card's inline-end edge to the chip", () => {
  /* An LTR document mirrors the chrome: the chip sits at the right edge. */
  const chip: MenuAnchorRect = { top: 14, right: DESKTOP.width - 84, bottom: 50, left: DESKTOP.width - 120 };
  const placement = placeAccountMenu({
    anchor: chip,
    bar: HEADER_BOTTOM,
    viewport: DESKTOP,
    dir: "ltr",
  });
  assert.equal(placement.insetInlineEnd, DESKTOP.width - chip.right);
});

test("a chip near the screen edge still keeps the whole card on screen", () => {
  /*
   * A phone in RTL: the chip sits 12px from the left edge, but the card's floor
   * is 280px — so its inline-end edge shifts back inside the 16px gutter instead
   * of running off the viewport (this is the "long text pushes the boundary"
   * failure), and the width ceiling never drops below that floor.
   */
  const anchor: MenuAnchorRect = { top: 14, right: 48, bottom: 50, left: 12 };
  const placement = placeAccountMenu({ anchor, bar: HEADER_BOTTOM, viewport: PHONE, dir: "rtl" });

  assert.ok(placement.insetInlineEnd >= ACCOUNT_MENU_MARGIN);
  assert.equal(placement.maxWidth, PHONE.width - ACCOUNT_MENU_MARGIN - placement.insetInlineEnd);
  assert.ok(placement.maxWidth >= ACCOUNT_MENU_MIN_WIDTH);
});

test("a wide card stays between the gutters at every width, in both directions", () => {
  /*
   * The card is `max-content` wide: a long studio name would push it past the
   * screen edge unless the per-open ceiling is the space that is actually left.
   * This is the invariant the bug report's overflow came from, swept across the
   * viewports the product is used on.
   */
  const viewports = [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ];
  const directions = ["rtl", "ltr"] as const;
  const offsets = [0, 12, 24, 60, 140, 320];

  for (const viewport of viewports) {
    for (const dir of directions) {
      for (const offset of offsets) {
        if (offset > viewport.width) continue;
        const anchor: MenuAnchorRect =
          dir === "rtl"
            ? { top: 14, right: viewport.width - offset - 36, bottom: 50, left: offset }
            : { top: 14, right: viewport.width - offset, bottom: 50, left: viewport.width - offset - 36 };
        const placement = placeAccountMenu({ anchor, bar: HEADER_BOTTOM, viewport, dir });

        assert.ok(placement.insetInlineEnd >= ACCOUNT_MENU_MARGIN);
        assert.ok(placement.maxWidth >= ACCOUNT_MENU_MIN_WIDTH);
        assert.ok(
          placement.insetInlineEnd + placement.maxWidth <= viewport.width - ACCOUNT_MENU_MARGIN,
          `${dir} ${viewport.width}px @${offset}: the card must not cross the far gutter`,
        );
        assert.ok(placement.top > HEADER_BOTTOM, "and it must still open below the bar");
      }
    }
  }
});

test("maxHeight keeps a tall card on screen and leaves it usable", () => {
  const tall = placeAccountMenu({ anchor: RTL_CHIP, bar: HEADER_BOTTOM, viewport: DESKTOP });
  assert.equal(tall.top + tall.maxHeight, DESKTOP.height - ACCOUNT_MENU_MARGIN);

  /* A very short viewport scrolls the card internally rather than clipping it. */
  const short = placeAccountMenu({
    anchor: RTL_CHIP,
    bar: HEADER_BOTTOM,
    viewport: { width: 1024, height: 220 },
  });
  assert.ok(short.maxHeight >= ACCOUNT_MENU_MIN_HEIGHT);
  assert.ok(short.top >= ACCOUNT_MENU_MARGIN);
});

test("anchorBarBottom measures the bar, falling back to the trigger alone", () => {
  const trigger: MenuTriggerLike = {
    getBoundingClientRect: () => RTL_CHIP,
    closest: (selector: string) =>
      selector === ACCOUNT_MENU_BAR_SELECTOR
        ? { getBoundingClientRect: () => ({ top: 0, right: 1440, bottom: HEADER_BOTTOM, left: 0 }), closest: () => null }
        : null,
  };
  assert.equal(anchorBarBottom(trigger, RTL_CHIP), HEADER_BOTTOM);
  assert.equal(anchorBarBottom(null, RTL_CHIP), RTL_CHIP.bottom);

  const orphan: MenuTriggerLike = { getBoundingClientRect: () => RTL_CHIP, closest: () => null };
  assert.equal(anchorBarBottom(orphan, RTL_CHIP), RTL_CHIP.bottom);
});

/* ------------------------------------------------------ the dismiss half ---- */

/*
 * The rule asks one thing of an element — `contains` — so the fakes below are
 * structural: a press is a `{ id }` box and a surface is the set of ids inside
 * it. No DOM, no jsdom, and the whole dismissal contract is exercised on the
 * same page the geometry tests run on.
 */
type PressBox = { id: string };

/** A press that landed on `name`. */
const press = (name: string): EventTarget => ({ id: name }) as unknown as EventTarget;

/** An element whose subtree holds exactly `names`. */
function hit(...names: string[]) {
  return {
    contains: (other: EventTarget | null) =>
      other !== null && names.includes((other as unknown as PressBox).id),
  };
}

test("a press is a dismissal only when it lands outside the card and the chip", () => {
  const panel = hit("panel", "row", "padding", "identity", "subscription");
  const trigger = hit("chip", "chip-badge");

  // Anywhere INSIDE the card keeps it open — including the padding, the gap
  // between rows and the identity block, which a blanket window listener used
  // to treat as "outside".
  for (const inside of ["panel", "row", "padding", "identity", "subscription"]) {
    assert.equal(
      shouldDismissAccountMenu({ press: press(inside), panel, trigger }),
      false,
      `a press on "${inside}" is the author using the card, not leaving it`,
    );
  }
  // The chip owns its toggle: dismissing here would fight (and re-open in) the tap.
  assert.equal(shouldDismissAccountMenu({ press: press("chip"), panel, trigger }), false);
  assert.equal(shouldDismissAccountMenu({ press: press("chip-badge"), panel, trigger }), false);
  // Anything else is an explicit press outside the card, and closes it.
  assert.equal(shouldDismissAccountMenu({ press: press("page"), panel, trigger }), true);
  assert.equal(shouldDismissAccountMenu({ press: press("toolbar-button"), panel, trigger }), true);
  assert.equal(shouldDismissAccountMenu({ press: null, panel, trigger }), true);
  // No card on screen: there is nothing to dismiss.
  assert.equal(shouldDismissAccountMenu({ press: press("page"), panel: null, trigger }), false);
});

/** A `window` that records what was installed, so the wiring itself is testable. */
function fakeEvents() {
  type Slot = { listener: EventListener; capture: boolean };
  const bound = new Map<string, Slot[]>();
  const events = {
    addEventListener: (type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => {
      const capture = options === true || (typeof options === "object" && options.capture === true);
      const slot = { listener, capture };
      bound.set(type, [...(bound.get(type) ?? []), slot]);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      bound.set(type, (bound.get(type) ?? []).filter((slot) => slot.listener !== listener));
    },
  };
  const fire = (type: string, event: Record<string, unknown>) => {
    for (const slot of bound.get(type) ?? []) {
      (slot.listener as (payload: unknown) => void)({ type, ...event } as Event);
    }
  };
  return { events, fire, captureOf: (type: string) => bound.get(type)?.some((slot) => slot.capture) ?? false, count: (type: string) => (bound.get(type) ?? []).length };
}

test("what is installed on the window is exactly: a capture press listener and Escape", () => {
  const { events, captureOf, count } = fakeEvents();
  let closes = 0;
  const teardown = installAccountMenuDismiss({
    events,
    panel: () => hit("panel", "row"),
    trigger: () => hit("chip"),
    onClose: () => {
      closes += 1;
    },
  });
  // Capture, so a portal cannot hide the press from the rule.
  assert.equal(captureOf("pointerdown"), true);
  assert.equal(count("click"), 0, "a click listener is how the card used to vanish on its own padding");
  assert.equal(count("scroll"), 0, "a scroll re-measures; it must never dismiss");
  assert.equal(count("resize"), 0, "a resize (a phone's URL bar) must never dismiss either");

  // Teardown detaches both, so a closed card leaves no listener behind.
  teardown();
  assert.equal(count("pointerdown"), 0);
  assert.equal(count("keydown"), 0);
  assert.equal(closes, 0);
});

test("installed listeners: outside press and Escape close; nothing else does", () => {
  const { events, fire } = fakeEvents();
  const closed: string[] = [];
  installAccountMenuDismiss({
    events,
    panel: () => hit("panel", "row", "subscription"),
    trigger: () => hit("chip"),
    onClose: () => closed.push("close"),
  });

  fire("pointerdown", { target: { id: "row" } });
  fire("pointerdown", { target: { id: "subscription" } });
  fire("pointerdown", { target: { id: "chip" } });
  fire("pointerdown", { target: { id: "somewhere" }, pointerType: "mouse", button: 2 });
  fire("keydown", { key: "Enter" });
  fire("keydown", { key: "Tab" });
  assert.deepEqual(closed, [], "a press inside the card, on the chip, a secondary button, or an ordinary key is not an exit");

  fire("pointerdown", { target: { id: "page" } });
  fire("keydown", { key: "Escape" });
  assert.deepEqual(closed, ["close", "close"], "an outside press and Escape are the exits");
});

test("a secondary mouse button is never a dismissal, a touch always is", () => {
  assert.equal(isDismissalPress({ target: null, pointerType: "mouse", button: 2 }), false);
  assert.equal(isDismissalPress({ target: null, pointerType: "mouse", button: 0 }), true);
  assert.equal(isDismissalPress({ target: null, pointerType: "touch" }), true);
  assert.equal(isDismissalPress({ target: null }), true);
});

test("re-measures are coalesced into one frame, and cancelling drops them", () => {
  const queue: (() => void)[] = [];
  let measures = 0;
  const frames = createMenuFrameScheduler({
    measure: () => {
      measures += 1;
    },
    requestFrame: (callback) => {
      queue.push(callback);
      return queue.length;
    },
    cancelFrame: () => {
      queue.length = 0;
    },
  });

  /* A scroll burst is 20 events per frame, not 20 layout reads. */
  for (let i = 0; i < 20; i += 1) frames.schedule();
  assert.equal(queue.length, 1, "one measurement per frame");
  queue.shift()?.();
  assert.equal(measures, 1);

  frames.schedule();
  frames.cancel();
  assert.equal(queue.length, 0, "a frame that never paints is dropped on unmount");
});

test("a re-measure that changed nothing never re-renders the card", () => {
  const first = placeAccountMenu({ anchor: RTL_CHIP, bar: HEADER_BOTTOM, viewport: DESKTOP });
  const same = { ...first };
  assert.ok(sameMenuPlacement(first, same), "scroll/resize re-measures must be equality-checked");
  assert.ok(!sameMenuPlacement(first, { ...first, top: first.top + 1 }), "a real move is a real update");
  assert.ok(!sameMenuPlacement(null, first));
  assert.ok(sameMenuPlacement(null, null));
});

/* --------------------------------------------------------- the CSS half ---- */

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

/** The declarations of one rule, so the card's contract can be read directly. */
function rule(selector: string): string {
  const start = styles.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} must exist in src/styles.css`);
  return styles.slice(start, styles.indexOf("}", start));
}

test("the card's CSS carries the required sizing, wrapping and layering", () => {
  const panel = rule(".account-menu-panel");

  assert.match(panel, /width: max-content/, "the card grows with its content");
  assert.match(
    panel,
    /min-width: min\(280px, calc\(100vw - 32px\)\)/,
    "280px floor, which on a 320px phone cannot itself overflow the viewport",
  );
  assert.match(panel, /max-width: calc\(100vw - 32px\)/, "a 16px gutter on each side");
  assert.match(panel, /padding: 1rem/, "1rem of internal spacing on every child");
  assert.match(panel, /word-break: break-word/);
  assert.match(panel, /overflow-wrap: anywhere/, "long emails/studio names wrap, never push the edge");
  assert.match(panel, /overflow-y: auto/, "a card taller than the viewport scrolls inside itself");
  assert.match(panel, /background-color: var\(--color-surface\)/, "opaque, in both themes");
  assert.match(panel, /box-shadow: var\(--shadow-dropdown\)/);
  assert.match(panel, /z-index: var\(--z-dropdown, 50\)/, "elevated above the header's own layer");

  assert.match(rule(".account-menu-panel-floating"), /position: absolute/);
  assert.match(rule(".account-menu-panel-inline"), /position: static/);
});

test("the card floats on one shared layer, never on a per-surface number", () => {
  /*
   * The layer is what keeps the card off every other element on the page: fixed
   * (so the measured viewport geometry means what it says), on the dropdown
   * elevation (above the header, the panels and the mobile docks; below a
   * dialog), and pointer-transparent (so it is not a scrim the page dies under).
   */
  const layer = rule(".account-menu-layer");
  assert.match(layer, /position: fixed/);
  assert.match(layer, /inset: 0/);
  assert.match(layer, /z-index: var\(--z-dropdown\)/, "one token, both surfaces");
  assert.match(layer, /pointer-events: none/, "outside presses fall through to the page");

  /* The reserved row and the explicit close button, styled once. */
  assert.match(styles, /\.account-menu-close\s*\{[^}]*width: 26px/, "the card carries its own close control");
  assert.match(styles, /\.account-menu-row-skeleton\s*\{[^}]*pointer-events: none/);
});

test("the subscription section is laid out to be re-painted, not re-sized", () => {
  /*
   * The "shaking حسابي والاشتراك field" was a section that grew rows and lost
   * its meter as the server answered. Every box that holds a value is sized in
   * CSS, so only the text changes: four equal rows, a hint line that always
   * occupies its row, and a skeleton that fits inside the same box.
   */
  const field = rule(".subscription-field");
  assert.match(field, /min-height: 56px/, "a field row never collapses or grows");
  assert.match(field, /grid-template-columns|display: grid|align-content: start/);
  assert.match(rule(".subscription-field-hint"), /min-height: 14px/, "the hint keeps its line");
  assert.match(rule(".subscription-status"), /min-width: 96px/, "the status pill is one width in every state");
  assert.match(rule(".subscription-status"), /min-height: 21px/);
  assert.match(rule(".subscription-meter"), /height: 6px/);
  assert.match(rule(".subscription-countdown-value"), /min-height: 16px/);
  assert.match(rule(".account-control .account-badge"), /min-width: 74px/);
  assert.match(rule(".subscription-skeleton-block"), /min-height: 132px/);

  /* A placeholder that pulses beside stable text is the flicker being removed. */
  const loading = rule(".subscription-skeleton");
  assert.doesNotMatch(loading, /animation/, "loading states are static blocks, not a shimmer");
  assert.match(loading, /background: var\(--color-skeleton\)/);
});

test("the elevation shadow is a themed token, never a hardcoded colour", () => {
  const theme = styles.slice(styles.indexOf("@theme {"), styles.indexOf("\n}", styles.indexOf("@theme {")));
  assert.match(theme, /--shadow-dropdown:\s*0 10px 15px -3px rgba\(0, 0, 0, 0\.1\)/);

  const dark = styles.slice(styles.indexOf("html.dark {"), styles.indexOf("\n}", styles.indexOf("html.dark {")));
  assert.match(dark, /--shadow-dropdown:/, "Dark needs its own elevation value");
});

test("nothing but an outside press, Escape or the close button dismisses the card", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const card = read("../components/site/AccountMenuPanel.tsx");
  const site = read("../components/site/SiteChrome.tsx");
  const editor = read("../components/editor/EditorAccountMenu.tsx");

  // One shared rule, applied on the capture phase, on both surfaces.
  assert.match(card, /export function useAccountMenuDismiss/);
  assert.match(card, /installAccountMenuDismiss\(\{/, "both surfaces share one installer");
  for (const surface of [site, editor]) {
    assert.match(surface, /useAccountMenuDismiss\(\{ open, panelRef, triggerRef: buttonRef, onClose: closeMenu \}\)/);
    assert.match(surface, /panelRef=\{panelRef\}/, "the card hands its element to the containment rule");
    assert.match(surface, /onClose=\{closeMenu\}/, "the card carries its own explicit close");
    // The three bugs that made the card vanish on a touch: a window click
    // listener, a full-viewport sheet that swallows presses, and closing on a
    // scroll or a resize (a phone's URL bar collapsing is both).
    assert.doesNotMatch(surface, /addEventListener\("click", closeMenu\)/);
    assert.doesNotMatch(surface, /addEventListener\("(scroll|resize)", closeMenu/);
    assert.doesNotMatch(surface, /onPointerDown=\{closeMenu\}/);
    assert.doesNotMatch(surface, /pointer-events-none fixed inset-0/);
    // And it re-measures instead of closing when the bar under it moves.
    assert.match(card, /addEventListener\("scroll", schedule, true\)/);
    assert.match(card, /new ResizeObserver\(schedule\)/);
  }
});

test("the surfaces open the subscription section with the card, not after it", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  for (const surface of ["../components/site/SiteChrome.tsx", "../components/editor/EditorAccountMenu.tsx"]) {
    const text = read(surface);
    assert.match(text, /<AccountSubscriptionCard user=\{user\} variant="menu" \/>/);
    // A row that appears later moves the rows under it: every tier-gated block
    // holds its own slot while the answer is pending.
    assert.match(text, /AccountMenuRowSlot/);
  }
  const slots = read("../components/site/AccountMenuPanel.tsx");
  assert.match(slots, /export function AccountMenuRowSlot/);
  // The section itself: fixed fields in a fixed order, no local arithmetic.
  const card = read("../components/site/AccountSubscriptionCard.tsx");
  assert.match(card, /detail\.fields\.map/);
  assert.match(card, /subscriptionDetail|useAccountSubscription/);
  assert.doesNotMatch(card, /Date\.now\(\)|setInterval/, "the countdown is derived once, never ticked in the view");
});

test("both surfaces render the shared card instead of their own", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const card = read("../components/site/AccountMenuPanel.tsx");
  const site = read("../components/site/SiteChrome.tsx");
  const editor = read("../components/editor/EditorAccountMenu.tsx");

  /** One function's source, so a page-wide regex cannot match a sibling menu. */
  const body = (source: string, name: string) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} must still exist`);
    const nextDoc = source.indexOf("\n/**", start + 1);
    return source.slice(start, nextDoc === -1 ? undefined : nextDoc);
  };
  const account = body(site, "HeaderAccount");

  assert.match(card, /"account-menu-panel"/, "the card applies the styled surface class");
  assert.doesNotMatch(card, /className="[^"]*truncate/, "the card wraps long identity text instead of clipping it");
  assert.match(card, /<bdi dir="ltr">/, "the address keeps LTR order inside the RTL row");

  for (const surface of [site, editor]) {
    assert.match(surface, /<AccountMenuPanel/, "the surface uses the shared card");
    assert.match(surface, /account-menu-panel-floating/, "the surface floats the card");
    assert.match(surface, /useAccountMenuPlacement/, "the surface measures from the bar");
  }

  assert.doesNotMatch(account, /w-52/, "the old fixed 208px card is gone");
  assert.doesNotMatch(account, /role="menu"/, "the account menu markup lives in the shared card");
  assert.doesNotMatch(editor, /MENU_WIDTH/, "the old fixed 252px card is gone");
});
