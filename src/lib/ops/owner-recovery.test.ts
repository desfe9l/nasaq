/**
 * The temporary production owner-recovery operation — refusal rules.
 *
 * This endpoint exists to run the guarded owner migration and its verification
 * battery INSIDE the deployment runtime, where the production configuration
 * lives. Because it writes, its refusals are the security-relevant half and
 * they are asserted here before anything else:
 *
 *   1. only `VERCEL_ENV=production` may run it (Preview, dev, a bare runner,
 *      or a production runtime whose database configuration is missing all
 *      refuse before reading anything);
 *   2. mutating stages require their confirmation phrase — a replayed request
 *      cannot move ownership records;
 *   3. once the durable completion marker exists, every mutating stage is
 *      refused permanently: the operation disables itself after success, and
 *      the read-only stages stay available so evidence can be re-read;
 *   4. the durable ledger reports the marker and the last report per stage,
 *      and nothing else.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "@/lib/db";
import { createTestSql } from "../commercial/test-db.ts";
import {
  OWNER_OPS_CLAIM_KEY,
  OWNER_OPS_COMPLETED_KEY,
  OWNER_OPS_CONFIRMATIONS,
  OWNER_OPS_BOOTSTRAP_STAGES,
  OWNER_OPS_MUTATING_STAGES,
  OWNER_OPS_ONE_SHOT_STAGES,
  OWNER_OPS_REPORT_PREFIX,
  OWNER_OPS_STAGES,
  claimOwnerOpsRun,
  countOwnerOpsRuns,
  isOwnerOpsBootstrapStage,
  isOwnerOpsMutatingStage,
  isOwnerOpsStage,
  releaseOwnerOpsRun,
  ownerOpsRuntimeVerdict,
  ownerOpsStagePolicy,
  readOwnerOpsLedger,
  runOwnerOpsStage,
} from "./owner-recovery.server.ts";

describe("owner ops — production-only runtime guard", () => {
  it("refuses a runtime that is not Vercel Production", () => {
    for (const env of [
      {},
      { VERCEL_ENV: "" },
      { VERCEL_ENV: "preview", DATABASE_URL: "postgres://example" },
      { VERCEL_ENV: "development", DATABASE_URL: "postgres://example" },
      { VERCEL_ENV: "Production", DATABASE_URL: "postgres://example" },
    ]) {
      const verdict = ownerOpsRuntimeVerdict(env);
      assert.equal(verdict.allowed, false, JSON.stringify(env));
      if (!verdict.allowed) assert.equal(verdict.reason, "not_production");
    }
  });

  it("fails closed when production carries no database configuration", () => {
    const verdict = ownerOpsRuntimeVerdict({ VERCEL_ENV: "production" });
    assert.equal(verdict.allowed, false);
    if (!verdict.allowed) {
      assert.equal(verdict.reason, "configuration_unavailable");
      assert.equal(verdict.status, 503);
    }
  });

  it("allows the real production runtime with its configuration present", () => {
    const verdict = ownerOpsRuntimeVerdict({
      VERCEL_ENV: "production",
      DATABASE_URL: "postgres://example",
    });
    assert.equal(verdict.allowed, true);
  });
});

describe("owner ops — stage vocabulary", () => {
  it("accepts exactly the documented stages", () => {
    for (const stage of OWNER_OPS_STAGES) assert.equal(isOwnerOpsStage(stage), true);
    for (const junk of ["", "migration", "MIGRATE", "admin", null, undefined, 7, {}]) {
      assert.equal(isOwnerOpsStage(junk), false, String(junk));
    }
  });

  it("marks only the stages that write", () => {
    assert.deepEqual([...OWNER_OPS_MUTATING_STAGES].sort(), [
      "admin-probe",
      "migrate",
      "storage-rekey",
    ]);
    const writes = new Set(["migrate", "admin-probe", "storage-rekey"]);
    for (const stage of OWNER_OPS_STAGES) {
      assert.equal(isOwnerOpsMutatingStage(stage), writes.has(stage));
    }
  });

  /*
   * The bootstrap is the one stage reachable without existing owner
   * authority. If this set ever grows, an account that cannot prove ownership
   * gains a path to a stage that moves records — so the test pins it at
   * exactly one, by name.
   */
  it("exempts exactly one stage from the owner-authority requirement", () => {
    assert.deepEqual([...OWNER_OPS_BOOTSTRAP_STAGES], ["recover"]);
    for (const stage of OWNER_OPS_STAGES) {
      assert.equal(isOwnerOpsBootstrapStage(stage), stage === "recover");
    }
    // The bootstrap writes a binding, but it is NOT a record move: it must not
    // be gated behind the canonical-owner check it exists to make possible.
    assert.equal(isOwnerOpsMutatingStage("recover"), false);
  });

  it("keeps the one-shot lock on the move alone", () => {
    assert.equal(ownerOpsStagePolicy("migrate", { completed: true, confirm: "MIGRATE-OWNER" }).allowed, false);
    // Verification, the bootstrap and the resumable storage pass stay usable
    // after the move: otherwise "verify the migration" is impossible to do.
    for (const stage of ["recover", "plan", "identity", "report"] as const) {
      assert.equal(ownerOpsStagePolicy(stage, { completed: true }).allowed, true, stage);
    }
    assert.equal(
      ownerOpsStagePolicy("storage-rekey", { completed: true, confirm: "REKEY-STORAGE" }).allowed,
      true,
    );
  });

  it("requires a confirmation phrase for every mutating stage", () => {
    for (const stage of OWNER_OPS_MUTATING_STAGES) {
      assert.equal(typeof OWNER_OPS_CONFIRMATIONS[stage], "string");
      const refused = ownerOpsStagePolicy(stage, { completed: false, confirm: undefined });
      assert.equal(refused.allowed, false);
      if (!refused.allowed) assert.equal(refused.reason, "confirmation_required");
      assert.equal(
        ownerOpsStagePolicy(stage, { completed: false, confirm: "not-the-phrase" }).allowed,
        false,
      );
      assert.equal(
        ownerOpsStagePolicy(stage, {
          completed: false,
          confirm: OWNER_OPS_CONFIRMATIONS[stage],
        }).allowed,
        true,
      );
    }
  });

  it("leaves read-only stages runnable without a phrase", () => {
    for (const stage of ["plan", "identity", "provider", "storage", "battery"] as const) {
      assert.equal(ownerOpsStagePolicy(stage, { completed: false }).allowed, true);
    }
  });
});

