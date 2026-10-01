import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyStoredTheme,
  readStoredTheme,
  subscribeTheme,
  writeStoredTheme,
  type AppearanceMode,
} from "../theme.ts";

test("one preference drives the three live appearance modes, legacy migration and blocked-storage fallback", () => {
  const values = new Map<string, string>();
  const events = new EventTarget();
  const classes = new Set<string>();
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
          toggle: (name: string, value: boolean) => {
            if (value) classes.add(name);
            else classes.delete(name);
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
  const seen: AppearanceMode[] = [];
  const unsubscribe = subscribeTheme((value) => seen.push(value));
  try {
    applyStoredTheme();
    assert.equal(classes.has("dark"), false);
    assert.equal(classes.has("dim"), false);
    values.set("nasaq-report-ui-v2", JSON.stringify({ dark: true }));
    assert.equal(readStoredTheme(), "dark");

    writeStoredTheme("light");
    assert.equal(classes.has("dark"), false);
    assert.equal(classes.has("dim"), false);
    assert.equal(
      readStoredTheme(),
      "light",
      "explicit choice supersedes legacy settings",
    );

    writeStoredTheme("dim");
    assert.equal(classes.has("dark"), true);
    assert.equal(classes.has("dim"), true);
    assert.equal(meta.content, "#20262c", "browser chrome follows the dim palette");

    writeStoredTheme("dark");
    assert.equal(classes.has("dark"), true);
    assert.equal(classes.has("dim"), false);
    assert.equal(meta.content, "#0f141c", "browser chrome follows the dark palette");

    const storage = new Event("storage");
    Object.defineProperty(storage, "key", { value: "nasaq-theme" });
    values.set("nasaq-theme", "light");
    events.dispatchEvent(storage);
    assert.equal(classes.has("dark"), false, "other tabs synchronize");
    assert.equal(classes.has("dim"), false);
    assert.equal(meta.content, "#006c35", "browser chrome follows the light palette");

    blocked = true;
    writeStoredTheme("dim");
    assert.equal(
      classes.has("dark") && classes.has("dim"),
      true,
      "live UI updates even if persistence is unavailable",
    );
    assert.deepEqual(seen, ["light", "light", "dim", "dark", "light", "dim"]);
    unsubscribe();
    writeStoredTheme("light");
    assert.equal(seen.length, 6);
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
