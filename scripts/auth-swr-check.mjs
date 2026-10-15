#!/usr/bin/env node
/**
 * Stale-While-Revalidate auth verification — the REAL client module, no browser.
 *
 * `session-store.test.ts` proves the rules against a fake store;
 * `auth-e2e.mjs` proves the HTTP endpoints. What neither can show is that
 * `src/lib/auth/client.ts` — the module the app actually runs — wires them
 * together: that a cached session paints before any request, that the page load
 * with a cache issues no request at all until the background probe fires, that
 * the probe is shared by every subscriber, and that a server which disowns the
 * session clears this browser and announces it.
 *
 * HOW IT RUNS WITHOUT A BROWSER
 *   Vite is started in middleware (SSR) mode and asked to load the module, which
 *   is what supplies `import.meta.env` and the `@/…` alias. A jsdom window
 *   supplies `window`, `document`, `localStorage` and `sessionStorage`, and
 *   `fetch` is stubbed to answer `/api/auth/*` — so the module under test is the
 *   shipped one, running its real code paths.
 *
 * Usage: npm run test:auth:swr      (exit 0 = every step passed)
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "vite";

const nodeRequire = createRequire(import.meta.url);
const { JSDOM } = nodeRequire("jsdom");

const CACHE_KEY = "nasaq.auth.session.v1";
const SESSION_ENDED_EVENT = "nasaq:session-ended";

let passed = 0;
const failures = [];
async function step(label, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failures.push({ label, error });
    console.error(`  ✗ ${label}\n      ${error?.message ?? error}`);
  }
}

// ── A browser-shaped environment ─────────────────────────────────────────────

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://nasaq.team/workspace?tab=recent",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
/*
 * Node 22 exposes a read-only `navigator` that has no `onLine`, so it is defined
 * here with one: `storage-owner-sync` reads `navigator.onLine === false` to
 * decide whether it may open the remembered library, and `undefined` would
 * silently mean "online" rather than exercising the offline branch.
 */
if (typeof globalThis.navigator?.onLine !== "boolean") {
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true, userAgent: "nasaq-auth-swr-check" },
    configurable: true,
  });
}
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
/*
 * jsdom's `Location.assign` is read-only, and this check never mounts the root
 * `SessionWatch` (it is a React component) — a redirect is observed through the
 * `nasaq:session-ended` announcement it reacts to, plus the pure
 * `signInRedirectFor` decision that `session-recovery.test.ts` pins.
 */

