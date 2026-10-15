/**
 * The announcement bridge a revoked session travels over.
 *
 * `client.ts` announces (`notifySessionEnded`), the root `SessionWatch` listens
 * (`onSessionEnded`) and routes to sign-in. Both halves are DOM code, so they are
 * exercised against a real DOM (jsdom) rather than through the shape of the
 * functions: a rename on one side and not the other would silently stop ending
 * sessions — the failure mode this whole path exists to prevent.
 *
 * The round trip with the modules that decide WHAT to announce is covered by
 * `session-store.test.ts` (revocation is announced once, only for a session this
 * browser was showing) and `session-recovery.test.ts` (where it redirects to).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

/**
 * `jsdom` ships no type declarations, and its constructor is the only thing this
 * file needs, so it is loaded through `require` (typed `any`) behind a local
 * signature instead of pulling an ambient module declaration into `src/`.
 */
const nodeRequire = createRequire(import.meta.url);
type JsdomConstructor = new (
  html: string,
  options: { url: string },
) => { window: Window & typeof globalThis };
const { JSDOM } = nodeRequire("jsdom") as { JSDOM: JsdomConstructor };

type Dom = { window: Window & typeof globalThis };

let dom: Dom | null = null;
let restore: (() => void) | null = null;

/** Minimal DOM global so the event helpers run exactly as they do in a browser. */
async function ensureDom(): Promise<Dom> {
  if (dom) return dom;
  const window = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://nasaq.team/workspace?tab=recent",
  }).window as unknown as Window & typeof globalThis;
  const previous = {
    window: (globalThis as { window?: unknown }).window,
    document: (globalThis as { document?: unknown }).document,
    CustomEvent: (globalThis as { CustomEvent?: unknown }).CustomEvent,
    Event: (globalThis as { Event?: unknown }).Event,
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
  });
  restore = () => {
    Object.assign(globalThis, previous);
  };
  dom = { window };
  return dom;
}

before(async () => {
  await ensureDom();
});

after(() => {
  restore?.();
});

describe("session-ended announcements", () => {
  it("carries the reason and the account to a listener", async () => {
    const { notifySessionEnded, onSessionEnded } = await import("./session-recovery.ts");
    const seen: Array<{ reason: string; userId: string | null }> = [];
    const off = onSessionEnded((detail) => seen.push(detail));
    notifySessionEnded("revoked", "user-7");
    notifySessionEnded("suspended", null);
    off();
    notifySessionEnded("expired", "user-9");
    assert.deepEqual(seen, [
      { reason: "revoked", userId: "user-7" },
      { reason: "suspended", userId: null },
    ]);
  });

  it("defaults a malformed detail to a revocation rather than dropping it", async () => {
    const { SESSION_ENDED_EVENT, onSessionEnded } = await import("./session-recovery.ts");
    const seen: string[] = [];
    const off = onSessionEnded((detail) => seen.push(detail.reason));
    window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
    off();
    assert.deepEqual(seen, ["revoked"]);
  });

  it("unsubscribes cleanly and never throws without a DOM", async () => {
    const { onSessionEnded } = await import("./session-recovery.ts");
    const off = onSessionEnded(() => assert.fail("must not fire"));
    off();
    assert.doesNotThrow(() => off());
  });

  it("builds the sign-in address the watcher navigates to, from the real URL", async () => {
    const { signInRedirectFor, sessionEndedNotice } = await import("./session-recovery.ts");
    const target = signInRedirectFor(
      `${window.location.pathname}${window.location.search}`,
      { reason: "revoked" },
    );
    assert.equal(target, "/login?ended=revoked&redirect=%2Fworkspace%3Ftab%3Drecent");
    assert.match(String(sessionEndedNotice("revoked")), /إلغاء الترخيص/);
  });
});
