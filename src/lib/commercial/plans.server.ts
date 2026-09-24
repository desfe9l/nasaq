/**
 * Plan repository — the one place plan rows are read or written.
 *
 * Everything the UI shows about a plan (price, currency, duration, features)
 * comes from here, so changing a price is a data edit rather than a hunt through
 * components. `src/lib/commercial/plans.ts` holds the client-safe reads.
 */
import type { Sql } from "@/lib/db";
import type { Plan } from "./types";

type PlanDbRow = {
  id: string;
  name: string;
  arabic_name: string;
  description: string;
  price: string;
  currency: string;
  duration_days: number;
  features: unknown;
  enabled: boolean;
  sort_order: number;
};

/**
 * `features` is jsonb: drivers may hand back a parsed array, a JSON string, or
 * something unexpected if the column was written by hand. Normalize to a clean
 * string list so a malformed row degrades to "no features" instead of throwing
 * inside render.
 */
function parseFeatures(value: unknown): string[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

function toPlan(row: PlanDbRow): Plan {
  return {
    id: row.id,
    name: row.name,
    arabicName: row.arabic_name,
    description: row.description,
    // numeric arrives as a string on both drivers — keep it exact.
    price: String(row.price),
    currency: row.currency,
    durationDays: Number(row.duration_days),
    features: parseFeatures(row.features),
    enabled: row.enabled,
    sortOrder: Number(row.sort_order),
  };
}

/** Every enabled plan, in display order. This is what customers may buy. */
export async function listEnabledPlans(sql: Sql): Promise<Plan[]> {
  const rows = await sql<PlanDbRow>`
    select id, name, arabic_name, description, price, currency,
           duration_days, features, enabled, sort_order
    from plans
    where enabled = true
    order by sort_order asc, id asc
  `;
  return rows.map(toPlan);
}

/** Every plan including disabled ones — admin views only. */
export async function listAllPlans(sql: Sql): Promise<Plan[]> {
  const rows = await sql<PlanDbRow>`
    select id, name, arabic_name, description, price, currency,
           duration_days, features, enabled, sort_order
    from plans
    order by sort_order asc, id asc
  `;
  return rows.map(toPlan);
}

/** One plan by id, enabled or not (an admin may need to inspect a disabled one). */
export async function getPlan(sql: Sql, planId: string): Promise<Plan | null> {
  const rows = await sql<PlanDbRow>`
    select id, name, arabic_name, description, price, currency,
           duration_days, features, enabled, sort_order
    from plans
    where id = ${planId}
    limit 1
  `;
  return rows[0] ? toPlan(rows[0]) : null;
}

/**
 * Only plans a customer is actually allowed to purchase. Used by the payment
 * submission path so a disabled plan cannot be bought via a hand-crafted call.
 */
export async function getPurchasablePlan(sql: Sql, planId: string): Promise<Plan | null> {
  const rows = await sql<PlanDbRow>`
    select id, name, arabic_name, description, price, currency,
           duration_days, features, enabled, sort_order
    from plans
    where id = ${planId} and enabled = true
    limit 1
  `;
  return rows[0] ? toPlan(rows[0]) : null;
}

/** Update the admin-editable fields of a plan. */
export async function updatePlan(
  sql: Sql,
  planId: string,
  patch: {
    name?: string;
    arabicName?: string;
    description?: string;
    price?: string;
    durationDays?: number;
    enabled?: boolean;
    sortOrder?: number;
  },
): Promise<void> {
  // Build the SET list from only the supplied fields so an omitted field is left
  // untouched rather than overwritten with a default.
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  const push = (column: string, value: unknown) => {
    sets.push(`${column} = $${i}`);
    values.push(value);
    i += 1;
  };

  if (patch.name !== undefined) push("name", patch.name);
  if (patch.arabicName !== undefined) push("arabic_name", patch.arabicName);
  if (patch.description !== undefined) push("description", patch.description);
  if (patch.price !== undefined) push("price", patch.price);
  if (patch.durationDays !== undefined) push("duration_days", patch.durationDays);
  if (patch.enabled !== undefined) push("enabled", patch.enabled);
  if (patch.sortOrder !== undefined) push("sort_order", patch.sortOrder);

  if (!sets.length) return;
  sets.push("updated_at = now()");
  values.push(planId);

  await sql.query(
    `update plans set ${sets.join(", ")} where id = $${i}`,
    values,
  );
}