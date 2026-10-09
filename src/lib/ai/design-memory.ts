/**
 * Account-scoped design memory — pure rules.
 *
 * The server stores rows; this module decides what is valid, what is
 * recurring, and what may influence the next brief. One-off approvals are
 * kept for inspection and are not auto-applied.
 */

import { DESIGN_CATEGORIES, DESIGN_CONSTITUTION_VERSION, type DesignCategory } from "@/lib/intelligence/design-constitution";

export const DESIGN_MEMORY_KINDS = [
  "approved",
  "rejected",
  "correction",
  "preference",
  "defect",
] as const;

export type DesignMemoryKind = (typeof DESIGN_MEMORY_KINDS)[number];

export const DESIGN_MEMORY_RULE_KEYS = ["", "density", "format", "avoid-repetition", "customer-brand"] as const;

export type DesignMemoryRuleKey = (typeof DESIGN_MEMORY_RULE_KEYS)[number];

export const DESIGN_MEMORY_CAP = 80;

export interface DesignMemoryInput {
  kind: DesignMemoryKind;
  category: string;
  brief: string;
  reason: string;
  recurring: boolean;
  ruleKey: DesignMemoryRuleKey;
  ruleValue: string;
}

export interface DesignMemoryView {
  id: string;
  kind: DesignMemoryKind;
  category: string;
  brief: string;
  reason: string;
  constitutionVersion: string;
  recurring: boolean;
  ruleKey: string;
  ruleValue: string;
  createdAt: string;
}

export interface ResolvedMemory {
  /** Newest recurring rule per key. One-off rows are excluded. */
  rules: Partial<Record<Exclude<DesignMemoryRuleKey, "">, string>>;
  /** Short notes safe to place in a system prompt. */
  notes: string;
}

const DENSITY = new Set(["light", "balanced", "dense"]);
const FORMAT = new Set(["a4-book", "wide-slide", "tall-story"]);

function clip(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function normalizeMemoryInput(raw: Partial<DesignMemoryInput> | null | undefined): DesignMemoryInput | null {
  if (!raw || typeof raw !== "object") return null;
  if (!DESIGN_MEMORY_KINDS.includes(raw.kind as DesignMemoryKind)) return null;
  const kind = raw.kind as DesignMemoryKind;
  const reason = clip(raw.reason, 500);
  if ((kind === "rejected" || kind === "correction") && reason.length < 2) return null;
  const ruleKey = DESIGN_MEMORY_RULE_KEYS.includes(raw.ruleKey as DesignMemoryRuleKey)
    ? (raw.ruleKey as DesignMemoryRuleKey)
    : "";
  let ruleValue = clip(raw.ruleValue, 40);
  if (ruleKey === "density" && !DENSITY.has(ruleValue)) ruleValue = "";
  if (ruleKey === "format" && !FORMAT.has(ruleValue)) ruleValue = "";
  if (ruleKey === "avoid-repetition" || ruleKey === "customer-brand") ruleValue = ruleValue ? "1" : "";
  if (ruleKey && !ruleValue) return null;
  const category = clip(raw.category, 40);
  return {
    kind,
    category: (DESIGN_CATEGORIES as readonly string[]).includes(category) ? category : category.slice(0, 40),
    brief: clip(raw.brief, 500),
    reason,
    recurring: Boolean(raw.recurring),
    ruleKey,
    ruleValue,
  };
}

export function memoryRow(input: DesignMemoryInput, id: string, createdAt = new Date().toISOString()): DesignMemoryView {
  return {
    id,
    kind: input.kind,
    category: input.category,
    brief: input.brief,
    reason: input.reason,
    constitutionVersion: DESIGN_CONSTITUTION_VERSION,
    recurring: input.recurring,
    ruleKey: input.ruleKey,
    ruleValue: input.ruleValue,
    createdAt,
  };
}

/** Newest first. Drops nothing the caller did not already scope to one user. */
export function capMemory<T>(rows: readonly T[], cap = DESIGN_MEMORY_CAP): T[] {
  return rows.slice(0, cap);
}

export function idsBeyondCap(idsNewestFirst: readonly string[], cap = DESIGN_MEMORY_CAP): string[] {
  return idsNewestFirst.slice(cap);
}

/**
 * Recurring rows only. Newest wins per rule key. One-off approvals and
 * rejections stay out of the automatic plan.
 */
export function resolveMemory(rows: readonly DesignMemoryView[]): ResolvedMemory {
  const sorted = [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const rules: ResolvedMemory["rules"] = {};
  const notes: string[] = [];
  for (const row of sorted) {
    if (!row.recurring) continue;
    if (
      row.ruleKey === "density" ||
      row.ruleKey === "format" ||
      row.ruleKey === "avoid-repetition" ||
      row.ruleKey === "customer-brand"
    ) {
      if (rules[row.ruleKey]) continue;
      rules[row.ruleKey] = row.ruleValue;
    }
    if (notes.length < 8 && row.reason) {
      notes.push(`${row.kind}${row.category ? `/${row.category}` : ""}: ${row.reason}`);
    }
  }
  return { rules, notes: notes.join(" | ").slice(0, 1_200) };
}

export function memoryAppliesToCategory(row: DesignMemoryView, category: DesignCategory | ""): boolean {
  return !row.category || !category || row.category === category;
}
