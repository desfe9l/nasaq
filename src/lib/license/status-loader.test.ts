/**
 * The shared licence-status loader: one request per page, not one per consumer.
 *
 * This is what stops twenty licence-aware components (and every internal
 * navigation) from each paying for `getLicenseStatusFn`. The rules that matter:
 *
 *   · a fresh answer is reused, so moving between pages costs nothing;
 *   · a forced refresh still joins an in-flight request instead of stampeding;
 *   · a FAILED answer is never memoised — otherwise one hiccup would show an
 *     unlicensed account for the whole freshness window;
 *   · every real answer is handed to the persistence hook exactly once.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createLicenseStatusLoader } from "./status-loader.ts";
import { LICENSE_ENTITLEMENTS, type LicenseStatusResult } from "./types.ts";

const PRO: LicenseStatusResult = {
  hasLicense: true,
  license: {
    id: "lic-1",
    type: "PRO",
    status: "ACTIVE",
    keyPrefix: "NASAQ-1",
    activatedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-12-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  entitlements: LICENSE_ENTITLEMENTS.PRO,
};

function harness(answers: Array<LicenseStatusResult | Error>) {
  const clock = { now: 1_700_000_000_000 };
  let calls = 0;
  const persisted: Array<{ userId: string; hasLicense: boolean }> = [];
  const loader = createLicenseStatusLoader({
    now: () => clock.now,
    fetcher: async () => {
      calls += 1;
      const next = answers[Math.min(calls - 1, answers.length - 1)] as LicenseStatusResult | Error;
      if (next instanceof Error) throw next;
      return next;
    },
    onStatus: (userId, status) => persisted.push({ userId, hasLicense: status.hasLicense }),
  });
  return { loader, clock, calls: () => calls, persisted };
}

describe("createLicenseStatusLoader", () => {
  it("answers from the memo inside the freshness window", async () => {
    const h = harness([PRO]);
    assert.equal((await h.loader.load("user-1"))?.hasLicense, true);
    assert.equal(h.calls(), 1);
    assert.equal((await h.loader.load("user-1"))?.hasLicense, true);
    assert.equal(h.calls(), 1);
    assert.equal(h.loader.memo("user-1")?.hasLicense, true);
  });

  it("asks again once the window has passed, and when forced", async () => {
    const h = harness([PRO]);
    await h.loader.load("user-1");
    h.clock.now += 61_000;
    await h.loader.load("user-1");
    assert.equal(h.calls(), 2);
    await h.loader.load("user-1", { force: true });
    assert.equal(h.calls(), 3);
  });

  it("shares ONE request between concurrent consumers — even forced ones", async () => {
    const h = harness([PRO]);
    const results = await Promise.all([
      h.loader.load("user-1"),
      h.loader.load("user-1", { force: true }),
      h.loader.load("user-1"),
    ]);
    assert.equal(h.calls(), 1);
    assert.deepEqual(results.map((r) => r?.hasLicense), [true, true, true]);
  });

  it("keeps answers per account", async () => {
    const h = harness([PRO]);
    await h.loader.load("user-1");
    await h.loader.load("user-2");
    assert.equal(h.calls(), 2);
  });

  it("never memoises a failure, so a hiccup cannot downgrade the account", async () => {
    const h = harness([new Error("offline"), PRO]);
    assert.equal(await h.loader.load("user-1"), null);
    assert.equal(h.loader.memo("user-1"), null);
    // The very next read goes back to the server and succeeds.
    assert.equal((await h.loader.load("user-1"))?.hasLicense, true);
    assert.equal(h.calls(), 2);
    assert.deepEqual(h.persisted, [{ userId: "user-1", hasLicense: true }]);
  });

  it("persists exactly the answers the server gave, once each", async () => {
    const h = harness([PRO]);
    await h.loader.load("user-1");
    await h.loader.load("user-1");
    assert.deepEqual(h.persisted, [{ userId: "user-1", hasLicense: true }]);
  });

  it("invalidate() sends the next read back to the server", async () => {
    const h = harness([PRO]);
    await h.loader.load("user-1");
    h.loader.invalidate();
    await h.loader.load("user-1");
    assert.equal(h.calls(), 2);
    assert.equal(h.loader.memo("user-1")?.hasLicense, true);
  });

  it("answers null for a signed-out caller without any request", async () => {
    const h = harness([PRO]);
    assert.equal(await h.loader.load(""), null);
    assert.equal(h.calls(), 0);
  });

  it("reports whether a request is in flight", async () => {
    const h = harness([PRO]);
    const pending = h.loader.load("user-1");
    assert.equal(h.loader.isFetching(), true);
    await pending;
    assert.equal(h.loader.isFetching(), false);
  });
});
