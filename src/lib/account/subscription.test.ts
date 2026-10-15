import assert from "node:assert/strict";
import test from "node:test";
import {
  SUBSCRIPTION_EMPTY_VALUE,
  SUBSCRIPTION_FIELD_KEYS,
  SUBSCRIPTION_LOADING,
  SUBSCRIPTION_OPEN_ENDED,
  daysRemainingLabel,
  daysRemainingUntil,
  elapsedPercentOf,
  subscriptionDetail,
  type SubscriptionInput,
} from "./subscription.ts";

/**
 * The rules behind «الحساب والاشتراك».
 *
 * Two groups of invariants matter here. The first is arithmetic that must not
 * surprise an author on the last day of a period: days are counted as CALENDAR
 * days (so a re-render at 23:59 and one at 00:01 differ by a day, but a
 * re-render inside the same day never moves the number), and the meter is
 * clamped so a clock skew can never draw a bar past its track.
 *
 * The second is the shape the account surfaces rely on for stability: the field
 * list is always four rows in a fixed order — including for a lifetime plan, an
 * administrator and an account with no plan at all — because a section that
 * gains or loses a row when data arrives is a section that visibly jumps.
 */

/** A fixed local-feeling clock: 2026-03-15 12:00, so the maths is exact. */
const NOW = Date.parse("2026-03-15T12:00:00");
const IN_10_DAYS = new Date(NOW + 10 * 86_400_000).toISOString();
const TEN_DAYS_AGO = new Date(NOW - 10 * 86_400_000).toISOString();

const base: SubscriptionInput = {
  isLoading: false,
  hasLicense: false,
  isAdmin: false,
  license: null,
  trial: null,
};

/* ------------------------------------------------------------- day maths ---- */

test("days remaining counts calendar days, and only moves at midnight", () => {
  assert.equal(daysRemainingUntil(IN_10_DAYS, NOW), 10);
  // The final day is day 0, not a fractional "0.5" or a hidden "-1".
  assert.equal(daysRemainingUntil(new Date(NOW + 3_600_000).toISOString(), NOW), 0);
  assert.equal(daysRemainingUntil(TEN_DAYS_AGO, NOW), -10);
  assert.equal(daysRemainingUntil(null, NOW), null);
  assert.equal(daysRemainingUntil("not-a-date", NOW), null);

  /*
   * Every moment of the same day gives the same answer — this is why the field
   * does not shimmer when the section re-renders for an unrelated reason.
   */
  const morning = daysRemainingUntil(IN_10_DAYS, Date.parse("2026-03-15T00:05:00"));
  const night = daysRemainingUntil(IN_10_DAYS, Date.parse("2026-03-15T23:55:00"));
  assert.equal(morning, night);
  assert.equal(morning, 10);
});

test("the consumed-period meter is clamped to its track", () => {
  const start = TEN_DAYS_AGO;
  assert.equal(elapsedPercentOf(start, IN_10_DAYS, NOW), 50);
  assert.equal(elapsedPercentOf(start, IN_10_DAYS, Date.parse("2026-01-01T00:00:00")), 0);
  assert.equal(elapsedPercentOf(start, IN_10_DAYS, Date.parse("2027-01-01T00:00:00")), 100);
  // No measurable period, no bar: never a divide-by-zero percentage.
  assert.equal(elapsedPercentOf(null, IN_10_DAYS, NOW), null);
  assert.equal(elapsedPercentOf(IN_10_DAYS, start, NOW), null);
  assert.equal(elapsedPercentOf(start, null, NOW), null);
});

test("the countdown has words for the states a subscription actually reaches", () => {
  assert.equal(daysRemainingLabel(1), "يوم واحد متبقٍ");
  assert.equal(daysRemainingLabel(2), "يومان متبقيان");
  assert.equal(daysRemainingLabel(11), "11 أيام متبقية");
  assert.equal(daysRemainingLabel(0), "ينتهي اليوم");
  assert.match(daysRemainingLabel(-3) ?? "", /انتهت المدة/);
  assert.equal(daysRemainingLabel(null), null);
});

/* ----------------------------------------------------------------- phases ---- */

