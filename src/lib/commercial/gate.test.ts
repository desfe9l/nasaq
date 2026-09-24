/**
 * The entitlement gate must FAIL CLOSED.
 *
 * This is a regression test for a real defect: `requireActiveEntitlement` once
 * returned `{ active: false }` instead of throwing. Because the name reads as a
 * guard, the natural call —
 *
 *     await requireActiveEntitlement(sql, userId);
 *     // …do the paid thing
 *
 * — compiled fine and granted FREE users access. Nothing about the call site
 * looked wrong. These tests pin the fail-closed behaviour so the trap cannot
 * return, and they assert on the ERROR TYPE, because "threw something" would
 * also pass if the function broke for an unrelated reason.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "@/lib/db";
import {
  EntitlementRequiredError,
  getAccount,
  requireActiveEntitlement,
} from "./entitlement.server.ts";
import { createTestSql, createUser, giveSubscription } from "./test-db.ts";

let sql: Sql;
let close: () => Promise<void>;

const FREE_USER = "gate-free";
const ACTIVE_USER = "gate-active";
const EXPIRED_USER = "gate-expired";
const SUSPENDED_USER = "gate-suspended";

before(async () => {
  ({ sql, close } = await createTestSql());
  for (const id of [FREE_USER, ACTIVE_USER, EXPIRED_USER, SUSPENDED_USER]) {
    await createUser(sql, { id, email: `${id}@example.com` });
  }
  await giveSubscription(sql, {
    userId: ACTIVE_USER,
    expiresAt: new Date(Date.now() + 86_400_000 * 30).toISOString(),
  });
  await giveSubscription(sql, {
    userId: EXPIRED_USER,
    status: "EXPIRED",
    expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
  });
  await giveSubscription(sql, {
    userId: SUSPENDED_USER,
    status: "SUSPENDED",
    expiresAt: new Date(Date.now() + 86_400_000 * 30).toISOString(),
  });
});

after(async () => {
  await close();
});

describe("requireActiveEntitlement fails closed", () => {
  it("THROWS for a FREE customer — never returns a falsy flag", async () => {
    await assert.rejects(
      () => requireActiveEntitlement(sql, FREE_USER),
      (err: unknown) => {
        assert.ok(
          err instanceof EntitlementRequiredError,
          "must throw EntitlementRequiredError, not resolve with a flag",
        );
        assert.equal(err.status, 402, "402 so the UI can prompt for payment");
        assert.equal(err.accountStatus, "FREE");
        return true;
      },
    );
  });

  it("THROWS for a lapsed subscription", async () => {
    await assert.rejects(
      () => requireActiveEntitlement(sql, EXPIRED_USER),
      EntitlementRequiredError,
    );
  });

  it("THROWS for a suspended subscription even though the period is live", async () => {
    await assert.rejects(
      () => requireActiveEntitlement(sql, SUSPENDED_USER),
      (err: unknown) => {
        assert.ok(err instanceof EntitlementRequiredError);
        assert.equal(err.accountStatus, "SUSPENDED");
        return true;
      },
    );
  });

  it("THROWS for a user that does not exist at all", async () => {
    // An unknown id must not slip through as "no subscription = fine".
    await assert.rejects(
      () => requireActiveEntitlement(sql, "no-such-user"),
      EntitlementRequiredError,
    );
  });

  it("RESOLVES and returns the account for an active customer", async () => {
    // The positive case — otherwise every test above would pass on a function
    // that simply always threw.
    const account = await requireActiveEntitlement(sql, ACTIVE_USER);
    assert.equal(account.status, "ACTIVE");
    assert.ok(account.expiresAt);
  });

  it("is safe to use as a bare statement before a paid operation", async () => {
    // The exact pattern that was broken: call it, then proceed. A FREE user must
    // not reach the code after the call.
    let reachedPaidCode = false;
    try {
      await requireActiveEntitlement(sql, FREE_USER);
      reachedPaidCode = true;
    } catch {
      // expected
    }
    assert.equal(reachedPaidCode, false, "FREE user must never reach paid code");
  });
});

describe("getAccount stays readable without gating", () => {
  it("reports FREE without throwing, so the dashboard can offer a plan", async () => {
    // The counterpart to the gate: reading your own state is not a paid feature.
    const account = await getAccount(sql, FREE_USER);
    assert.equal(account.status, "FREE");
  });

  it("reports the dev fallback user (no \"user\" row) without error", async () => {
    // `dev-user` has no row in "user"; a join that required one would break here.
    const account = await getAccount(sql, "dev-user");
    assert.equal(account.status, "FREE");
    assert.equal(account.planId, null);
  });
});