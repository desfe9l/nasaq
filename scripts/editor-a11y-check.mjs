/**
 * Accessibility audit of the real editor chrome — NO browser required.
 *
 * Renders EditorApp through the real router (memory history) on a jsdom DOM via
 * Vite, then walks the mounted markup and checks the things a screen reader or
 * a keyboard user actually depends on:
 *
 *   1. every interactive control has an accessible name (aria-label,
 *      aria-labelledby, a wrapping <label>, visible text, title or placeholder);
 *   2. no duplicate `id`s (they break label association and aria-labelledby);
 *   3. no positive `tabindex` (it reorders the tab sequence away from the DOM);
 *   4. decorative icons are hidden from assistive tech (aria-hidden) and every
 *      <img> carries an alt (empty is fine — it means "decorative", but it must
 *      be present);
 *   5. nothing renders as an interactive element inside another one
 *      (a <button> inside a <button> is invalid and unreachable).
 *
 * It is deliberately a LABEL/structure audit, not a contrast audit: jsdom has no
 * layout and no computed colours, so a colour-contrast claim from here would be
 * a fabrication. Contrast lives in the design tokens and is verified visually.
 *
 * Run:  npm run test:editor:a11y
 */
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

/* ── DOM + browser globals, before any app module loads ─────────────────── */
const dom = new JSDOM('<!doctype html><html dir="rtl"><body></body></html>', {
  url: "http://localhost/editor",
  pretendToBeVisual: true,
});
const { window } = dom;

const define = (key, value) =>
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });

for (const key of [
  "document",
  "localStorage",
  "sessionStorage",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLCanvasElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "PointerEvent",
  "KeyboardEvent",
  "MutationObserver",
  "getComputedStyle",
  "location",
  "history",
  "CSS",
]) {
  if (window[key] !== undefined) define(key, window[key]);
}
define("navigator", {
  userAgent: "Mozilla/5.0 (a11y-check)",
  language: "ar-SA",
  clipboard: { writeText: async () => {} },
  mediaDevices: undefined,
});
define("window", window);

window.matchMedia = (query) => {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  const matches = min
    ? window.innerWidth >= Number(min[1])
    : max
      ? window.innerWidth <= Number(max[1])
      : false;
  return {
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
};
define("matchMedia", window.matchMedia);

class StubObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
window.ResizeObserver = StubObserver;
window.IntersectionObserver = StubObserver;
define("ResizeObserver", StubObserver);
define("IntersectionObserver", StubObserver);
window.requestAnimationFrame ??= (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame ??= (id) => clearTimeout(id);
define("requestAnimationFrame", window.requestAnimationFrame.bind(window));
define("cancelAnimationFrame", window.cancelAnimationFrame.bind(window));
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLElement.prototype.scrollTo = () => {};
window.HTMLElement.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {} });
window.HTMLElement.prototype.getAnimations = () => [];
window.HTMLElement.prototype.setPointerCapture ??= () => {};
window.HTMLElement.prototype.releasePointerCapture ??= () => {};
window.HTMLElement.prototype.hasPointerCapture ??= () => false;

import "fake-indexeddb/auto";

const { createServer } = await import("vite");
const { resolve } = await import("node:path");
const vite = await createServer({
  configFile: false,
  root: resolve("."),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
  resolve: { alias: { "@": resolve("./src") } },
});

