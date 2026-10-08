/**
 * A DEPLOYMENT WITH NO IDENTITY STORAGE MUST NOT TAKE THE APP DOWN.
 *
 * This is the regression that cost two production deploys: the previous
 * implementation built its auth instance at module load and asserted there that
 * durable storage was configured, so a runtime with no reachable database threw
 * while the server graph was being evaluated — before a single request could be
 * served. Every page died, not just sign-in.
 *
 * The contract pinned here, under `VERCEL=1` with no R2 and no `NASAQ_PRIMARY_DATABASE_URL`:
 *
 *   1. importing the auth modules does not throw;
 *   2. liveness answers — the deployment is UP;
 *   3. a session read degrades to "signed out" (a public page still renders);
 *   4. a session WRITE fails closed with 503 `AUTH_STORE_UNAVAILABLE`, naming the
 *      missing variables in the log — never a silent success, never a crash;
 *   5. sign-out stays idempotent, because a visitor with no store must still be
 *      able to reach a clean local state.
 *
 * The durable backends themselves are exercised by `first-party-auth.test.ts`
 * (store contracts) and `scripts/auth-e2e.mjs` (a real HTTP server).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

/** Environment variables this file must own to simulate a bare deployment. */
const MANAGED = [
  "VERCEL",
  "NASAQ_STRICT_ENV",
  "NASAQ_PRIMARY_DATABASE_URL",
  "R2_ACCOUNT_ID",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
] as const;

const saved = new Map<string, string | undefined>();

function deployRuntime(): void {
  for (const name of MANAGED) if (!saved.has(name)) saved.set(name, process.env[name]);
  process.env.VERCEL = "1";
  delete process.env.NASAQ_STRICT_ENV;
  for (const name of ["NASAQ_PRIMARY_DATABASE_URL", "R2_ACCOUNT_ID", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
    delete process.env[name];
  }
}

function restore(): void {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
}

type AuthModule = typeof import("./http.server");

async function json(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

describe("deployed runtime with no durable identity store", () => {
  let auth: AuthModule;

  before(async () => {
    deployRuntime();
    // Must not reject: a throw here is the production outage this test exists for.
    auth = await import("./http.server");
  });

  after(restore);

  it("reports the missing storage by NAME, and offers no memory fallback", async () => {
    const { authStoreStatus, isDeployedRuntime } = await import("./store/status");
    assert.equal(isDeployedRuntime(), true);
    const status = authStoreStatus();
    assert.equal(status.configured, false);
    assert.equal(status.kind, null);
    assert.equal(status.durable, false);
    assert.ok(status.missing.some((name) => name.startsWith("R2_ACCOUNT_ID")));
    assert.match(String(status.detail), /never falls back to process memory/i);
  });

  it("imports the configuration report without throwing, and it names the gap", async () => {
    const module = await import("./server");
    // Readable, and honest: sign-in is NOT configured here — but that is a
    // reported state, not a thrown exception. `authConfigured === false` with
    // the deployment still serving is the whole point of this suite.
    assert.equal(typeof module.authConfiguration, "object");
    assert.equal(module.authConfigured, false);
    assert.equal(module.authStorage.kind, null);
    assert.ok(module.authConfiguration.errors.length > 0);
  });

  it("keeps the deployment alive: liveness answers 200", async () => {
    const response = await auth.handleAuthRequest(new Request("http://nasaq.test/api/auth/ok"));
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), { ok: true });
  });

  it("degrades a session READ to signed-out instead of failing the page", async () => {
    const response = await auth.handleAuthRequest(
      new Request("http://nasaq.test/api/auth/get-session"),
    );
    assert.equal(response.status, 200);
    assert.equal(await json(response), null);
  });

  it("fails a session WRITE closed with 503 and an actionable code", async () => {
    const response = await auth.handleAuthRequest(
      new Request("http://nasaq.test/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "visitor@example.com", password: "q7#vN2!pxWz" }),
      }),
    );
    assert.equal(response.status, 503);
    const body = (await json(response)) as { code?: string } | null;
    assert.equal(body?.code, "AUTH_STORE_UNAVAILABLE");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("still answers sign-out truthfully, so no one is stuck signed in locally", async () => {
    const response = await auth.handleAuthRequest(
      new Request("http://nasaq.test/api/auth/sign-out", { method: "POST" }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), { success: true });
    assert.ok(response.headers.getSetCookie().some((cookie) => cookie.includes("Max-Age=0")));
  });

  it("refuses a credentialed POST from a foreign origin before touching storage", async () => {
    const response = await auth.handleAuthRequest(
      new Request("http://nasaq.test/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://attacker.example" },
        body: JSON.stringify({ email: "visitor@example.com", password: "whatever" }),
      }),
    );
    assert.equal(response.status, 403);
    const body = (await json(response)) as { code?: string } | null;
    assert.equal(body?.code, "INVALID_ORIGIN");
  });
});