const USER = {
  id: "user-swr",
  name: "فيصل العنزي",
  email: "swr@example.com",
  emailVerified: true,
  image: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const SESSION = {
  id: "session-swr",
  userId: USER.id,
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
};
const signedInPayload = { user: USER, session: SESSION };

/** Answers `/api/auth/*` from a mutable script the test drives. */
const transport = { session: signedInPayload, calls: 0, failWith: null, delayMs: 0 };
globalThis.fetch = async (path, init = {}) => {
  const url = String(path);
  if (init.method === "POST" && url.endsWith("/sign-out")) {
    transport.session = null;
    return new Response(null, { status: 200 });
  }
  if (!url.includes("/get-session")) {
    return new Response(JSON.stringify({ message: `unstubbed ${url}` }), { status: 404 });
  }
  transport.calls += 1;
  if (transport.delayMs) await new Promise((resolve) => setTimeout(resolve, transport.delayMs));
  if (transport.failWith) return new Response(null, { status: transport.failWith });
  return new Response(JSON.stringify(transport.session), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

// ── The app's own module, through Vite ───────────────────────────────────────

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  logLevel: "silent",
  server: { middlewareMode: true },
  resolve: { alias: { "@": `${process.cwd()}/src` } },
  // The shipped flag: sign-in enabled.
  define: { "import.meta.env.VITE_AUTH_ENABLED": JSON.stringify("true") },
});
const clientUrl = "/src/lib/auth/client.ts";
/** Each "page load" gets a fresh module instance, sharing the same storage. */
let loadCount = 0;
const loadClient = async () => {
  loadCount += 1;
  return server.ssrLoadModule(loadCount === 1 ? clientUrl : `${clientUrl}?page=${loadCount}`);
};

try {
  console.log("[auth-swr] jsdom + vite ssr module loader");

  await step("a signed-out visitor starts pending, and the probe resolves it", async () => {
    transport.session = null;
    const mod = await loadClient();
    assert.deepEqual(mod.getSessionSnapshot(), { data: null, isPending: true });
    await mod.revalidateSession();
    assert.deepEqual(mod.getSessionSnapshot(), { data: null, isPending: false });
    assert.equal(dom.window.localStorage.getItem(CACHE_KEY), null);
  });

  await step("a confirmed session is persisted for the NEXT page load", async () => {
    transport.session = signedInPayload;
    const mod = await loadClient();
    await mod.revalidateSession({ force: true });
    assert.equal(mod.getSessionSnapshot().data?.user.id, USER.id);
    const cached = JSON.parse(dom.window.localStorage.getItem(CACHE_KEY) ?? "null");
    assert.equal(cached?.payload?.user?.id, USER.id);
    assert.equal(typeof cached?.savedAt, "number");
  });

  await step("a reload with a cached session paints signed-in with NO request yet", async () => {
    const before = transport.calls;
    const mod = await loadClient();
    const snapshot = mod.getSessionSnapshot();
    assert.equal(snapshot.isPending, false, "the UI must not be pending");
    assert.equal(snapshot.data?.user.id, USER.id, "the cached account must be rendered");
    assert.equal(transport.calls, before, "no request may be needed to paint");
    // Subscribing (what React does on mount) fires the background probe.
    await mod.revalidateSession();
    assert.ok(transport.calls > before, "the background revalidation must run");
    assert.equal(mod.getSessionSnapshot().data?.user.id, USER.id);
  });

  await step("an agreeing revalidation notifies no subscriber (no flicker)", async () => {
    transport.session = { ...signedInPayload };
    const mod = await loadClient();
    const snapshotBefore = mod.getSessionSnapshot();
    await mod.revalidateSession({ force: true });
    // The store publishes a new snapshot object ONLY when something changed, so
    // an agreeing answer leaves React with nothing to re-render.
    assert.equal(
      mod.getSessionSnapshot(),
      snapshotBefore,
      "an agreeing revalidation must not replace the snapshot",
    );
  });

  await step("a failed request never signs the visitor out", async () => {
    transport.session = signedInPayload;
    const mod = await loadClient();
    await mod.revalidateSession({ force: true });
    transport.failWith = 503;
    await mod.revalidateSession({ force: true });
    assert.equal(mod.getSessionSnapshot().data?.user.id, USER.id, "503 must not sign anyone out");
    assert.ok(dom.window.localStorage.getItem(CACHE_KEY), "the cache must survive a 503");
    transport.failWith = null;
  });

  await step("a disowned session clears the browser and announces the revocation", async () => {
    const events = [];
    const onEnded = (event) => events.push(event.detail);
    dom.window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    transport.session = null;
    const mod = await loadClient();
    await mod.revalidateSession({ force: true });
    assert.equal(events.length, 1, "exactly one announcement");
    assert.equal(events[0]?.userId, USER.id);
    assert.equal(mod.getSessionSnapshot().data, null);
    assert.equal(dom.window.localStorage.getItem(CACHE_KEY), null, "the cache must be dropped");
    dom.window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  });

  await step("sign-out clears the stored session so the next load waits, not lies", async () => {
    transport.session = signedInPayload;
    const mod = await loadClient();
    await mod.revalidateSession({ force: true });
    assert.ok(dom.window.localStorage.getItem(CACHE_KEY));
    await mod.revokeSession();
    assert.equal(dom.window.localStorage.getItem(CACHE_KEY), null);
    assert.equal(mod.getSessionSnapshot().data, null);
  });

  await step("two consumers share ONE /get-session request (navigation costs nothing)", async () => {
    transport.session = signedInPayload;
    const mod = await loadClient();
    await mod.revalidateSession({ force: true });
    const before = transport.calls;
    await Promise.all([mod.revalidateSession(), mod.revalidateSession({ force: true })]);
    assert.equal(transport.calls - before, 1, "concurrent probes must coalesce");
    await mod.revalidateSession();
    assert.equal(transport.calls - before, 1, "a probe inside the freshness window is skipped");
  });
} finally {
  await server.close();
  dom.window.close();
}

console.log(`[auth-swr] ${passed} steps passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.error(`  - ${failure.label}: ${failure.error?.message}`);
  process.exit(1);
}
process.exit(0);
