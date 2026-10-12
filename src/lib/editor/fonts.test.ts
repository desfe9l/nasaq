import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  clearDeviceFontCache,
  detectDeviceFonts,
  detectPlatform,
} from "./fonts.ts";

/**
 * Device-font detection and the «تم الرصد على …» platform caption.
 *
 * The platform caption is user-visible in the font panel, and iOS is the
 * trap: every iPhone/iPod UA contains "like Mac OS X" and iPadOS 13+
 * reports itself as "Macintosh" — so the iOS checks must run BEFORE the
 * macOS one, and the iPad must be told apart by touch points.
 */

const g = globalThis as Record<string, unknown>;
const saved = { navigator: g.navigator, document: g.document };

function withNavigator(nav: Record<string, unknown>) {
  Object.defineProperty(globalThis, "navigator", {
    value: nav,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: saved.navigator,
    configurable: true,
    writable: true,
  });
  g.document = saved.document;
  clearDeviceFontCache();
});

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  ipod:
    "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
  ipadLegacy:
    "Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1",
  ipadOS:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
  cros: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
};

describe("detectPlatform — iOS device detection", () => {
  it("reports an iPhone as آيفون, not as a Mac (the UA says 'like Mac OS X')", () => {
    withNavigator({ userAgent: UA.iphone, maxTouchPoints: 5 });
    assert.equal(detectPlatform(), "آيفون");
  });

  it("reports an iPod touch as آيفون", () => {
    withNavigator({ userAgent: UA.ipod, maxTouchPoints: 5 });
    assert.equal(detectPlatform(), "آيفون");
  });

  it("reports a legacy iPad UA (explicit 'iPad' token) as آيباد", () => {
    withNavigator({ userAgent: UA.ipadLegacy, maxTouchPoints: 5 });
    assert.equal(detectPlatform(), "آيباد");
  });

  it("reports iPadOS 13+ (Macintosh UA + touch) as آيباد", () => {
    withNavigator({ userAgent: UA.ipadOS, maxTouchPoints: 5 });
    assert.equal(detectPlatform(), "آيباد");
  });

  it("keeps a real Mac (Macintosh UA, no touch) as ماك — Safari and Chrome", () => {
    withNavigator({ userAgent: UA.mac, maxTouchPoints: 0 });
    assert.equal(detectPlatform(), "ماك");
    withNavigator({ userAgent: UA.macChrome, maxTouchPoints: 0 });
    assert.equal(detectPlatform(), "ماك");
    // A Mac whose navigator lacks maxTouchPoints entirely is still a Mac.
    withNavigator({ userAgent: UA.mac });
    assert.equal(detectPlatform(), "ماك");
  });

  it("a single touch point (some trackpad Macs) does NOT promote a Mac to an iPad", () => {
    withNavigator({ userAgent: UA.mac, maxTouchPoints: 1 });
    assert.equal(detectPlatform(), "ماك");
  });
});

describe("detectPlatform — the other desktops and mobiles", () => {
  it("Windows, Android, ChromeOS, Linux", () => {
    withNavigator({ userAgent: UA.windows, maxTouchPoints: 0 });
    assert.equal(detectPlatform(), "ويندوز");
    withNavigator({ userAgent: UA.android, maxTouchPoints: 5 });
    assert.equal(detectPlatform(), "أندرويد");
    withNavigator({ userAgent: UA.cros, maxTouchPoints: 0 });
    assert.equal(detectPlatform(), "كروم بوك");
    withNavigator({ userAgent: UA.linux, maxTouchPoints: 0 });
    assert.equal(detectPlatform(), "لينكس");
  });

  it("Android is never mistaken for Linux even though its UA says Linux", () => {
    withNavigator({ userAgent: UA.android, maxTouchPoints: 5 });
    assert.equal(detectPlatform(), "أندرويد");
  });

  it("is honest when there is no navigator or no recognisable UA", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    assert.equal(detectPlatform(), "غير معروف");
    withNavigator({ userAgent: "curl/8.0", maxTouchPoints: 0 });
    assert.equal(detectPlatform(), "غير معروف");
  });
});

describe("detectDeviceFonts", () => {
  it("returns an empty list (= unknown) without a DOM instead of throwing", () => {
    g.document = undefined;
    clearDeviceFontCache();
    assert.deepEqual(detectDeviceFonts(), []);
  });

  it("returns an empty list when canvas 2d is unavailable", () => {
    g.document = { createElement: () => ({ getContext: () => null }) };
    clearDeviceFontCache();
    assert.deepEqual(detectDeviceFonts(), []);
  });

  it("probes each family against two baselines, keeps the bundled families, and memoises", () => {
    // A fake 2d context: "Tahoma" measures differently from both baselines,
    // "Georgia" only differs from monospace (so it still counts), and every
    // other family is indistinguishable (absent).
    let font = "";
    let createCalls = 0;
    const ctx = {
      set font(v: string) {
        font = v;
      },
      get font() {
        return font;
      },
      measureText: (text: string) => {
        const base = text.length * 10;
        if (/"Tahoma"/.test(font)) return { width: base + 7 };
        if (/"Georgia"/.test(font) && /monospace$/.test(font)) return { width: base + 3 };
        return { width: base };
      },
    };
    g.document = {
      createElement: () => {
        createCalls += 1;
        return { getContext: () => ctx };
      },
    };
    clearDeviceFontCache();

    const found = detectDeviceFonts();
    const families = found.map((f) => f.family);
    assert.ok(families.includes("Tahoma"), "detected Arabic-capable system font");
    assert.ok(families.includes("Georgia"), "a family differing from ONE baseline counts");
    assert.ok(!families.includes("Segoe UI"), "an absent family is not reported");
    // Bundled web fonts are always selectable, flagged as bundled.
    for (const bundled of ["Cairo", "Tajawal", "Amiri"]) {
      const row = found.find((f) => f.family === bundled);
      assert.ok(row, `${bundled} present`);
      assert.equal(row?.bundled, true);
    }
    // No duplicates: a family listed in both candidate tables appears once.
    assert.equal(new Set(families).size, families.length);
    // Second call is served from the memo without touching the DOM again.
    assert.equal(detectDeviceFonts(), found);
    assert.equal(createCalls, 1);
  });
});
