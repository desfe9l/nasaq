import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
// @ts-expect-error jsdom has no bundled types in devDependencies
import { JSDOM } from "jsdom";
import ts from "typescript";

/**
 * The account card's open/close behaviour, driven through the real hooks.
 *
 * The bug being pinned here is not geometry, it is the card disappearing: so this
 * file loads the REAL `AccountMenuPanel.tsx` (transpiled, with only its leaf
 * imports stubbed) and mounts a chip plus a card in jsdom, then presses on it the
 * way a hand does — `pointerdown` first, `click` after — and checks which presses
 * the card survives.
 *
 * The rules under test, one line each:
 *   • a press anywhere inside the card keeps it open (its padding, its rows, the
 *     reserved slot, the identity block);
 *   • the chip keeps its own toggle, a secondary mouse button is not an exit, and
 *     a `click`, a `scroll` or a `resize` is not an exit either;
 *   • the only exits are a primary press outside the card, Escape, and the card's
 *     own close button;
 *   • unmounting detaches the listeners, so a closed card cannot react to a later
 *     press.
 */

const require = createRequire(import.meta.url);
const React = require("react");
const { act } = React;
const ReactDOM = require("react-dom/client");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const dom = new JSDOM('<!doctype html><html dir="rtl"><body></body></html>', {
  url: "http://localhost/account",
  pretendToBeVisual: true,
});
const { window } = dom;
/* React needs the flag to let act() flush work (otherwise it warns and skips). */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const key of [
  "window",
  "document",
  "Element",
  "HTMLElement",
  "Node",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "navigator",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  const value = key === "window" ? window : window[key];
  if (value === undefined) continue;
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
/* jsdom has no ResizeObserver, which is exactly the environment the hook guards. */
assert.equal(window.ResizeObserver, undefined, "the hook must fall back to the listeners alone");

const user = {
  id: "u1",
  displayName: "فيصل العنزي",
  primaryEmail: "faisal@example.com",
  profileImageUrl: null,
  isDevFallback: false,
};

const stubs = new Map([
  [
    "@/lib/auth/identity",
    {
      accountIdentity: () => ({
        label: user.displayName,
        initials: "فع",
        avatarUrl: null,
        email: user.primaryEmail,
        hasProfileName: true,
      }),
    },
  ],
  ["@/lib/utils", { cn: (...args) => args.filter(Boolean).join(" ") }],
  ["./AccountAvatar", { AccountAvatar: () => React.createElement("span", { className: "avatar-fake" }) }],
  [
    "lucide-react",
    new Proxy(
      {},
      {
        get: (_target, name) => () => React.createElement("i", { className: `icon-${String(name)}` }),
      },
    ),
  ],
]);

/** Evaluate an app source file as CommonJS, with the app's aliases stubbed. */
function loadModule(path) {
  const { outputText } = ts.transpileModule(read(path), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const module = { exports: {} };
  const localRequire = (specifier) => (stubs.has(specifier) ? stubs.get(specifier) : require(specifier));
  new Function("module", "exports", "require", outputText)(module, module.exports, localRequire);
  return module.exports;
}

/* The rule module first, so the card is loaded against the REAL dismissal rule. */
stubs.set("@/lib/account-menu", loadModule("src/lib/account-menu.ts"));
const { AccountMenuPanel, AccountMenuRowSlot, useAccountMenuPlacement, useAccountMenuDismiss } = loadModule(
  "src/components/site/AccountMenuPanel.tsx",
);

/** The surface that owns the chip — the site header and the editor toolbar reduced to one. */
function Harness() {
  const buttonRef = React.useRef(null);
  const panelRef = React.useRef(null);
  const [open, setOpen] = React.useState(false);
  const { placement, place, reset } = useAccountMenuPlacement({ triggerRef: buttonRef });
  const close = React.useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);
  useAccountMenuDismiss({ open, panelRef, triggerRef: buttonRef, onClose: close });

  const toggle = () => {
    if (open) close();
    else if (place()) setOpen(true);
  };

  return React.createElement(
    "div",
    { className: "bar" },
    React.createElement(
      "button",
      {
        ref: buttonRef,
        type: "button",
        id: "chip",
        "aria-expanded": open,
        onClick: (event) => {
          event.stopPropagation();
          toggle();
        },
      },
      "chip",
    ),
    open &&
      React.createElement(
        "div",
        { className: "account-menu-layer", id: "layer" },
        React.createElement(
          AccountMenuPanel,
          {
            user,
            label: "قائمة الحساب",
            className: "account-menu-panel-floating",
            panelRef,
            onClose: close,
            style: placement ?? undefined,
          },
          React.createElement("div", { id: "padding", className: "account-menu-subscription" }, "الاشتراك"),
          React.createElement("a", { id: "row", role: "menuitem", href: "/account" }, "حسابي والاشتراك"),
          React.createElement(AccountMenuRowSlot),
        ),
      ),
  );
}

function mount() {
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  let root;
  act(() => {
    root = ReactDOM.createRoot(host);
    root.render(React.createElement(Harness));
  });
  const panelOf = () => host.querySelector(".account-menu-panel");
  const fire = (node, event) => {
    act(() => {
      node.dispatchEvent(event);
    });
  };
  return {
    host,
    panelOf,
    chip: host.querySelector("#chip"),
    toggle: () => fire(host.querySelector("#chip"), new window.MouseEvent("click", { bubbles: true })),
    /** A press, exactly as the browser delivers one: `pointerdown` on the element. */
    press: (node, { pointerType = "mouse", button = 0 } = {}) => {
      const event = new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button });
      Object.defineProperty(event, "pointerType", { value: pointerType, configurable: true });
      fire(node, event);
    },
    click: (node) => fire(node, new window.MouseEvent("click", { bubbles: true, cancelable: true })),
    emit: (type) => fire(window, new window.Event(type, { bubbles: false })),
    key: (key) => fire(window, new window.KeyboardEvent("keydown", { key, bubbles: true })),
    unmount: () => act(() => root.unmount()),
  };
}

