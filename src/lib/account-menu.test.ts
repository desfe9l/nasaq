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
  placeAccountMenu,
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

test("the elevation shadow is a themed token, never a hardcoded colour", () => {
  const theme = styles.slice(styles.indexOf("@theme {"), styles.indexOf("\n}", styles.indexOf("@theme {")));
  assert.match(theme, /--shadow-dropdown:\s*0 10px 15px -3px rgba\(0, 0, 0, 0\.1\)/);

  const dark = styles.slice(styles.indexOf("html.dark {"), styles.indexOf("\n}", styles.indexOf("html.dark {")));
  assert.match(dark, /--shadow-dropdown:/, "Dark needs its own elevation value");
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
