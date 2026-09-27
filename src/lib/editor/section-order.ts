/**
 * Order of the element-tools sections (أدوات العناصر).
 *
 * The six smart-library categories (أشكال · رموز وأيقونات · خطوط وفواصل ·
 * مؤشرات وإنجازات · جداول وإحصائيات · نماذج جاهزة) are reorderable by drag &
 * drop, so the order is real state that must survive a reload. Everything here
 * is pure (no DOM at module scope, no React): the normalising, the move
 * arithmetic and the drop-index resolution are unit-tested with the plain Node
 * runner, the same convention `library-dnd.ts` follows. localStorage is touched
 * only inside the two thin read/write helpers at the bottom.
 */

/** Known section ids, in their default top-to-bottom order. */
export const SMART_SECTION_IDS = [
  "shapes",
  "icons",
  "dividers",
  "indicators",
  "tables",
  "templates",
] as const;

export type SmartSectionId = (typeof SMART_SECTION_IDS)[number];

/** localStorage slot holding the author's section order. */
export const SECTION_ORDER_KEY = "nasaq.smart-sections.order";

export function isSmartSectionId(value: unknown): value is SmartSectionId {
  return (
    typeof value === "string" &&
    (SMART_SECTION_IDS as readonly string[]).includes(value)
  );
}

/**
 * Sanitise a persisted (or hand-crafted) order.
 *
 * Unknown ids are dropped, duplicates collapse to their first occurrence, and
 * any section a previous build did not know about is appended in default order
 * — so a stale key can never hide a section or crash the panel.
 */
export function normalizeSectionOrder(input: unknown): SmartSectionId[] {
  const out: SmartSectionId[] = [];
  if (Array.isArray(input)) {
    for (const id of input) {
      if (isSmartSectionId(id) && !out.includes(id)) out.push(id);
    }
  }
  for (const id of SMART_SECTION_IDS) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Move `order[from]` to position `to`.
 *
 * `to` is the insertion index **after** the item is removed (splice semantics),
 * which is exactly the index a drop resolver computes against the remaining
 * rows — so drag-and-drop can feed its result straight in. Out-of-range indices
 * clamp to the ends; equal indices return a copy unchanged.
 */
export function moveSectionOrder<T>(
  order: readonly T[],
  from: number,
  to: number,
): T[] {
  const next = [...order];
  if (next.length === 0) return next;
  const clamp = (value: number) =>
    Math.max(0, Math.min(next.length - 1, Math.round(value)));
  const source = clamp(from);
  const target = clamp(to);
  if (source === target) return next;
  const [item] = next.splice(source, 1);
  next.splice(target, 0, item);
  return next;
}

/**
 * Where should a dragged row land given the pointer's Y?
 *
 * `slots` are the candidate rows **without** the dragged one, top-to-bottom.
 * The row whose midpoint sits above the pointer is the one the dragged row
 * belongs after; walking until that holds yields the insertion index. Purely
 * vertical, so it reads the same in RTL and LTR.
 */
export function resolveInsertIndex(
  slots: readonly { top: number; bottom: number }[],
  pointerY: number,
): number {
  for (let i = 0; i < slots.length; i += 1) {
    const mid = (slots[i].top + slots[i].bottom) / 2;
    if (pointerY < mid) return i;
  }
  return slots.length;
}

/** Read the persisted order (falls back to the default order). */
export function readSectionOrder(): SmartSectionId[] {
  if (typeof localStorage === "undefined") return [...SMART_SECTION_IDS];
  try {
    const raw = localStorage.getItem(SECTION_ORDER_KEY);
    return normalizeSectionOrder(raw ? JSON.parse(raw) : null);
  } catch {
    return [...SMART_SECTION_IDS];
  }
}

/** Persist the order. Private-mode failures simply stop persisting. */
export function writeSectionOrder(order: readonly SmartSectionId[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      SECTION_ORDER_KEY,
      JSON.stringify(normalizeSectionOrder(order)),
    );
  } catch {
    /* private mode: order just stops persisting */
  }
}
