import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error jsdom has no bundled types in devDependencies
import { JSDOM } from "jsdom";

/**
 * Showcase boot semantics (`/editor?template=official&showcase=1`).
 *
 * The marketing preview is fully interactive but NON-persisting: no session
 * owner is adopted, nothing is written to the visitor's library, and a native
 * .nsq import — which must create a persisted project — is refused
 * fail-closed instead of silently writing under no owner.
 *
 * Runs through the REAL store with the real boot URL, in its own process so
 * the module-level boot parameters are read from this exact address.
 */

const dom = new JSDOM('<!doctype html><html dir="rtl"><body></body></html>', {
  url: "http://localhost:8080/editor?template=official&showcase=1",
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
define("navigator", { onLine: true, language: "ar-SA", userAgent: "showcase-boot-test" });
define("fetch", async () => ({ ok: true, json: async () => ({}) }));
define("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

const { setStorageOwner } = await import("../editor/storage-owner.ts");
setStorageOwner("showcase-visitor");

const { useEditor } = await import("../editor/store.ts");
const { writeNsq, readNsq } = await import("./package.ts");
const { importReadResult } = await import("./intake.ts");
const { clearAllProjects, listProjects } = await import("../editor/storage.ts");

test("showcase boot is interactive but adopts no session owner", async () => {
  await useEditor.getState().hydrate();
  const booted = useEditor.getState();
  assert.equal(booted.hydrated, true, "the preview must hydrate");
  assert.equal(booted.showcase, true, "the boot URL's showcase flag must hold");
  assert.equal(
    booted.sessionOwner,
    null,
    "a non-persisting preview never adopts the session identity",
  );
  assert.ok(booted.pages.length >= 1, "the requested pack booted a document");
});

test("a native .nsq import is refused fail-closed in the showcase preview", async () => {
  await clearAllProjects();
  const file = await writeNsq({
    project: {
      version: 2,
      name: "ملف للمعاينة",
      theme: "official",
      orgName: "",
      createdAt: 1700000000000,
      pages: [
        {
          id: "p1",
          name: "صفحة",
          w: 210,
          h: 297,
          bg: "#ffffff",
          elements: [],
        },
      ],
    } as never,
  });
  const ok = await importReadResult(await readNsq(file.blob));
  assert.equal(ok, false, "showcase sessions must not import into storage");
  assert.equal(
    (await listProjects()).length,
    0,
    "nothing may be persisted by a showcase session",
  );
});

test("editing in the showcase never schedules a persisted save", async () => {
  useEditor.getState().setName("تجربة المعاينة");
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(
    (await listProjects()).length,
    0,
    "the preview must not autosave into the visitor's library",
  );
});
