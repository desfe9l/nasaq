import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error jsdom has no bundled types in devDependencies
import { JSDOM } from "jsdom";

/**
 * Signed-in editor boot (`/editor?template=official`) followed by a native
 * .nsq import while the current scratch document is dirty — the account flow
 * the CI browser suite (scripts/test-nsq-browser.mjs) exercises end to end.
 *
 * Runs through the REAL store with the real boot URL, in its own process so
 * the module-level boot parameters are read from this exact address.
 */

const dom = new JSDOM('<!doctype html><html dir="rtl"><body></body></html>', {
  url: "http://localhost:8080/editor?template=official",
  pretendToBeVisual: true,
});
const { window } = dom;

const define = (key: string, value: unknown) =>
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });

for (const key of [
  "document",
  "localStorage",
  "sessionStorage",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MutationObserver",
  "getComputedStyle",
  "location",
  "history",
  "CSS",
  "FileReader",
  "Blob",
  "File",
] as const) {
  const value = (window as unknown as Record<string, unknown>)[key];
  if (value !== undefined) define(key, value);
}
define("window", window);
window.matchMedia = ((query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList) as typeof window.matchMedia;
define("matchMedia", window.matchMedia);
define("requestAnimationFrame", (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0),
);
define("cancelAnimationFrame", (id: number) => clearTimeout(id));
define("navigator", { onLine: true, language: "ar-SA", userAgent: "signed-in-boot-test" });
define("fetch", async () => ({ ok: true, json: async () => ({}) }));
define("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const OWNER = "nsq-test-user";
const { setStorageOwner } = await import("../editor/storage-owner.ts");
setStorageOwner(OWNER);

const { useEditor } = await import("../editor/store.ts");
const { writeNsq, readNsq } = await import("./package.ts");
const { importReadResult } = await import("./intake.ts");
const { clearAllProjects, listProjects } = await import("../editor/storage.ts");

test("signed-in boot adopts the session owner and resolves access", async () => {
  await useEditor.getState().hydrate();
  const booted = useEditor.getState();
  assert.equal(booted.hydrated, true);
  assert.equal(booted.showcase, false, "no showcase flag on the account boot");
  assert.equal(booted.sessionOwner, OWNER, "the session identity is adopted");
  assert.equal(booted.entitlementsResolved, true);
  assert.equal(booted.entitlementsOwner, OWNER);
});

test("a dirty scratch document does not block a native .nsq import", async () => {
  await clearAllProjects();

  const project = {
    version: 2,
    name: "NSQ browser artwork",
    theme: "official",
    orgName: "Native QA",
    createdAt: 1700000000000,
    pages: [
      {
        id: "cover",
        name: "First artwork",
        w: 101.6,
        h: 76.2,
        bg: "#dc2626",
        elements: [
          {
            id: "title",
            type: "text",
            name: "title",
            x: 10,
            y: 10,
            w: 74,
            h: 20,
            rotation: 0,
            opacity: 1,
            z: 1,
            style: { fontFamily: "sans-serif", fontSize: 16, color: "#ffffff" },
            content: "Editable NASAQ نص عربي",
          },
          {
            id: "photo",
            type: "image",
            name: "photo",
            x: 10,
            y: 33,
            w: 30,
            h: 20,
            rotation: 0,
            opacity: 1,
            z: 1,
            style: { objectFit: "cover" },
            src: PNG,
          },
        ],
      },
      {
        id: "second",
        name: "Second page",
        w: 90,
        h: 130,
        bg: "#2563eb",
        elements: [],
      },
    ],
  };

  // Mirror the browser flow: the live document is dirtied before the import.
  useEditor.getState().setName("Unsaved before native import");
  assert.equal(useEditor.getState().saveState, "dirty");

  const file = await writeNsq({ project: project as never, activePageIndex: 1 });
  await new Promise((r) => setTimeout(r, 600));
  await clearAllProjects();

  const ok = await importReadResult(await readNsq(file.blob));
  assert.equal(ok, true, "the validated .nsq must open for the signed-in account");

  const state = useEditor.getState();
  assert.equal(state.name, "NSQ browser artwork");
  assert.equal(state.pages.length, 2);
  assert.equal(state.sessionOwner, OWNER, "the import never changes identity");
  const saved = await listProjects();
  assert.ok(
    saved.some((p) => p.name === "NSQ browser artwork"),
    "the imported project is persisted in the account library",
  );
});
