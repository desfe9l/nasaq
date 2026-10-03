/**
 * Claim-time fulfillment — the "buyer registered later" path.
 *
 * When a Gumroad membership arrives for an email that has no NASAQ account yet,
 * the pipeline stores it unbound. The FIRST server-side moment an account with
 * that exact verified email exists (sign-in / account load), this module binds
 * the membership to that account and completes fulfillment through Keygen.
 *
 * Only the verified session email is ever used — there is no user-supplied id
 * anywhere in this flow, and `bound_user_id` is written once.
 */

import type { Sql } from "../db.ts";
import { isGumroadPlanKey } from "./mapping.ts";
import { fulfillCharge, productionGumroadPipelineDeps, type GumroadPipelineDeps } from "./ping.server.ts";

export type GumroadClaimResult = {
  claimed: number;
  active: number;
  failed: number;
};

/**
 * Bind every unbound Gumroad membership whose buyer email matches the verified
 * session email, then (for live memberships) complete Keygen fulfillment.
 * Failures are recorded per-membership and never break the caller.
 */
export async function claimGumroadSubscriptionsForUser(
  sql: Sql,
  session: { userId: string; userEmail: string | null },
  // Production binds the real Keygen ops; tests inject fixtures. This argument
  // is never taken from user input.
  deps: GumroadPipelineDeps = productionGumroadPipelineDeps,
): Promise<GumroadClaimResult> {
  const email = session.userEmail?.trim().toLowerCase();
  if (!email || !email.includes("@")) return { claimed: 0, active: 0, failed: 0 };

  const pending = await sql<{
    subscription_id: string;
    plan_key: string | null;
    status: string;
    last_sale_id: string | null;
  }>`
    select s.subscription_id, s.plan_key, s.status, s.last_sale_id
    from gumroad_subscriptions s
    where s.bound_user_id is null
      and lower(s.bound_email) = ${email}
      and s.status in ('PENDING', 'ACTIVE', 'PAYMENT_FAILED')
    order by s.created_at asc
    limit 10
  `;

  const result: GumroadClaimResult = { claimed: 0, active: 0, failed: 0 };
  for (const row of pending) {
    // Atomic claim: only an UPDATE that moved a row counts — a concurrent
    // request (or an already-bound account) can never steal the membership.
    const claimed = await sql<{ subscription_id: string }>`
      update gumroad_subscriptions
      set bound_user_id = ${session.userId}, claimed_at = now(), updated_at = now()
      where subscription_id = ${row.subscription_id} and bound_user_id is null
      returning subscription_id
    `;
    if (!claimed[0]) continue;
    result.claimed += 1;

    const planKey = row.plan_key;
    if (!planKey || row.status === "PENDING" || !row.last_sale_id) {
      // No verified money to fulfill yet (or membership not active) — the
      // binding itself is the deliverable here; the next verified charge (or
      // the recorded sale re-sync) completes access.
      continue;
    }
    if (!isGumroadPlanKey(planKey)) continue;
    try {
      await fulfillCharge(sql, {
        subscriptionId: row.subscription_id,
        saleId: row.last_sale_id,
        userId: session.userId,
        userEmail: email,
        planKey,
        // First fulfillment for this account — the claim itself is the mint.
        recurringCharge: false,
        deps,
      });
      result.active += 1;
    } catch (error) {
      result.failed += 1;
      await sql`
        update gumroad_subscriptions
        set last_error = ${`claim_fulfillment_failed: ${error instanceof Error ? error.message : "unknown"}`.slice(0, 400)}, updated_at = now()
        where subscription_id = ${row.subscription_id}
      `;
    }
  }
  return result;
}