describe("owner ops — one-shot disable after success", () => {
  it("refuses the MOVE forever once the marker exists", () => {
    for (const stage of OWNER_OPS_ONE_SHOT_STAGES) {
      const refused = ownerOpsStagePolicy(stage, {
        completed: true,
        confirm: OWNER_OPS_CONFIRMATIONS[stage],
      });
      assert.equal(refused.allowed, false);
      if (!refused.allowed) {
        assert.equal(refused.reason, "already_completed");
        assert.equal(refused.status, 409);
      }
    }
  });

  it("keeps the read-only stages and the synthetic probe available after completion", () => {
    for (const stage of ["plan", "identity", "provider", "storage", "battery"] as const) {
      assert.equal(ownerOpsStagePolicy(stage, { completed: true }).allowed, true);
    }
    /*
     * The probe is part of the verification the migration is judged by, and it
     * touches only rows it created and deleted itself — so it must still run
     * AFTER the move, or "verify the migration" could never be completed.
     * It keeps its confirmation phrase.
     */
    assert.equal(
      ownerOpsStagePolicy("admin-probe", {
        completed: true,
        confirm: OWNER_OPS_CONFIRMATIONS["admin-probe"],
      }).allowed,
      true,
    );
    assert.equal(
      ownerOpsStagePolicy("admin-probe", { completed: true, confirm: undefined }).allowed,
      false,
    );
  });
});

describe("owner ops — the stage cores refuse before they write", () => {
  let sql: Sql;
  let close: () => Promise<void>;

  before(async () => {
    const created = await createTestSql();
    sql = created.sql;
    close = created.close;
  });

  after(async () => {
    await close();
  });

  it("every stage that cannot prove an owner answers 'uncertified' and writes nothing", async () => {
    const [provider, live, probe] = await Promise.all([
      import("../license/owner-provider-verify.server.ts"),
      import("../auth/owner-live-verify.server.ts"),
      import("../admin/owner-mutation-probe.server.ts"),
    ]);
    const count = async (table: string) =>
      Number((await sql.query<{ n: number }>(`select count(*)::int as n from ${table}`))[0]?.n ?? 0);
    const before = {
      licenses: await count("licenses"),
      subscriptions: await count("subscriptions"),
      paymentRequests: await count("payment_requests"),
      adminUsers: await count("admin_users"),
    };

    const outcomes = [
      await provider.ownerProviderVerify(sql),
      await live.runOwnerLiveVerify(sql),
      await probe.runOwnerMutationProbe(sql),
    ];
    for (const outcome of outcomes) {
      assert.equal(outcome.status, "uncertified");
      // Both refusals are legitimate here: an unconfigured identity store, or
      // a store with no durable owner binding. Neither may proceed.
      assert.ok(
        ["no_binding", "store_unavailable"].includes(
          (outcome as { reason: string }).reason,
        ),
        (outcome as { reason: string }).reason,
      );
    }

    // The mutation probe is the one stage that writes; a refusal must leave
    // every table exactly as it found it.
    assert.deepEqual(
      {
        licenses: await count("licenses"),
        subscriptions: await count("subscriptions"),
        paymentRequests: await count("payment_requests"),
        adminUsers: await count("admin_users"),
      },
      before,
    );
  });

  it("the operation's own plan stage refuses and reports the reason", async () => {
    const outcome = await runOwnerOpsStage(sql, "plan", { userId: "test-caller" });
    assert.equal(outcome.stage, "plan");
    assert.equal(outcome.ok, false);
    const result = outcome.result as { ok: boolean; reason?: string; error?: string };
    assert.equal(result.ok, false);
    assert.ok(["no_binding", "store_unavailable"].includes(result.reason ?? ""));
  });
});

