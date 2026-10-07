/**
 * Pre-migration account continuity — the regression behind "the owner lost the
 * admin console after the first-party auth migration".
 *
 * Every account (and every role, licence, subscription and stored file keyed by
 * its id) was created under Better Auth. The first-party store started empty,
 * so the original holder's password stopped working and signing up again
 * minted a NEW id — detaching the owner from `NASAQ_OWNER_ID` and from their
 * `admin_users` SUPER_ADMIN row. These tests pin the repair against the real R2
 * AuthStore implementation (backed by an in-memory bucket):
 *
 *   · the old password adopts the account under its ORIGINAL id;
 *   · a wrong old password, or someone else's sign-up, never does;
 *   · an address re-registered after the cutover is relinked to the original
 *     account only on proof (old password / provider-verified address);
 *   · deployments with no legacy data behave exactly as before.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";

import { createR2AuthStore } from "./store/r2";
import type { ObjectStorageProvider } from "@/lib/storage/provider";
import {
  combineLegacySources,
  findInLegacyState,
  verifyLegacyPasswordHash,
  type LegacyAccount,
  type LegacyAccountSource,
} from "./legacy-accounts.server";
import {
  signInWithExternalIdentity,
  signInWithPassword,
  signUpWithPassword,
  resolveSession,
} from "./service.server";

/** Exactly Better Auth ≤1.6's credential hash format. */
function betterAuthHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(password.normalize("NFKC"), salt, 64, {
    N: 16384,
    r: 16,
    p: 1,
    maxmem: 128 * 16384 * 16 * 2,
  });
  return `${salt}:${key.toString("hex")}`;
}

function memoryBucket(): ObjectStorageProvider {
  const objects = new Map<string, Uint8Array>();
  return {
    name: "memory",
    async put(key, body) {
      objects.set(key, body);
    },
    async putIfAbsent(key, body) {
      if (objects.has(key)) return false;
      objects.set(key, body);
      return true;
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async delete(key) {
      objects.delete(key);
    },
    async signedGetUrl(key) {
      return `memory://${key}`;
    },
    async list(prefix: string, limit: number) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix)).slice(0, limit);
    },
  } as ObjectStorageProvider;
}

const LEGACY_PASSWORD = "Original-Passw0rd!";
const OWNER_ID = "Lg0wnerAbCdEfGhIjKlMnOpQrStUv01";

function legacySource(accounts: LegacyAccount[]): LegacyAccountSource {
  return {
    async findByEmail(email) {
      return accounts.find((account) => account.email === email) ?? null;
    },
  };
}

function legacyOwner(overrides: Partial<LegacyAccount> = {}): LegacyAccount {
  return {
    id: OWNER_ID,
    email: "owner@example.com",
    name: "Owner",
    emailVerified: false,
    image: null,
    createdAt: "2026-01-02T03:04:05.000Z",
    passwordHash: betterAuthHash(LEGACY_PASSWORD),
    source: "postgres",
    ...overrides,
  };
}

const ctx = { ip: "203.0.113.7", userAgent: "test" };

describe("Better Auth credential hashes", () => {
  it("verifies the right password and rejects everything else", async () => {
    const hash = betterAuthHash(LEGACY_PASSWORD);
    assert.equal(await verifyLegacyPasswordHash(hash, LEGACY_PASSWORD), true);
    assert.equal(await verifyLegacyPasswordHash(hash, "Original-Passw0rd"), false);
    assert.equal(await verifyLegacyPasswordHash(hash, ""), false);
    assert.equal(await verifyLegacyPasswordHash(null, LEGACY_PASSWORD), false);
    assert.equal(await verifyLegacyPasswordHash("not-a-hash", LEGACY_PASSWORD), false);
    // An Argon2 PHC string is not a legacy hash — no cross-format confusion.
    assert.equal(await verifyLegacyPasswordHash("$argon2id$v=19$m=19456,t=2,p=1$abc$def", LEGACY_PASSWORD), false);
  });

  it("reads the Better Auth R2 adapter state document", () => {
    const state = {
      tables: {
        user: [{ id: "u1", email: "Someone@Example.com", name: "S", emailVerified: true, createdAt: "2026-10-06T00:00:00.000Z" }],
        account: [
          { userId: "u1", providerId: "google", accountId: "sub" },
          { userId: "u1", providerId: "credential", password: "aa:bb" },
        ],
      },
    };
    const found = findInLegacyState(state, "someone@example.com");
    assert.equal(found?.id, "u1");
    assert.equal(found?.emailVerified, true);
    assert.equal(found?.passwordHash, "aa:bb");
    assert.equal(found?.source, "r2");
    assert.equal(findInLegacyState(state, "other@example.com"), null);
    assert.equal(findInLegacyState(null, "someone@example.com"), null);
  });

  it("asks sources in order and normalizes the address", async () => {
    const seen: string[] = [];
    const first: LegacyAccountSource = { findByEmail: async (email) => (seen.push(email), null) };
    const second = legacySource([legacyOwner()]);
    const combined = combineLegacySources(first, second);
    assert.equal((await combined.findByEmail("  OWNER@example.com "))?.id, OWNER_ID);
    assert.deepEqual(seen, ["owner@example.com"]);
  });
});

