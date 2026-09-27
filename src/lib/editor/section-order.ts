/** UI-only order; no library data or document state is written here. */
export const SECTION_ORDER_KEY = "nasaq.element-tools.order.v1";
export const ELEMENT_SECTION_IDS = [
  "shapes",
  "icons",
  "dividers",
  "indicators",
  "tables",
  "templates",
] as const;

/** Keep known unique IDs and append new sections after an app update. */
export function normalizeSectionOrder(
  value: unknown,
  ids: readonly string[] = ELEMENT_SECTION_IDS,
): string[] {
  const saved = Array.isArray(value)
    ? value.filter(
        (id): id is string => typeof id === "string" && ids.includes(id),
      )
    : [];
  return [...new Set([...saved, ...ids])];
}

export function moveSection(
  order: readonly string[],
  id: string,
  index: number,
): string[] {
  if (!order.includes(id) || !Number.isFinite(index)) return [...order];
  const next = order.filter((item) => item !== id);
  next.splice(Math.max(0, Math.min(next.length, Math.trunc(index))), 0, id);
  return next;
}
