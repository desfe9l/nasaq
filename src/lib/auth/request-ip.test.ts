/**
 * Rate-limit bucket derivation.
 *
 * The rule under test is the one that used to be wrong in four different
 * places: `x-forwarded-for`'s FIRST entry is caller-supplied, so a client that
 * sent its own header got to choose the bucket its throttle counted against —
 * a fresh budget on every request. The rightmost entry is the one the closest
 * trusted proxy wrote.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { clientIpFromHeaders, rateLimitKey } from "./request-ip.ts";

test("takes the rightmost forwarded entry, not the caller-supplied first one", () => {
  // What a platform proxy produces when the client also sent its own header.
  const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" });
  assert.equal(clientIpFromHeaders(headers), "203.0.113.9");
});

test("a rotating spoofed header cannot move the bucket", () => {
  const seen = new Set<string>();
  for (const spoof of ["1.1.1.1", "2.2.2.2", "8.8.8.8", "9.9.9.9"]) {
    seen.add(clientIpFromHeaders(new Headers({ "x-forwarded-for": `${spoof}, 203.0.113.9` })));
  }
  assert.equal(seen.size, 1);
  assert.deepEqual([...seen], ["203.0.113.9"]);
});

test("a single-value header (direct connection) is still usable", () => {
  assert.equal(clientIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.9" })), "203.0.113.9");
});

test("whitespace, empty segments and IPv6 are tolerated", () => {
  assert.equal(
    clientIpFromHeaders(new Headers({ "x-forwarded-for": " 1.2.3.4 , , 2001:db8::1 " })),
    "2001:db8::1",
  );
  assert.equal(clientIpFromHeaders(new Headers({ "x-forwarded-for": " , " })), "unknown");
});

test("falls back to x-real-ip, then to a stable 'unknown' bucket", () => {
  assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": "203.0.113.9" })), "203.0.113.9");
  assert.equal(clientIpFromHeaders(new Headers()), "unknown");
  assert.equal(clientIpFromHeaders(null), "unknown");
  assert.equal(clientIpFromHeaders(undefined), "unknown");
});

test("an authenticated caller is bucketed by the verified user id", () => {
  /*
   * The user id comes from the session, so no header can rotate it — which is
   * why sensitive limits key on this rather than on an address alone. Two
   * accounts behind one NAT stay separate; one account behind many addresses
   * stays one bucket.
   */
  assert.equal(rateLimitKey("user_1", "203.0.113.9"), "u:user_1");
  assert.equal(rateLimitKey("user_1", "198.51.100.7"), "u:user_1");
  assert.equal(rateLimitKey("user_2", "203.0.113.9"), "u:user_2");
  assert.notEqual(rateLimitKey("user_1", "x"), rateLimitKey("user_2", "x"));
});

test("a signed-out caller falls back to the IP bucket", () => {
  assert.equal(rateLimitKey(null, "203.0.113.9"), "ip:203.0.113.9");
  assert.equal(rateLimitKey(undefined, "203.0.113.9"), "ip:203.0.113.9");
  assert.equal(rateLimitKey("   ", "203.0.113.9"), "ip:203.0.113.9");
  assert.equal(rateLimitKey(null, ""), "ip:unknown");
});

test("the two bucket namespaces cannot collide", () => {
  // A user literally named "203.0.113.9" must not inherit an IP bucket.
  assert.notEqual(rateLimitKey("203.0.113.9", "203.0.113.9"), rateLimitKey(null, "203.0.113.9"));
});
