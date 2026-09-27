import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SECTION_ORDER_KEY,
  SMART_SECTION_IDS,
  moveSectionOrder,
  normalizeSectionOrder,
  readSectionOrder,
  resolveInsertIndex,
  writeSectionOrder,
} from "./section-order.ts";

describe("normalizeSectionOrder", () => {
  it("returns the default order for anything unusable", () => {
    assert.deepEqual(normalizeSectionOrder(null), [...SMART_SECTION_IDS]);
    assert.deepEqual(normalizeSectionOrder("shapes"), [...SMART_SECTION_IDS]);
    assert.deepEqual(normalizeSectionOrder({}), [...SMART_SECTION_IDS]);
    assert.deepEqual(normalizeSectionOrder([]), [...SMART_SECTION_IDS]);
    assert.deepEqual(normalizeSectionOrder([42, null]), [...SMART_SECTION_IDS]);
  });

  it("keeps the author's order and appends sections the key never saw", () => {
    const out = normalizeSectionOrder(["tables", "shapes"]);
    assert.deepEqual(out, [
      "tables",
      "shapes",
      "icons",
      "dividers",
      "indicators",
      "templates",
    ]);
  });

  it("drops unknown ids and duplicates", () => {
    const out = normalizeSectionOrder([
      "icons",
      "iframe",
      "icons",
      "templates",
      "templates",
    ]);
    assert.deepEqual(out, [
      "icons",
      "templates",
      "shapes",
      "dividers",
      "indicators",
      "tables",
    ]);
    assert.equal(new Set(out).size, out.length);
  });
});

describe("moveSectionOrder", () => {
  it("moves an item with splice semantics (target after removal)", () => {
    assert.deepEqual(moveSectionOrder([1, 2, 3], 0, 2), [2, 3, 1]);
    assert.deepEqual(moveSectionOrder([1, 2, 3], 2, 0), [3, 1, 2]);
    assert.deepEqual(moveSectionOrder([1, 2, 3], 1, 1), [1, 2, 3]);
  });

  it("clamps out-of-range indices to the ends", () => {
    assert.deepEqual(moveSectionOrder([1, 2, 3], 0, 99), [2, 3, 1]);
    assert.deepEqual(moveSectionOrder([1, 2, 3], 99, 0), [3, 1, 2]);
  });

  it("never mutates the input", () => {
    const input = [1, 2, 3];
    moveSectionOrder(input, 0, 2);
    assert.deepEqual(input, [1, 2, 3]);
  });
});

describe("resolveInsertIndex", () => {
  const slots = [
    { top: 0, bottom: 40 },
    { top: 40, bottom: 80 },
    { top: 80, bottom: 120 },
  ];

  it("inserts above a row once the pointer passes its midpoint", () => {
    assert.equal(resolveInsertIndex(slots, -10), 0);
    assert.equal(resolveInsertIndex(slots, 10), 0); // above row 0's mid (20)
    assert.equal(resolveInsertIndex(slots, 25), 1); // below row 0's mid
    assert.equal(resolveInsertIndex(slots, 65), 2);
  });

  it("lands at the end once the pointer is past every row", () => {
    assert.equal(resolveInsertIndex(slots, 119), 3);
    assert.equal(resolveInsertIndex(slots, 500), 3);
  });

  it("handles an empty list and a single row", () => {
    assert.equal(resolveInsertIndex([], 42), 0);
    assert.equal(resolveInsertIndex([{ top: 10, bottom: 30 }], 5), 0);
    assert.equal(resolveInsertIndex([{ top: 10, bottom: 30 }], 25), 1);
  });
});

describe("readSectionOrder / writeSectionOrder", () => {
  it("round-trips through localStorage and survives garbage", () => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    try {
      writeSectionOrder(["dividers", "shapes"]);
      assert.equal(
        store.get(SECTION_ORDER_KEY),
        '["dividers","shapes","icons","indicators","tables","templates"]',
      );
      assert.deepEqual(readSectionOrder(), [
        "dividers",
        "shapes",
        "icons",
        "indicators",
        "tables",
        "templates",
      ]);

      store.set(SECTION_ORDER_KEY, "{not json");
      assert.deepEqual(readSectionOrder(), [...SMART_SECTION_IDS]);

      store.delete(SECTION_ORDER_KEY);
      assert.deepEqual(readSectionOrder(), [...SMART_SECTION_IDS]);
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });
});
