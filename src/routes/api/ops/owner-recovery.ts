/**
 * Temporary production operation: owner identity/licence/storage reconciliation.
 *
 * ## Why a route exists at all
 *
 * The production recovery must run where the production configuration lives —
 * the deployment's own `process.env`. The operator CLIs need that same
 * `DATABASE_URL`, R2 trio and Keygen token handed to them from outside, which a
 * runner that does not hold the deployment's configuration cannot do. This
 * route lets the deployment run the identical guarded operations in-process.
 *
 * ## Guards (every one of them fails closed)
 *
 *   1. **Production only** — `VERCEL_ENV` must be exactly `production`. A
 *      Preview deployment, a dev server or a bare runner is refused before
 *      anything is read, let alone written.
 *   2. **Production configuration only** — the managed database must be
 *      configured in this runtime; there is no local/PGlite fallback here.
 *   3. **Existing authentication only** — a real session cookie resolved by the
 *      application's own session code. No bearer shortcut, no header, no query
 *      parameter, no environment flag can stand in for a session. Requests
 *      that are not same-origin are refused (CSRF), exactly like the other
 *      credentialed POST endpoints.
 *   4. **Owner authority only** — the session must pass the SAME
 *      super-admin/owner resolver the admin console uses. The mutating stages
 *      additionally require the caller to be the canonical owner named by the
 *      durable owner binding, so no other administrator can move records.
 *   5. **Rate limited** — a fixed budget per verified session id per minute.
 *   6. **Audited** — every execution (including every refusal) writes an
 *      `owner.ops_run` row to the admin audit log.
 *   7. **Secrets never leave** — the response is the sanitized report of the
 *      stage: fingerprints, counts and verdicts. No identifier, address, key,
 *      key hash, connection string or token is returned or logged.
 *   8. **One-shot** — a successful `migrate` records a durable marker, after
 *      which every mutating stage is refused permanently. The route disables
 *      itself without an environment change.
 *
 * Delete this file (and its stage wiring) once the recovery is verified; the
 * audit rows and the `site_settings` reports are the surviving record.
 */
import { createFileRoute } from "@tanstack/react-router";

import {
  isOwnerOpsStage,
  ownerOpsRuntimeVerdict,
  ownerOpsStagePolicy,
  readOwnerOpsLedger,
  runOwnerOpsStage,
  type OwnerOpsStage,
} from "@/lib/ops/owner-recovery.server";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Credentialed-POST origin check, the same contract `assertSameSiteRequest`
 * applies to the auth surface: a non-browser client (no `Sec-Fetch-Site`) or a
 * same-origin/direct load is fine; a cross-site scripted request is refused.
 */
function sameSiteVerdict(request: Request): { ok: true } | { ok: false; error: string } {
  const site = request.headers.get("sec-fetch-site");
  if (!site || site === "same-origin" || site === "none") return { ok: true };
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host === host) return { ok: true };
    } catch {
      /* an unparseable Origin is refused below */
    }
  }
  return { ok: false, error: "Cross-site request refused." };
}

type Guarded =
  | { ok: true; userId: string; identity: { id: string; email: string | null; emailVerified: boolean } }
  | { ok: false; response: Response };

/**
 * The guard chain shared by every method. Order matters: the runtime verdict is
 * evaluated first, so a non-production deployment cannot even measure whether
 * a session exists.
 */
async function guard(request: Request, options: { requireBoundOwner: boolean }): Promise<Guarded> {
  const runtime = ownerOpsRuntimeVerdict();
  if (!runtime.allowed) {
    return { ok: false, response: json({ ok: false, reason: runtime.reason, error: runtime.error }, runtime.status) };
  }

  if (!sameSiteVerdict(request).ok) {
    return { ok: false, response: json({ ok: false, reason: "cross_site", error: "Cross-site request refused." }, 403) };
  }

  const [{ dbSource, getSql }, { resolveRequestSession }, { assertSameSiteRequest }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/auth/request-session.server"),
    import("@/lib/auth/isolation.server"),
  ]);
  if (dbSource !== "neon") {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          reason: "configuration_unavailable",
          error: "The production database configuration is not available in this runtime. Nothing was read or written.",
        },
        503,
      ),
    };
  }

  // The session is the application's own; nothing in the request can stand in
  // for it. `resolveRequestSession` never throws for a missing store.
  const session = await resolveRequestSession(request.headers, { emitCookies: false });
  const user = session?.user;
  if (!user?.id) {
    return { ok: false, response: json({ ok: false, reason: "unauthenticated", error: "Sign in as the owner first." }, 401) };
  }
  const identity = {
    id: user.id,
    email: user.email ?? null,
    emailVerified: (user as { emailVerified?: boolean }).emailVerified === true,
  };

  const sql = await getSql();
  const [{ isSuperAdminIdentity }, { readOwnerBinding }, { checkRateLimit }, { audit }] = await Promise.all([
    import("@/lib/auth/super-admin.server"),
    import("@/lib/auth/owner-binding.server"),
    import("@/lib/license/rate-limit"),
    import("@/lib/commercial/admin.server"),
  ]);

  // Every execution is audited — refusals included.
  const record = async (
    outcome: "started" | "refused" | "completed",
    detail: Record<string, string | number | boolean | null>,
  ) => {
    await audit(sql, {
      adminUserId: identity.id,
      action: "owner.ops_run",
      targetType: "owner_recovery",
      targetId: identity.id,
      detail: { outcome, ...detail },
    });
  };

  if (!(await isSuperAdminIdentity(sql, identity))) {
    await record("refused", { reason: "not_owner" });
    return { ok: false, response: json({ ok: false, reason: "not_owner", error: "Owner authority required." }, 403) };
  }

  if (options.requireBoundOwner) {
    const binding = await readOwnerBinding(sql);
    if (!binding || binding.userId !== identity.id) {
      await record("refused", { reason: "not_bound_owner" });
      return {
        ok: false,
        response: json(
          { ok: false, reason: "not_bound_owner", error: "Only the canonical (bound) owner may move ownership records." },
          403,
        ),
      };
    }
  }

  if (!checkRateLimit("ops:owner-recovery", `user:${identity.id}`, 10, 60_000)) {
    await record("refused", { reason: "rate_limited" });
    return { ok: false, response: json({ ok: false, reason: "rate_limited", error: "Too many runs — retry in a minute." }, 429) };
  }

  try {
    assertSameSiteRequest();
  } catch {
    await record("refused", { reason: "cross_site" });
    return { ok: false, response: json({ ok: false, reason: "cross_site", error: "Cross-site request refused." }, 403) };
  }

  return { ok: true, userId: identity.id, identity };
}