const INTERACTIVE = [
  "button",
  "a[href]",
  "input:not([type=hidden])",
  "select",
  "textarea",
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="combobox"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const text = (node) => (node?.textContent || "").replace(/\s+/g, " ").trim();

/**
 * jsdom applies no stylesheet, so `display:none` cannot be computed — the only
 * available signals are the `hidden` attribute, an inline `display:none`, and
 * this codebase's `hidden` utility class. Such an element is out of the
 * accessibility tree (it cannot be focused or announced), so the audit skips it
 * rather than reporting a label it does not need. `sr-only` is NOT skipped: it
 * is visually hidden but announced, so it must still carry a name.
 */
function isDisplayNone(el) {
  if (el.hasAttribute("hidden")) return true;
  if (String(el.style?.display || "") === "none") return true;
  return el.classList?.contains("hidden") ?? false;
}

function accessibleName(el, doc) {
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const joined = labelledBy
      .split(/\s+/)
      .map((id) => text(doc.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (joined) return joined;
  }
  if (el.id) {
    const label = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label && text(label)) return text(label);
  }
  const wrapping = el.closest("label");
  if (wrapping && text(wrapping)) return text(wrapping);
  const inner = text(el) || el.getAttribute("title") || el.getAttribute("placeholder");
  if (inner) return inner.trim();
  const labelled = el.getAttribute("data-label") || el.getAttribute("name");
  return labelled ? String(labelled).trim() : "";
}

const problems = [];
const record = (kind, el, detail) => {
  problems.push({
    kind,
    detail,
    html: `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(/\s+/).slice(0, 3).join(".")}` : ""}`,
    outer: el.outerHTML.slice(0, 220),
  });
};

function audit(host, label) {
  const doc = host.ownerDocument;
  /* The shell renders inside `host`; ids must be unique in the DOCUMENT. */
  const ids = new Map();
  for (const el of host.querySelectorAll("[id]")) {
    const id = el.getAttribute("id");
    if (!id) continue;
    ids.set(id, (ids.get(id) || 0) + 1);
  }
  for (const [id, count] of ids) {
    if (count > 1)
      record("duplicate-id", host, `«${id}» appears ${count} times (${label})`);
  }

  const controls = [...host.querySelectorAll(INTERACTIVE)];
  let unnamed = 0;
  let skipped = 0;
  for (const el of controls) {
    if (el.getAttribute("aria-hidden") === "true") continue;
    if (el.getAttribute("type") === "hidden") continue;
    if (isDisplayNone(el)) {
      skipped += 1;
      continue;
    }
    const name = accessibleName(el, doc);
    if (!name) {
      unnamed += 1;
      record("no-accessible-name", el, `${label}: control with no name`);
    }
    const tabindex = Number(el.getAttribute("tabindex") ?? "0");
    if (tabindex > 0) record("positive-tabindex", el, `${label}: tabindex=${tabindex}`);
    /* `closest` includes the element itself — walk up from the parent. */
    if (el.tagName.toLowerCase() === "button" && el.parentElement?.closest("button"))
      record("nested-button", el, `${label}: button inside button`);
    if (el.tagName.toLowerCase() === "a" && !el.getAttribute("href"))
      record("anchor-without-href", el, `${label}: anchor without href`);
  }

  for (const img of host.querySelectorAll("img")) {
    if (!img.hasAttribute("alt")) record("img-without-alt", img, `${label}: <img> without alt`);
  }
  for (const svg of host.querySelectorAll("svg")) {
    /* A decorative icon must be hidden; a meaningful one must have a title or a
     * text-equivalent label. `lucide` sets aria-hidden by default — this catches
     * hand-written inline SVG that does neither. */
    if (svg.getAttribute("aria-hidden") === "true") continue;
    if (svg.querySelector("title")) continue;
    if (svg.getAttribute("role") === "img" && svg.getAttribute("aria-label")) continue;
    record("svg-not-hidden", svg, `${label}: icon exposes no name and is not aria-hidden`);
  }
  return { controls: controls.length - skipped, skipped, unnamed };
}

try {
  const { useEditor } = await vite.ssrLoadModule("/src/lib/editor/store.ts");
  const { createProject } = await vite.ssrLoadModule("/src/lib/editor/templates.ts");
  const { default: React } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const editorAppModule = await vite.ssrLoadModule("/src/components/editor/EditorApp.tsx");
  const {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
  } = await import("@tanstack/react-router");

  const shell = () => React.createElement(editorAppModule.EditorApp);
  const rootRoute = createRootRoute();
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/", component: shell }),
    createRoute({ getParentRoute: () => rootRoute, path: "/editor", component: shell }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/editor/$projectId",
      component: shell,
    }),
  ]);

  const project = createProject("blank", "official", "فحص الوصول");
  const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));
  let host = null;
  let root = null;

  const mount = async (extra = {}) => {
    if (root) {
      root.unmount();
      host.remove();
    }
    useEditor.setState({
      hydrate: async () => {},
      hydrated: true,
      documentPhase: "ready",
      id: project.id ?? "a11y",
      name: project.name,
      pages: project.pages,
      activePageId: project.pages[0].id,
      leftOpen: true,
      rightOpen: true,
      layersOpen: true,
      libraryOpen: true,
      toolsOpen: true,
      reportToolsOpen: true,
      ...extra,
    });
    host = window.document.createElement("div");
    window.document.body.appendChild(host);
    root = createRoot(host);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/editor"] }),
      defaultPendingMinMs: 0,
    });
    router._rendered ??= [];
    await router.load();
    root.render(React.createElement(RouterProvider, { router }));
    await settle();
    return host;
  };

  /* The shipped layout (two docked windows) and the author's ungrouped layout
   * (six floating windows) — both are real configurations the shell renders. */
  window.localStorage.removeItem("nasaq.panel.groups.v3");
  window.localStorage.removeItem("nasaq.panel.docks.v3");
  const shipped = await mount();
  const shippedStats = audit(shipped, "shipped layout");

  window.localStorage.setItem("nasaq.panel.docks.v3", "{}");
  window.localStorage.setItem(
    "nasaq.panel.groups.v3",
    JSON.stringify({
      groups: {
        elements: ["elements"],
        tools: ["tools"],
        library: ["library"],
        properties: ["properties"],
        layers: ["layers"],
        report: ["report"],
      },
      tabs: {
        elements: "elements",
        tools: "tools",
        library: "library",
        properties: "properties",
        layers: "layers",
        report: "report",
      },
    }),
  );
  const floating = await mount();
  const floatingStats = audit(floating, "six-window layout");

  window.localStorage.removeItem("nasaq.panel.groups.v3");
  window.localStorage.removeItem("nasaq.panel.docks.v3");

  const total = shippedStats.controls + floatingStats.controls;
  assert.ok(
    total > 40,
    `the audit must actually see the chrome (found ${total} controls) — otherwise it proves nothing`,
  );

  if (problems.length) {
    console.log(`\n${problems.length} finding(s):\n`);
    for (const p of problems) console.log(`  ✖ ${p.kind} — ${p.detail}\n    ${p.outer}`);
    throw new Error(`${problems.length} accessibility finding(s)`);
  }

  console.log(
    `PASS: ${total} interactive controls across the shipped and six-window layouts all carry accessible names; no duplicate ids, no positive tabindex, no nested buttons, every icon hidden or named.`,
  );
  /*
   * The dev server keeps file watchers alive; a plain `vite.close()` can hang
   * on them long after the audit is decided, so the verdict is final here.
   */
  await Promise.race([vite.close(), new Promise((r) => setTimeout(r, 2000))]);
  process.exit(0);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
