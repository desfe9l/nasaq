/**
 * Customer data isolation (IDOR) tests.
 *
 * The requirement these encode: customer A must not be able to read or modify
 * customer B's data by supplying B's id. The defence is that every customer-facing
 * query filters on the *verified* user id in SQL, so B's row is indistinguishable
 * from a nonexistent one.
 *
 * These run against a real database with the real migrations, because the
 * guarantee lives in the WHERE clause — not in application-level filtering that a
 * fake database could not contradict.
 *
 * Result values are also asserted explicitly: a function that returned B's row
 * but was "filtered later" would still fail here.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "@/lib/db";
import {
  cancelOwnPaymentRequest,
  createPaymentRequest,
  getOwnPaymentRequest,
  listOwnPaymentRequests,
} from "./payments.server.ts";
import { getAccount } from "./entitlement.server.ts";
import { createTestSql, createUser, giveSubscription } from "./test-db.ts";

let sql: Sql;
let close: () => Promise<void>;

const ALICE = "user-alice";
const BOB = "user-bob";

before(async () => {
  ({ sql, close } = await createTestSql());
  await createUser(sql, { id: ALICE, email: "alice@example.com", name: "Alice" });
  await createUser(sql, { id: BOB, email: "bob@example.com", name: "Bob" });
});

after(async () => {
  await close();
});

/** A PENDING request owned by Bob. */
async function bobRequest(): Promise<string> {
  const request = await createPaymentRequest(sql, {
    userId: BOB,
    planId: "monthly",
    amount: "199.00",
    currency: "SAR",
    paymentMethod: "MANUAL",
    paymentReference: `BOB-${Math.random().toString(36).slice(2)}`,
    customerNote: null,
  });
  return request.id;
}

describe("IDOR: payment requests", () => {
  it("Alice cannot READ Bob's payment request by its id", async () => {
    const id = await bobRequest();

    // Bob can read his own — so the row genuinely exists and the id is valid.
    const bobView = await getOwnPaymentRequest(sql, BOB, id);
    assert.ok(bobView, "precondition: the owner can read their own request");

    // Alice asking for the same id gets nothing at all.
    const aliceView = await getOwnPaymentRequest(sql, ALICE, id);
    assert.equal(aliceView, null, "Alice must not receive Bob's request");
  });

  it("a nonexistent id and another customer's id are indistinguishable", async () => {
    // Returning a distinct error for a real-but-unowned id would leak existence.
    const realButUnowned = await getOwnPaymentRequest(sql, ALICE, await bobRequest());
    const nonexistent = await getOwnPaymentRequest(sql, ALICE, "5c8f0e3a-0000-4000-8000-000000000000");
    assert.equal(realButUnowned, nonexistent);
  });

  it("Alice's list never contains Bob's requests", async () => {
    const bobId = await bobRequest();
    const aliceList = await listOwnPaymentRequests(sql, ALICE);
    assert.ok(
      !aliceList.some((r) => r.id === bobId),
      "Bob's request must not appear in Alice's list",
    );
  });

  it("Alice cannot CANCEL Bob's request", async () => {
    const id = await bobRequest();

    const cancelled = await cancelOwnPaymentRequest(sql, ALICE, id);
    assert.equal(cancelled, false, "the cancel must not match any row");

    // And the row is genuinely untouched — still PENDING and still Bob's.
    const bobView = await getOwnPaymentRequest(sql, BOB, id);
    assert.equal(bobView?.status, "PENDING", "Bob's request must be unaffected");
  });

  it("Bob CAN cancel his own PENDING request", async () => {
    // The positive case, so the test above cannot pass merely because cancelling
    // is broken for everyone.
    const id = await bobRequest();
    assert.equal(await cancelOwnPaymentRequest(sql, BOB, id), true);
    assert.equal((await getOwnPaymentRequest(sql, BOB, id))?.status, "CANCELLED");
  });
});

describe("IDOR: account state", () => {
  it("Alice's account view never reflects Bob's subscription", async () => {
    await giveSubscription(sql, {
      userId: BOB,
      planId: "annual",
      expiresAt: new Date(Date.now() + 86_400_000 * 365).toISOString(),
    });

    const aliceAccount = await getAccount(sql, ALICE);
    assert.equal(aliceAccount.status, "FREE", "Alice has bought nothing");
    assert.equal(aliceAccount.planId, null);
    assert.equal(aliceAccount.expiresAt, null);

    const bobAccount = await getAccount(sql, BOB);
    assert.equal(bobAccount.status, "ACTIVE", "Bob's own access is unaffected");
    assert.equal(bobAccount.planId, "annual");
  });
});

describe("IDOR: entitlement is not grantable by id", () => {
  it("creating a request for yourself cannot attach it to another user", async () => {
    // `createPaymentRequest` takes the user id from the caller (the verified
    // session in production). Passing someone else's id does not let you adopt
    // their account — the row is simply owned by whoever was passed, and the
    // customer-facing readers still scope by the verified id.
    const request = await createPaymentRequest(sql, {
      userId: ALICE,
      planId: "monthly",
      amount: "199.00",
      currency: "SAR",
      paymentMethod: "MANUAL",
      paymentReference: "ALICE-1",
      customerNote: null,
    });

    // Alice can see it; Bob cannot.
    assert.ok(await getOwnPaymentRequest(sql, ALICE, request.id));
    assert.equal(await getOwnPaymentRequest(sql, BOB, request.id), null);
  });
});