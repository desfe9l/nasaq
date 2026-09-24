/**
 * Entitlement state-machine tests.
 *
 * The entitlement engine is the single place account status is decided, so its
 * pure logic is tested directly — no database, no mocks of our own code. These
 * cases are the ones that silently break access if they regress:
 *
 *   - the expiry boundary (a customer must not lose access early, nor keep it late)
 *   - SUSPENDED outranking the clock
 *   - renewal-before-expiry ADDING to the remaining time
 *   - a lapsed renewal cycle not masking a currently-suspended account
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeExpiry,
  daysRemaining,
  deriveStatus,
  isExpired,
} from "./entitlement.server.ts";

type Sub = {
  id: string;
  user_id: string;
  plan_id: string;
  status: "ACTIVE" | "EXPIRED" | "SUSPENDED";
  activated_at: string;
  expires_at: string;
  suspended_at: string | null;
};

function sub(over: Partial<Sub> = {}): Sub {
  return {
    id: "sub-1",
    user_id: "user-a",
    plan_id: "monthly",
    status: "ACTIVE",
    activated_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2026-01-31T00:00:00.000Z",
    suspended_at: null,
    ...over,
  };
}

describe("isExpired", () => {
  it("is false one millisecond before the expiry", () => {
    const expiry = "2026-01-31T00:00:00.000Z";
    assert.equal(isExpired(expiry, new Date("2026-01-30T23:59:59.999Z")), false);
  });

  it("is false exactly AT the expiry (the boundary belongs to the customer)", () => {
    const expiry = "2026-01-31T00:00:00.000Z";
    assert.equal(isExpired(expiry, new Date("2026-01-31T00:00:00.000Z")), false);
  });

  it("is true one millisecond after the expiry", () => {
    const expiry = "2026-01-31T00:00:00.000Z";
    assert.equal(isExpired(expiry, new Date("2026-01-31T00:00:00.001Z")), true);
  });

  it("accepts a Date as well as an ISO string", () => {
    assert.equal(
      isExpired(new Date("2026-01-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z")),
      true,
    );
  });
});

describe("daysRemaining", () => {
  it("rounds up so a customer with hours left does not see 0 days", () => {
    const now = new Date("2026-01-30T04:00:00.000Z"); // 20 hours left
    assert.equal(daysRemaining("2026-01-31T00:00:00.000Z", now), 1);
  });

  it("reports 0 (never negative) once expired", () => {
    const now = new Date("2026-02-05T00:00:00.000Z");
    assert.equal(daysRemaining("2026-01-31T00:00:00.000Z", now), 0);
  });

  it("counts whole days exactly", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    assert.equal(daysRemaining("2026-01-31T00:00:00.000Z", now), 30);
  });
});

describe("deriveStatus", () => {
  it("is FREE when there is no entitlement at all", () => {
    assert.equal(deriveStatus(null, new Date("2026-01-01T00:00:00Z")), "FREE");
  });

  it("is ACTIVE before the expiry", () => {
    assert.equal(
      deriveStatus(sub(), new Date("2026-01-15T00:00:00Z")),
      "ACTIVE",
    );
  });

  it("is EXPIRED after the expiry even though the stored status still says ACTIVE", () => {
    // This is the whole point of deriving rather than trusting the column: no
    // sweeper has to run for access to lapse correctly.
    assert.equal(
      deriveStatus(sub(), new Date("2026-02-01T00:00:00Z")),
      "EXPIRED",
    );
  });

  it("reports SUSPENDED even while the period is still live", () => {
    // An admin's decision must not be undone by the clock.
    assert.equal(
      deriveStatus(sub({ status: "SUSPENDED" }), new Date("2026-01-15T00:00:00Z")),
      "SUSPENDED",
    );
  });

  it("reports SUSPENDED even after the period lapses", () => {
    // A lapsed cycle must not mask a suspension — otherwise an indefinitely
    // suspended customer would look merely expired and could renew straight past it.
    assert.equal(
      deriveStatus(sub({ status: "SUSPENDED" }), new Date("2026-03-01T00:00:00Z")),
      "SUSPENDED",
    );
  });

  it("reports EXPIRED for a row explicitly marked EXPIRED", () => {
    assert.equal(
      deriveStatus(sub({ status: "EXPIRED" }), new Date("2026-01-15T00:00:00Z")),
      "EXPIRED",
    );
  });
});

describe("computeExpiry", () => {
  const now = new Date("2026-01-15T00:00:00.000Z");

  it("starts from now for a first purchase", () => {
    const expires = computeExpiry(30, null, now);
    assert.equal(expires.toISOString(), "2026-02-14T00:00:00.000Z");
  });

  it("extends from the EXISTING expiry when renewing before it lapses", () => {
    // Renewing early must not throw away the remaining days the customer paid for.
    const current = sub({ expires_at: "2026-02-01T00:00:00.000Z" });
    const expires = computeExpiry(30, current, now);
    assert.equal(expires.toISOString(), "2026-03-03T00:00:00.000Z");
  });

  it("starts from now when renewing after the period has lapsed", () => {
    const current = sub({ expires_at: "2026-01-01T00:00:00.000Z" });
    const expires = computeExpiry(30, current, now);
    assert.equal(expires.toISOString(), "2026-02-14T00:00:00.000Z");
  });

  it("starts from now when the stored status is EXPIRED", () => {
    const current = sub({
      status: "EXPIRED",
      expires_at: "2026-02-01T00:00:00.000Z", // even if the date is oddly in the future
    });
    const expires = computeExpiry(30, current, now);
    assert.equal(expires.toISOString(), "2026-02-14T00:00:00.000Z");
  });

  it("honours the plan's own duration rather than a fixed period", () => {
    assert.equal(
      computeExpiry(90, null, now).toISOString(),
      "2026-04-15T00:00:00.000Z",
    );
    assert.equal(
      computeExpiry(365, null, now).toISOString(),
      "2027-01-15T00:00:00.000Z",
    );
  });

  it("extends a SUSPENDED subscription from its existing expiry, not from now", () => {
    const current = sub({
      status: "SUSPENDED",
      expires_at: "2026-02-01T00:00:00.000Z",
    });
    const expires = computeExpiry(30, current, now);
    assert.equal(expires.toISOString(), "2026-03-03T00:00:00.000Z");
  });
});