export const Route = createFileRoute("/api/ops/owner-recovery")({
  server: {
    handlers: {
      /**
       * The durable ledger: the one-shot marker and the last report per stage.
       *
       * Read-only, so it remains available after the operation has disabled
       * itself — this is how the evidence is re-read without running anything.
       */
      GET: async ({ request }) => {
        const guarded = await guard(request, { requireBoundOwner: false });
        if (!guarded.ok) return guarded.response;
        const [{ getSql }, { fingerprint }] = await Promise.all([
          import("@/lib/db"),
          import("@/lib/auth/owner-migration-verify.server"),
        ]);
        const sql = await getSql();
        const ledger = await readOwnerOpsLedger(sql);
        return json({
          ok: true,
          buildId: __APP_BUILD_ID__,
          owner: fingerprint(guarded.userId),
          ledger,
        });
      },

      /**
       * Run one stage.
       *
       * Body: `{ stage: "plan" | "migrate" | "identity" | "provider" |
       *          "storage" | "admin-probe" | "battery", confirm?: string }`
       */
      POST: async ({ request }) => {
        // The cheapest refusals come first: a non-production deployment or a
        // cross-site caller is answered before the request body is read.
        const runtime = ownerOpsRuntimeVerdict();
        if (!runtime.allowed) {
          return json({ ok: false, reason: runtime.reason, error: runtime.error }, runtime.status);
        }
        if (!sameSiteVerdict(request).ok) {
          return json({ ok: false, reason: "cross_site", error: "Cross-site request refused." }, 403);
        }
        const body = (await request.json().catch(() => ({}))) as {
          stage?: unknown;
          confirm?: unknown;
        };
        const stage: unknown = body?.stage;
        if (!isOwnerOpsStage(stage)) {
          return json({ ok: false, reason: "unknown_stage", error: "Unknown stage." }, 400);
        }
        const guarded = await guard(request, { requireBoundOwner: stage === "migrate" });
        if (!guarded.ok) return guarded.response;

        const [{ getSql }, { audit }] = await Promise.all([
          import("@/lib/db"),
          import("@/lib/commercial/admin.server"),
        ]);
        const sql = await getSql();
        const ledger = await readOwnerOpsLedger(sql);
        const policy = ownerOpsStagePolicy(stage as OwnerOpsStage, {
          completed: ledger.completedAt !== null,
          confirm: body?.confirm,
        });
        if (!policy.allowed) {
          await audit(sql, {
            adminUserId: guarded.userId,
            action: "owner.ops_run",
            targetType: "owner_recovery",
            targetId: guarded.userId,
            detail: { outcome: "refused", stage, reason: policy.reason },
          });
          return json({ ok: false, reason: policy.reason, error: policy.error }, policy.status);
        }

        const outcome = await runOwnerOpsStage(sql, stage as OwnerOpsStage, {
          userId: guarded.userId,
          audit: async ({ action, detail }) => {
            await audit(sql, {
              adminUserId: guarded.userId,
              action,
              targetType: "owner_recovery",
              targetId: guarded.userId,
              detail: { stage, ...detail },
            });
          },
        });

        await audit(sql, {
          adminUserId: guarded.userId,
          action: "owner.ops_run",
          targetType: "owner_recovery",
          targetId: guarded.userId,
          detail: { outcome: "completed", stage, ok: outcome.ok },
        });

        // The report is the answer even when a stage is red: 200 with the
        // verdict inside, so the evidence survives the failure it describes.
        const after = await readOwnerOpsLedger(sql);
        return json({
          ok: outcome.ok,
          buildId: __APP_BUILD_ID__,
          stage: outcome.stage,
          at: outcome.at,
          completedAt: after.completedAt,
          result: outcome.result,
        });
      },
    },
  },
});