describe("pre-migration account adoption", () => {
  it("the old password signs in under the ORIGINAL id (roles stay attached)", async () => {
    const store = createR2AuthStore(memoryBucket());
    const legacy = legacySource([legacyOwner()]);
    const result = await signInWithPassword(
      store,
      { email: "owner@example.com", password: LEGACY_PASSWORD, ...ctx },
      new Date(),
      { legacy },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.user.id, OWNER_ID);
    const stored = await store.findUserById(OWNER_ID);
    assert.ok(stored?.passwordHash?.startsWith("$argon2id$"), "rehashed to Argon2id on adoption");
    assert.equal(stored?.createdAt, "2026-01-02T03:04:05.000Z");
    const session = await resolveSession(store, result.value.token);
    assert.equal(session.ok && session.value?.user.id, OWNER_ID);

    // Second sign-in: the account is now a normal first-party account.
    const again = await signInWithPassword(store, { email: "owner@example.com", password: LEGACY_PASSWORD, ...ctx }, new Date(), { legacy });
    assert.equal(again.ok && again.value.user.id, OWNER_ID);
  });

  it("a wrong old password is the same INVALID answer and adopts nothing", async () => {
    const store = createR2AuthStore(memoryBucket());
    const result = await signInWithPassword(
      store,
      { email: "owner@example.com", password: "Wrong-Passw0rd!!", ...ctx },
      new Date(),
      { legacy: legacySource([legacyOwner()]) },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, "INVALID_EMAIL_OR_PASSWORD");
    assert.equal(result.failure.status, 401);
    assert.equal(await store.findUserById(OWNER_ID), null);
    assert.equal(await store.findUserByEmail("owner@example.com"), null);
  });

  it("sign-up cannot take a pre-migration address with a different password", async () => {
    const store = createR2AuthStore(memoryBucket());
    const result = await signUpWithPassword(
      store,
      { email: "owner@example.com", password: "Squatter-Passw0rd!", name: "x", ...ctx },
      new Date(),
      { legacy: legacySource([legacyOwner()]) },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, "USER_ALREADY_EXISTS");
    assert.equal(await store.findUserByEmail("owner@example.com"), null);
  });

  it("sign-up with the original password restores the original account instead of minting a new id", async () => {
    const store = createR2AuthStore(memoryBucket());
    const result = await signUpWithPassword(
      store,
      { email: "owner@example.com", password: LEGACY_PASSWORD, name: "Owner", ...ctx },
      new Date(),
      { legacy: legacySource([legacyOwner()]) },
    );
    assert.equal(result.ok && result.value.user.id, OWNER_ID);
  });

  it("an address re-registered after the cutover with the SAME password is relinked to the original id", async () => {
    const store = createR2AuthStore(memoryBucket());
    // Post-cutover, no legacy source yet: a fresh random id (the bug's state).
    const fresh = await signUpWithPassword(store, { email: "owner@example.com", password: LEGACY_PASSWORD, name: "Owner", ...ctx });
    assert.equal(fresh.ok, true);
    if (!fresh.ok) return;
    const newId = fresh.value.user.id;
    assert.notEqual(newId, OWNER_ID);

    const result = await signInWithPassword(
      store,
      { email: "owner@example.com", password: LEGACY_PASSWORD, ...ctx },
      new Date(),
      { legacy: legacySource([legacyOwner()]) },
    );
    assert.equal(result.ok && result.value.user.id, OWNER_ID);
    assert.equal((await store.findUserByEmail("owner@example.com"))?.id, OWNER_ID);
    // The post-cutover account is detached, not deleted, and its sessions die.
    const detached = await store.findUserById(newId);
    assert.ok(detached, "kept for recovery");
    assert.match(detached!.email, /@legacy\.invalid$/);
    const oldSession = await resolveSession(store, fresh.value.token);
    assert.equal(oldSession.ok && oldSession.value, null);
  });

  it("a squatter's post-cutover password does not unlock the original account, the original password does", async () => {
    const store = createR2AuthStore(memoryBucket());
    const squat = await signUpWithPassword(store, { email: "owner@example.com", password: "Squatter-Passw0rd!", name: "x", ...ctx });
    assert.equal(squat.ok, true);
    const legacy = legacySource([legacyOwner()]);

    const asSquatter = await signInWithPassword(store, { email: "owner@example.com", password: "Squatter-Passw0rd!", ...ctx }, new Date(), { legacy });
    assert.equal(asSquatter.ok, true);
    assert.notEqual(asSquatter.ok && asSquatter.value.user.id, OWNER_ID, "the squatter never becomes the original account");

    const asOwner = await signInWithPassword(store, { email: "owner@example.com", password: LEGACY_PASSWORD, ...ctx }, new Date(), { legacy });
    assert.equal(asOwner.ok && asOwner.value.user.id, OWNER_ID);
    const afterwards = await signInWithPassword(store, { email: "owner@example.com", password: "Squatter-Passw0rd!", ...ctx }, new Date(), { legacy });
    assert.equal(afterwards.ok, false, "the squatter's password no longer opens the address");
  });

  it("a provider-VERIFIED address adopts the original account; an unverified one does not", async () => {
    const legacy = legacySource([legacyOwner()]);
    const verifiedStore = createR2AuthStore(memoryBucket());
    const verified = await signInWithExternalIdentity(
      verifiedStore,
      { providerId: "google", subject: "g-1", email: "owner@example.com", emailVerified: true, name: "Owner", ...ctx },
      new Date(),
      { legacy },
    );
    assert.equal(verified.ok && verified.value.user.id, OWNER_ID);
    assert.equal(verified.ok && verified.value.user.emailVerified, true);

    // Adopted through Google, the original password still works afterwards.
    const byPassword = await signInWithPassword(verifiedStore, { email: "owner@example.com", password: LEGACY_PASSWORD, ...ctx }, new Date(), { legacy });
    assert.equal(byPassword.ok && byPassword.value.user.id, OWNER_ID);

    const unverifiedStore = createR2AuthStore(memoryBucket());
    const unverified = await signInWithExternalIdentity(
      unverifiedStore,
      { providerId: "google", subject: "g-2", email: "owner@example.com", emailVerified: false, name: "x", ...ctx },
      new Date(),
      { legacy },
    );
    assert.equal(unverified.ok, true);
    assert.notEqual(unverified.ok && unverified.value.user.id, OWNER_ID);
  });

  it("without a legacy source nothing changes (fresh deployments, tests, the gate path)", async () => {
    const store = createR2AuthStore(memoryBucket());
    const created = await signUpWithPassword(store, { email: "owner@example.com", password: LEGACY_PASSWORD, name: "Owner", ...ctx });
    assert.equal(created.ok, true);
    assert.notEqual(created.ok && created.value.user.id, OWNER_ID);
    const unknown = await signInWithPassword(store, { email: "nobody@example.com", password: LEGACY_PASSWORD, ...ctx });
    assert.equal(!unknown.ok && unknown.failure.code, "INVALID_EMAIL_OR_PASSWORD");
  });

  it("an account whose mirror row is in the legacy table is not treated as a second identity", async () => {
    const store = createR2AuthStore(memoryBucket());
    const created = await signUpWithPassword(store, { email: "user@example.com", password: LEGACY_PASSWORD, name: "U", ...ctx });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    // The `"user"` projection of the SAME account (same id, no credential row).
    const mirror = legacySource([legacyOwner({ id: created.value.user.id, email: "user@example.com", passwordHash: null })]);
    const result = await signInWithPassword(store, { email: "user@example.com", password: LEGACY_PASSWORD, ...ctx }, new Date(), { legacy: mirror });
    assert.equal(result.ok && result.value.user.id, created.value.user.id);
  });
});