describe("owner ops — single-flight claim and the durable budget", () => {
  let sql: Sql;
  let close: () => Promise<void>;

  before(async () => {
    const created = await createTestSql();
    sql = created.sql;
    close = created.close;
  });

  after(async () => {
    await close();
  });

  it("only one mutating run may hold the claim, and a stale claim is taken over", async () => {
    const first = await claimOwnerOpsRun(sql, { stage: "migrate", by: "fp-test" });
    assert.ok(first, "the first claim is granted");

    // A second, simultaneous run must be refused while the claim is live —
    // this is what the in-memory limiter cannot see across instances.
    assert.equal(await claimOwnerOpsRun(sql, { stage: "migrate", by: "fp-test" }), null);

    // A killed instance must not brick the operation: past the TTL the claim
    // is taken over rather than honoured forever.
    await sql`
      update site_settings
         set updated_at = now() - interval '10 minutes'
       where key = ${OWNER_OPS_CLAIM_KEY}
    `;
    const takenOver = await claimOwnerOpsRun(sql, { stage: "migrate", by: "fp-test" });
    assert.ok(takenOver, "a stale claim is taken over");

    // Releasing with a foreign token must not remove someone else's claim.
    await releaseOwnerOpsRun(sql, "not-the-token");
    assert.equal(
      await claimOwnerOpsRun(sql, { stage: "migrate", by: "fp-test" }),
      null,
      "a foreign release does not free the claim",
    );

    // Releasing with our own token does.
    await releaseOwnerOpsRun(sql, takenOver.token);
    assert.ok(await claimOwnerOpsRun(sql, { stage: "migrate", by: "fp-test" }));
  });

  it("counts recent runs from the audit trail, not from memory", async () => {
    const adminUserId = "audit-count-test";
    assert.equal(await countOwnerOpsRuns(sql, adminUserId), 0);

    for (const outcome of ["started", "completed", "refused"]) {
      await sql`
        insert into admin_audit_log (id, admin_user_id, action, target_type, target_id, detail)
        values (${`ops-${outcome}`}, ${adminUserId}, 'owner.ops_run', 'owner_recovery', ${adminUserId},
                ${JSON.stringify({ outcome, stage: "plan" })}::jsonb)
      `;
    }
    assert.equal(await countOwnerOpsRuns(sql, adminUserId), 3);

    // Rows outside the window do not count.
    await sql`
      update admin_audit_log set created_at = now() - interval '10 minutes'
       where admin_user_id = ${adminUserId}
    `;
    assert.equal(await countOwnerOpsRuns(sql, adminUserId), 0);

    // Another session's runs never count against this one.
    assert.equal(await countOwnerOpsRuns(sql, "someone-else"), 0);
  });
});

describe("owner ops — durable ledger", () => {
  let sql: Sql;
  let close: () => Promise<void>;

  before(async () => {
    const created = await createTestSql();
    sql = created.sql;
    close = created.close;
  });

  after(async () => {
    await close();
  });

  it("starts with no marker and no reports, then reports exactly what was written", async () => {
    assert.deepEqual(await readOwnerOpsLedger(sql), { completedAt: null, reports: [] });

    await sql`
      insert into site_settings (key, value, updated_at)
      values (${OWNER_OPS_REPORT_PREFIX + "plan"}, ${JSON.stringify({
        at: "2026-01-01T00:00:00.000Z",
        ok: true,
        result: { wouldMoveTotal: 3 },
      })}::jsonb, now())
    `;
    let ledger = await readOwnerOpsLedger(sql);
    assert.equal(ledger.completedAt, null);
    assert.equal(ledger.reports.length, 1);
    assert.equal(ledger.reports[0].stage, "plan");
    assert.equal(ledger.reports[0].ok, true);

    await sql`
      insert into site_settings (key, value, updated_at)
      values (${OWNER_OPS_COMPLETED_KEY}, ${JSON.stringify({
        at: "2026-01-02T00:00:00.000Z",
        stage: "migrate",
      })}::jsonb, now())
    `;
    ledger = await readOwnerOpsLedger(sql);
    assert.equal(ledger.completedAt, "2026-01-02T00:00:00.000Z");
    // The marker is an entry in site_settings too, but it is reported as the
    // marker — never as a stage report.
    assert.deepEqual(
      ledger.reports.map((r) => r.stage),
      ["plan"],
    );

    // The ledger decision and the pure policy agree: the move is now inert,
    // while verification (read-only stages and the synthetic probe) continues
    // to be possible against the migrated state.
    for (const stage of OWNER_OPS_ONE_SHOT_STAGES) {
      const refused = ownerOpsStagePolicy(stage, {
        completed: ledger.completedAt !== null,
        confirm: OWNER_OPS_CONFIRMATIONS[stage],
      });
      assert.equal(refused.allowed, false);
    }
    assert.equal(
      ownerOpsStagePolicy("admin-probe", {
        completed: ledger.completedAt !== null,
        confirm: OWNER_OPS_CONFIRMATIONS["admin-probe"],
      }).allowed,
      true,
    );
  });
});
