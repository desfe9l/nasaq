import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyStoredTheme,
  readStoredTheme,
  subscribeTheme,
  writeStoredTheme,
} from "../theme.ts";

test("one preference drives live appearance, legacy migration and blocked-storage fallback", () => {
  const values = new Map<string, string>();
  const events = new EventTarget();
  let dark = false;
  let blocked = false;
  const meta: { content: string | null } = { content: null };
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => {
          if (blocked) throw new Error("blocked");
          return values.get(key) ?? null;
        },
        setItem: (key: string, value: string) => {
          if (blocked) throw new Error("blocked");
          values.set(key, value);
        },
      },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: {
        classList: {
          toggle: (_: string, value: boolean) => {
            dark = value;
          },
        },
      },
      // The theme also repaints the browser chrome; stub the tag it writes to.
      querySelector: (selector: string) =>
        selector === 'meta[name="theme-color"]'
          ? { setAttribute: (_: string, value: string) => (meta.content = value) }
          : null,
    },
  });
  const seen: boolean[] = [];
  const unsubscribe = subscribeTheme((value) => seen.push(value));
  try {
    applyStoredTheme();
    assert.equal(dark, false);
    values.set("nasaq-report-ui-v2", JSON.stringify({ dark: true }));
    assert.equal(readStoredTheme(), true);
    writeStoredTheme(false);
    assert.equal(dark, false);
    assert.equal(
      readStoredTheme(),
      false,
      "explicit choice supersedes legacy settings",
    );
    writeStoredTheme(true);
    assert.equal(dark, true);
    assert.equal(meta.content, "#0f141c", "browser chrome follows the dark palette");
    const storage = new Event("storage");
    Object.defineProperty(storage, "key", { value: "nasaq-theme" });
    values.set("nasaq-theme", "light");
    events.dispatchEvent(storage);
    assert.equal(dark, false, "other tabs synchronize");
    assert.equal(meta.content, "#006c35", "browser chrome follows the light palette");
    blocked = true;
    writeStoredTheme(true);
    assert.equal(
      dark,
      true,
      "live UI updates even if persistence is unavailable",
    );
    assert.deepEqual(seen, [false, false, true, false, true]);
    unsubscribe();
    writeStoredTheme(false);
    assert.equal(seen.length, 5);
  } finally {
    unsubscribe();
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