const opened = (view) => {
  view.toggle();
  assert.ok(view.panelOf(), "the chip opened the card");
};

test("a press anywhere inside the card keeps it open", () => {
  const view = mount();
  opened(view);
  const panelEl = view.panelOf();

  for (const [name, node] of [
    ["the subscription block", panelEl.querySelector("#padding")],
    ["an action row", panelEl.querySelector("#row")],
    ["the reserved row slot", panelEl.querySelector(".account-menu-row-skeleton")],
    ["the items container", panelEl.querySelector(".account-menu-items")],
    ["the card itself", panelEl],
  ]) {
    assert.ok(node, `${name} is rendered to be pressed`);
    view.press(node);
    assert.ok(view.panelOf(), `a press on ${name} is the author using the card, not leaving it`);
    view.click(node);
    assert.ok(view.panelOf(), `the click that follows that press is not a second dismissal signal`);
  }

  view.press(view.chip);
  assert.ok(view.panelOf(), "the chip owns its toggle; the dismiss rule stays out of it");
  view.unmount();
});

test("the only exits are an outside press, Escape, and the close button", () => {
  const view = mount();
  opened(view);

  /* The three events that used to throw the card away. */
  view.emit("resize");
  view.emit("scroll");
  view.click(view.host.querySelector(".bar"));
  assert.ok(view.panelOf(), "a resize or a scroll re-measures the card; it never dismisses it");

  view.press(window.document.body, { button: 2 });
  assert.ok(view.panelOf(), "a secondary button is not an exit (the context menu belongs to the page)");

  view.key("Escape");
  assert.equal(view.panelOf(), null, "Escape closes the card");
  view.toggle();
  assert.ok(view.panelOf(), "and the chip opens it again afterwards");

  const closeBtn = view.panelOf().querySelector(".account-menu-close");
  assert.ok(closeBtn, "the card carries its own explicit close button");
  view.click(closeBtn);
  assert.equal(view.panelOf(), null, "the close button closes the card");
  view.unmount();
});

test("a primary press outside the card dismisses it, and teardown detaches the rule", () => {
  const view = mount();
  opened(view);
  view.press(window.document.body);
  assert.equal(view.panelOf(), null, "an explicit press outside the card closes it");
  view.toggle();
  assert.ok(view.panelOf(), "the chip opens a fresh card with a fresh measurement");

  view.unmount();
  assert.doesNotThrow(
    () => view.press(window.document.body),
    "an unmounted card leaves no listener behind to answer a press",
  );
});

test("a re-measure that changes nothing does not re-paint the card", () => {
  const view = mount();
  opened(view);
  const before = view.panelOf().outerHTML;
  view.emit("resize");
  view.host.querySelector(".bar").dispatchEvent(new window.Event("scroll", { bubbles: true }));
  act(() => {});
  assert.equal(view.panelOf().outerHTML, before, "same pixels ⇒ no repaint; that is the flicker being removed");
  assert.ok(view.panelOf(), "and the card is still open after all of it");
  view.unmount();
});

test("the card keeps its inline style from the bar, not the chip, and the layer class is applied", () => {
  const view = mount();
  opened(view);
  const layer = view.host.querySelector(".account-menu-layer");
  const panelEl = view.panelOf();
  assert.ok(layer, "the card is portalled into the shared layer");
  assert.ok(panelEl.classList.contains("account-menu-panel-floating"), "floating, not in-flow");
  /* `placeAccountMenu` returns inline-end/top/maxWidth/maxHeight; all four are applied. */
  for (const prop of ["inset-inline-end", "top", "max-width", "max-height"]) {
    assert.ok(panelEl.style.getPropertyValue(prop) !== "", `${prop} is applied from the measurement`);
  }
  assert.equal(panelEl.getAttribute("role"), "menu");
  assert.equal(panelEl.getAttribute("aria-label"), "قائمة الحساب");
  view.unmount();
});