test("every state prints the same four rows, in the same order", () => {
  const cases: SubscriptionInput[] = [
    { ...base, isLoading: true },
    { ...base, isAdmin: true },
    { ...base, isAdmin: true, isOwner: true },
    { ...base, isSuspended: true },
    { ...base, trial: { startedAt: TEN_DAYS_AGO, expiresAt: IN_10_DAYS } },
    {
      ...base,
      hasLicense: true,
      license: {
        id: "l1",
        type: "PRO",
        status: "ACTIVE",
        keyPrefix: "NSQ7",
        activatedAt: TEN_DAYS_AGO,
        expiresAt: IN_10_DAYS,
        createdAt: TEN_DAYS_AGO,
        plan: "individual-monthly",
        billing: "monthly",
      },
    },
    {
      ...base,
      hasLicense: true,
      license: {
        id: "l2",
        type: "LIFETIME",
        status: "ACTIVE",
        keyPrefix: "NSQL",
        activatedAt: TEN_DAYS_AGO,
        expiresAt: null,
        createdAt: TEN_DAYS_AGO,
      },
    },
    {
      ...base,
      license: {
        id: "l3",
        type: "PRO",
        status: "EXPIRED",
        keyPrefix: "NSQ9",
        activatedAt: new Date(NOW - 40 * 86_400_000).toISOString(),
        expiresAt: TEN_DAYS_AGO,
        createdAt: TEN_DAYS_AGO,
      },
    },
  ];
  for (const input of cases) {
    const detail = subscriptionDetail(input, { now: NOW });
    assert.equal(detail.fields.length, 4, `${detail.phase}: four rows`);
    assert.deepEqual(
      detail.fields.map((item) => item.key),
      [...SUBSCRIPTION_FIELD_KEYS],
      `${detail.phase}: the row order is fixed, so the section never re-orders itself`,
    );
    for (const item of detail.fields) {
      assert.ok(item.value.trim().length > 0, `${detail.phase}/${item.key}: never a blank value`);
      assert.ok(item.label.length > 0);
    }
  }
});

test("an active plan resolves to the dates the server recorded, formatted once", () => {
  const detail = subscriptionDetail(
    {
      ...base,
      hasLicense: true,
      license: {
        id: "l1",
        type: "PRO",
        status: "ACTIVE",
        keyPrefix: "NSQ7",
        activatedAt: TEN_DAYS_AGO,
        expiresAt: IN_10_DAYS,
        createdAt: TEN_DAYS_AGO,
      },
    },
    { now: NOW },
  );
  assert.equal(detail.phase, "ACTIVE");
  assert.equal(detail.tone, "licensed");
  assert.equal(detail.statusLabel, "نشطة");
  assert.match(detail.planLabel, /PRO/);
  assert.equal(detail.daysRemaining, 10);
  assert.equal(detail.elapsedPercent, 50);
  assert.equal(detail.meter, "countdown");
  assert.equal(detail.keyPrefix, "NSQ7");
  const [plan, activated, expires, remaining] = detail.fields;
  assert.equal(activated.value.includes("T"), false, "a date is printed, never an ISO stamp");
  assert.equal(expires.value.includes("T"), false);
  assert.match(remaining.value, /10 أيام متبقية/);
  assert.ok(plan.value.length > 0);
});

test("a lifetime plan keeps its expiry row instead of losing it", () => {
  const detail = subscriptionDetail(
    {
      ...base,
      hasLicense: true,
      license: {
        id: "l2",
        type: "LIFETIME",
        status: "ACTIVE",
        keyPrefix: "NSQL",
        activatedAt: TEN_DAYS_AGO,
        expiresAt: null,
        createdAt: TEN_DAYS_AGO,
      },
    },
    { now: NOW },
  );
  assert.equal(detail.phase, "LIFETIME");
  assert.equal(detail.fields[2].value, SUBSCRIPTION_OPEN_ENDED);
  assert.equal(detail.daysRemaining, null);
  assert.equal(detail.elapsedPercent, null);
  assert.equal(detail.meter, "open", "the meter row is still there, in its permanent form");
});

test("an ACTIVE row whose stored expiry has passed is reported honestly", () => {
  /*
   * The server keeps the row ACTIVE until it revalidates. The section must not
   * print "-4 days left" nor hide the fact — it names the state and says the
   * date is waiting on revalidation, and never unlocks anything by doing so.
   */
  const detail = subscriptionDetail(
    {
      ...base,
      hasLicense: true,
      license: {
        id: "l4",
        type: "PRO",
        status: "ACTIVE",
        keyPrefix: "NSQ4",
        activatedAt: new Date(NOW - 40 * 86_400_000).toISOString(),
        expiresAt: TEN_DAYS_AGO,
        createdAt: TEN_DAYS_AGO,
      },
    },
    { now: NOW },
  );
  assert.equal(detail.tone, "lapsed");
  assert.match(detail.statusLabel, /تجاوزت تاريخ الانتهاء/);
  assert.equal(detail.fields[3].value, "بانتظار إعادة التحقق");
  assert.equal(detail.elapsedPercent, 100);
});

