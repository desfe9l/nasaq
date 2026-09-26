/**
 * Gumroad entitlement state helpers — the narrow bridge between the payment
 * pipeline and NASAQ's authoritative `subscriptions` table.
 *
 * Access still lives ONLY in `subscriptions` (see commercial/entitlement.server)
 * and licenses still live ONLY in Keygen; these helpers just move those rows
 * when Gumroad money-events demand it. Every write is scoped by user id — never
 * by anything the browser sent.
 */

import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { getCatalogPlan } from "../commercial/catalog.ts";
import { grantEntitlement } from "../commercial/admin.server.ts";
import { getSubscription } from "../commercial/entitlement.server.ts";
import { computeExpiry } from "../commercial/entitlement.server.ts";
import { gumroadSourceTransactionId } from "../license/gumroad-fulfillment.server.ts";

/** First charge or renewal → grant/extend access. Idempotent per sale id. */
export async function grantGumroadEntitlement(
  sql: Sql,
  input: { userId: string; planKey: string; saleId: string; expiresAt: Date },
): Promise<{ expiresAt: Date }> {
  const plan = getCatalogPlan(input.planKey);
  if (!plan) throw new Error(`Unknown NASAQ plan for Gumroad sale: ${input.planKey}`);
  return grantEntitlement(sql, {
    userId: input.userId,
    plan: { id: plan.key, durationDays: plan.durationDays },
    sourceTransactionId: gumroadSourceTransactionId(input.saleId),
    expiresAt: input.expiresAt,
  });
}

/** Planned expiry for a Gumroad charge, extending any live access (no lost days). */
export async function computeGumroadExpiry(
  sql: Sql,
  input: { userId: string; planKey: string },
): Promise<Date> {
  const plan = getCatalogPlan(input.planKey);
  if (!plan) throw new Error(`Unknown NASAQ plan for Gumroad renewal: ${input.planKey}`);
  const current = await getSubscription(sql, input.userId);
  const live = current && current.status !== "EXPIRED" ? current : null;
  return computeExpiry(plan.durationDays, live);
}

/** Refund / membership ended: access ends now. History is kept, never deleted. */
export async function endGumroadEntitlement(sql: Sql, userId: string): Promise<void> {
  await sql`
    update subscriptions
    set status = 'EXPIRED', suspended_at = null, updated_at = now()
    where user_id = ${userId} and status in ('ACTIVE', 'SUSPENDED')
  `;
}

/** Lost chargeback/dispute: suspend immediately (outranks expiry on read). */
export async function suspendGumroadEntitlement(sql: Sql, userId: string): Promise<void> {
  const current = await getSubscription(sql, userId);
  if (!current || current.status !== "ACTIVE") return;
  await sql`
    update subscriptions
    set status = 'SUSPENDED', suspended_at = now(), updated_at = now()
    where id = ${current.id}
  `;
}

/** Dispute won / access restored: unsuspend if the paid period is still live. */
export async function reinstateGumroadEntitlement(sql: Sql, userId: string): Promise<void> {
  const current = await getSubscription(sql, userId);
  if (!current || current.status !== "SUSPENDED") return;
  if (new Date(current.expires_at).getTime() <= Date.now()) return;
  await sql`
    update subscriptions
    set status = 'ACTIVE', suspended_at = null, updated_at = now()
    where id = ${current.id}
  `;
}

/**
 * Resolve the NASAQ account a verified buyer email belongs to.
 *
 * Returns the single account whose VERIFIED address matches, or null. When the
 * email is unknown the subscription stays unbound and is claimed later — the
 * buyer signing in to NASAQ with the same email is the claim event.
 */
export async function resolveUserIdForBuyerEmail(
  sql: Sql,
  email: string,
): Promise<{ userId: string } | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return null;
  const rows = await sql<{ id: string }>`
    select id from "user" where lower(email) = ${normalized} limit 2
  `;
  // Zero rows → not registered yet. Two+ rows cannot happen (unique email in
  // Better Auth) but fail closed rather than guessing between identities.
  if (rows.length !== 1) return null;
  return { userId: rows[0].id };
}

/** Unique id for pipeline rows that don't have a natural provider id. */
export function newGumroadRowId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
