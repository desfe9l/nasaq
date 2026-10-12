/**
 * Regression tests for the cross-domain session handoff (nasaq.team ↔ nasaq.work).
 *
 * Covers the security properties the bridge depends on:
 *   · a handoff code is single-use and expires;
 *   · only the SHA-256 of the code is ever stored;
 *   · sibling mapping points each product host at the correct origin;
 *   · the `return` target can never redirect to a foreign site.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createHandoffCode,
  consumeHandoffCode,
  hashHandoffCode,
  handoffReturnTarget,
  siblingOriginFor,
  productOriginFor,
  HANDOFF_TTL_SECONDS,
} from "./handoff.server";
import type { AuthStore, SessionHandoffRecord } from "./store/types";

/** Minimal in-memory store exposing only the handoff surface under test. */
function handoffStore(): AuthStore & {
  handoffs: Map<string, SessionHandoffRecord>;
} {
  const handoffs = new Map<string, SessionHandoffRecord>();
  const notNeeded = () => {
    throw new Error("not needed in this test");
  };
  return {
    kind: "memory-handoff",
    durable: true,
    handoffs,
    createUser: notNeeded,
    findUserByEmail: notNeeded,
    findUserById: notNeeded,
    updateUser: notNeeded,
    deleteUser: notNeeded,
    listUsers: notNeeded,
    createSession: notNeeded,
    findSession: notNeeded,
    updateSession: notNeeded,
    deleteSession: notNeeded,
    deleteUserSessions: notNeeded,
    readThrottle: notNeeded,
    writeThrottle: notNeeded,
    async createSessionHandoff(record: SessionHandoffRecord) {
      handoffs.set(record.codeHash, record);
    },
    async consumeSessionHandoff(codeHash: string) {
      const record = handoffs.get(codeHash);
      if (!record) return null;
      handoffs.delete(codeHash);
      if (Date.parse(record.expiresAt) <= Date.now()) return null;
      return { userId: record.userId, expiresAt: record.expiresAt };
    },
  } as unknown as AuthStore & { handoffs: Map<string, SessionHandoffRecord> };
}

test("a minted handoff code exchanges exactly once", async () => {
  const store = handoffStore();
  const code = await createHandoffCode(store, "user-123");
  assert.ok(code && code.length > 20, "code must be minted");

  const first = await consumeHandoffCode(store, code);
  assert.equal(first, "user-123", "first exchange returns the account");

  const second = await consumeHandoffCode(store, code);
  assert.equal(second, null, "a consumed code cannot be replayed");
});

test("only the SHA-256 of the code is stored, never the code itself", async () => {
  const store = handoffStore();
  const code = await createHandoffCode(store, "user-123");
  assert.ok(code);
  const keys = [...store.handoffs.keys()];
  assert.equal(keys.length, 1);
  assert.equal(keys[0], hashHandoffCode(code!));
  for (const record of store.handoffs.values()) {
    assert.ok(!JSON.stringify(record).includes(code!));
  }
});

test("an expired handoff code is worthless", async () => {
  const store = handoffStore();
  const code = await createHandoffCode(store, "user-123");
  assert.ok(code);
  // Age the record past its TTL directly in the store.
  for (const record of store.handoffs.values()) {
    record.expiresAt = new Date(Date.now() - 1000).toISOString();
  }
  assert.equal(await consumeHandoffCode(store, code), null);
});

test("the TTL is short and bounded", () => {
  assert.ok(HANDOFF_TTL_SECONDS <= 120, "handoff codes must be short-lived");
  assert.ok(HANDOFF_TTL_SECONDS >= 30, "…but long enough to survive a redirect");
});

test("malformed, empty or oversized codes are rejected without throwing", async () => {
  const store = handoffStore();
  assert.equal(await consumeHandoffCode(store, ""), null);
  assert.equal(await consumeHandoffCode(store, null), null);
  assert.equal(await consumeHandoffCode(store, undefined), null);
  assert.equal(await consumeHandoffCode(store, "x".repeat(10_000)), null);
  assert.equal(await consumeHandoffCode(store, "not-a-real-code"), null);
});

test("sibling mapping pairs the product domains and ignores other hosts", () => {
  assert.equal(siblingOriginFor("www.nasaq.team"), "https://nasaq.work");
  assert.equal(siblingOriginFor("nasaq.team"), "https://nasaq.work");
  assert.equal(siblingOriginFor("nasaq.work"), "https://www.nasaq.team");
  assert.equal(siblingOriginFor("www.nasaq.work"), "https://www.nasaq.team");
  assert.equal(siblingOriginFor("nasaq-sa.vercel.app"), "https://nasaq.work");
  assert.equal(siblingOriginFor("evil.example.com"), null);
  assert.equal(siblingOriginFor("localhost"), null);
  assert.equal(siblingOriginFor(""), null);
});

test("product origin mapping resolves each product host", () => {
  assert.equal(productOriginFor("www.nasaq.team"), "https://www.nasaq.team");
  assert.equal(productOriginFor("nasaq.work"), "https://nasaq.work");
  assert.equal(productOriginFor("nasaq-sa.vercel.app"), "https://nasaq-sa.vercel.app");
  assert.equal(productOriginFor("example.com"), null);
});

test("handoff return accepts internal paths and own origins only", () => {
  const here = "https://nasaq.work";
  // Site-internal path resolves against the endpoint's own origin.
  assert.equal(
    handoffReturnTarget("/editor/abc?x=1", here),
    "https://nasaq.work/editor/abc?x=1",
  );
  // Absolute URL on a product origin is allowed.
  assert.equal(
    handoffReturnTarget("https://www.nasaq.team/pricing", here),
    "https://www.nasaq.team/pricing",
  );
  // Foreign origins, protocol-relative tricks and junk fall back safely.
  assert.equal(handoffReturnTarget("https://evil.example.com/x", here), "/");
  assert.equal(handoffReturnTarget("//evil.example.com/x", here), "/");
  assert.equal(handoffReturnTarget("javascript:alert(1)", here), "/");
  assert.equal(handoffReturnTarget("", here), "/");
  assert.equal(handoffReturnTarget(null, here, "/workspace"), "/workspace");
});