test("a trial is a trial, and an elapsed trial is lapsed — not 'active'", () => {
  const live = subscriptionDetail(
    { ...base, trial: { startedAt: TEN_DAYS_AGO, expiresAt: IN_10_DAYS } },
    { now: NOW },
  );
  assert.equal(live.phase, "TRIAL");
  assert.equal(live.tone, "trial");
  assert.equal(live.daysRemaining, 10);
  assert.equal(live.fields[1].value.includes("T"), false);

  const over = subscriptionDetail(
    { ...base, trial: { startedAt: new Date(NOW - 30 * 86_400_000).toISOString(), expiresAt: TEN_DAYS_AGO } },
    { now: NOW },
  );
  assert.equal(over.phase, "EXPIRED");
  assert.equal(over.tone, "lapsed");
  assert.equal(over.meter, "none");
});

test("an administrator gets a system standing, an open-ended access and no fake renewal", () => {
  const admin = subscriptionDetail({ ...base, isAdmin: true, accountCreatedAt: TEN_DAYS_AGO }, { now: NOW });
  assert.equal(admin.phase, "ADMIN");
  assert.equal(admin.isAdmin, true);
  assert.equal(admin.isOwner, false);
  assert.equal(admin.fields[2].value, SUBSCRIPTION_OPEN_ENDED);
  assert.equal(admin.fields[1].value.includes("T"), false, "activation reads the account creation date");
  assert.equal(admin.daysRemaining, null);
  assert.equal(admin.meter, "open");

  const owner = subscriptionDetail({ ...base, isAdmin: true, isOwner: true, accountCreatedAt: TEN_DAYS_AGO });
  assert.equal(owner.phase, "OWNER");
  assert.match(owner.planLabel, /المالك/);
  assert.match(owner.note, /لوحة الإدارة/, "the owner is pointed at the management surface");
});

test("a suspended account is reported as suspended whatever its licence row says", () => {
  const detail = subscriptionDetail({
    ...base,
    isSuspended: true,
    license: {
      id: "l5",
      type: "PRO",
      status: "ACTIVE",
      keyPrefix: "NSQ5",
      activatedAt: TEN_DAYS_AGO,
      expiresAt: IN_10_DAYS,
      createdAt: TEN_DAYS_AGO,
    },
  });
  assert.equal(detail.phase, "SUSPENDED");
  assert.equal(detail.tone, "restricted");
  assert.equal(detail.daysRemaining, null, "a suspension is not a countdown");
});

test("an account with no plan is told what it has, with the same four rows", () => {
  const detail = subscriptionDetail({ ...base, accountCreatedAt: TEN_DAYS_AGO }, { now: NOW });
  assert.equal(detail.phase, "FREE");
  assert.equal(detail.statusLabel, "بدون باقة");
  assert.equal(detail.meter, "none");
  assert.equal(detail.fields[1].label, "تاريخ التفعيل");
  assert.match(detail.fields[1].hint ?? "", /إنشاء الحساب/);
  assert.equal(detail.fields[2].value, SUBSCRIPTION_EMPTY_VALUE, "a missing date is a dash, never a removed row");
});

/* -------------------------------------------------------------- stability ---- */

test("the loading detail is a ready-made shape, so the section paints its final size first", () => {
  const detail = subscriptionDetail({ ...base, isLoading: true });
  assert.equal(detail, SUBSCRIPTION_LOADING, "the pending state is a constant, not a fresh object");
  assert.equal(detail.phase, "LOADING");
  assert.equal(detail.fields.length, 4);
  assert.equal(detail.daysRemaining, null);
  assert.equal(detail.elapsedPercent, null);
  assert.equal(detail.keyPrefix, null);
  // Every value is a real (empty-state) string, so no row collapses mid-paint.
  for (const item of detail.fields) assert.ok(item.value.length > 0);
  assert.equal(SUBSCRIPTION_LOADING.fields[0].value, "جارٍ التحقق");
  assert.ok(SUBSCRIPTION_EMPTY_VALUE.length > 0);
});

test("the view never invents access: no licence means no countdown", () => {
  const free = subscriptionDetail({ ...base, isAdmin: false, hasLicense: false, isOwner: false });
  assert.equal(free.isAdmin, false);
  assert.equal(free.meter, "none");
  const revoked = subscriptionDetail({
    ...base,
    license: {
      id: "l6",
      type: "PRO",
      status: "REVOKED",
      keyPrefix: "NSQ6",
      activatedAt: TEN_DAYS_AGO,
      expiresAt: IN_10_DAYS,
      createdAt: TEN_DAYS_AGO,
    },
  });
  assert.equal(revoked.phase, "REVOKED");
  assert.equal(revoked.daysRemaining, null, "a revoked licence is not a countdown");
  assert.equal(revoked.elapsedPercent, null);
});
