#!/usr/bin/env node
/**
 * Real account-flow verification against a RUNNING server (dev or preview).
 *
 * This is the check that a build cannot give you: it signs up over HTTP, reads
 * the session back, exercises a protected server route with and without the
 * cookie, signs out, and proves the session is gone. Everything here talks to
 * the real Better Auth handler and the real session cookie — no mocks, no
 * in-process shortcuts.
 *
 * Usage:
 *   npm run dev                      # in one terminal
 *   npm run test:auth:e2e            # in another (AUTH_E2E_BASE to override)
 *
 * Exit 0 = every step passed, 1 = a step failed, 2 = server unreachable.
 */
import assert from "node:assert/strict";

const base = (
  process.env.AUTH_E2E_BASE ??
  process.argv.find((arg) => arg.startsWith("--base="))?.slice("--base=".length) ??
  "http://127.0.0.1:8080"
).replace(/\/+$/, "");

const origin = new URL(base).origin;
const run = Date.now().toString(36);
const email = `e2e-${run}@example.com`;
const password = "Sup3rSecret!23";
const name = "مستخدم التحقق";

let passed = 0;
const failures = [];

function step(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${label}`);
    })
    .catch((error) => {
      failures.push({ label, error });
      console.error(`  ✗ ${label}\n      ${error?.message ?? error}`);
    });
}

/** Extract the session cookie pair from a response, or null. */
function sessionCookie(response) {
  const cookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  const token = cookies.find((cookie) => cookie.includes("session_token="));
  if (!token) return null;
  return token.split(";")[0];
}

async function postAuth(path, body, { cookie, originHeader = origin } = {}) {
  const headers = { "content-type": "application/json" };
  if (originHeader) headers.origin = originHeader;
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}/api/auth/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error page — the assertions below use the status */
  }
  return { response, json, text };
}

async function main() {
  console.log(`[auth-e2e] ${base}`);
  try {
    const ping = await fetch(`${base}/api/auth/ok`);
    if (!ping.ok) throw new Error(`GET /api/auth/ok → ${ping.status}`);
  } catch (error) {
    console.error(
      `[auth-e2e] the server is not reachable at ${base} — start it with \`npm run dev\`.\n          ${error?.message ?? error}`,
    );
    process.exit(2);
  }

  let cookie = null;

  await step("create an account with email + password", async () => {
    const { response, json } = await postAuth("sign-up/email", { email, password, name });
    assert.equal(response.status, 200, `expected 200, got ${response.status}`);
    assert.ok(json?.user?.id, "the response must carry the created user id");
    assert.equal(json.user.email, email);
    const set = sessionCookie(response);
    assert.ok(set, "sign-up must set a session cookie (autoSignIn)");
    cookie = set;
  });

  await step("the session survives a reload (server reads it back)", async () => {
    assert.ok(cookie, "no session cookie to send");
    const response = await fetch(`${base}/api/auth/get-session`, {
      headers: { cookie },
    });
    assert.equal(response.status, 200);
    const session = await response.json();
    assert.ok(session?.user?.id, "get-session must resolve the account");
    assert.equal(session.user.email, email);
    assert.ok(session.session?.expiresAt, "the session row must carry an expiry");
  });

  await step("a duplicate sign-up is refused, not silently merged", async () => {
    const { response, json } = await postAuth("sign-up/email", { email, password, name });
    assert.notEqual(response.status, 200, "a second account on the same email must fail");
    assert.match(
      String(json?.code ?? json?.message ?? ""),
      /USER_ALREADY_EXISTS|already exists/i,
    );
  });

  await step("a wrong password is refused with a clear error", async () => {
    const { response, json } = await postAuth("sign-in/email", {
      email,
      password: "definitely-not-the-password",
    });
    assert.equal(response.status, 401);
    assert.match(String(json?.code ?? json?.message ?? ""), /INVALID_EMAIL_OR_PASSWORD|invalid/i);
  });

  await step("a credentialed POST from an untrusted origin is rejected", async () => {
    const { response } = await postAuth(
      "sign-in/email",
      { email, password },
      { originHeader: "https://evil.example.com" },
    );
    assert.equal(response.status, 403, "trustedOrigins must reject a foreign origin");
  });

  await step("sign-in creates a session for a fresh client", async () => {
    const { response, json } = await postAuth("sign-in/email", { email, password });
    assert.equal(response.status, 200);
    assert.ok(json?.user?.id, "sign-in must return the account");
    const set = sessionCookie(response);
    assert.ok(set, "sign-in must set a session cookie");
    cookie = set;
  });

  await step("a protected server route accepts the authenticated caller", async () => {
    const response = await fetch(`${base}/api/license/validate`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie },
      body: JSON.stringify({ key: "NASAQ-AAAA-BBBB-CCCC-DDDD" }),
    });
    // 400 = the session was verified and the key was judged invalid. A 401 here
    // would mean the server could not see a valid session — the bug this whole
    // flow exists to catch.
    assert.equal(response.status, 400, `expected the session to be accepted, got ${response.status}`);
  });

  await step("the same route rejects an unauthenticated caller", async () => {
    const response = await fetch(`${base}/api/license/validate`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ key: "NASAQ-AAAA-BBBB-CCCC-DDDD" }),
    });
    assert.equal(response.status, 401);
  });

  await step("sign-out ends the session server-side", async () => {
    assert.ok(cookie, "no session cookie to sign out with");
    const { response } = await postAuth("sign-out", {}, { cookie });
    assert.equal(response.status, 200);
    const after = await fetch(`${base}/api/auth/get-session`, {
      headers: { cookie },
    });
    assert.equal(after.status, 200);
    assert.equal(await after.json(), null, "the old cookie must no longer resolve a session");
  });

  console.log(
    failures.length
      ? `[auth-e2e] ${passed} passed, ${failures.length} failed`
      : `[auth-e2e] all ${passed} steps passed`,
  );
  process.exit(failures.length ? 1 : 0);
}

await main();
