import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LIBRARY_DROP_TYPES,
  insertLibraryDrop,
  normalizeLibraryDrop,
  parseLibraryDrop,
  serializeLibraryDrop,
  type InsertedBox,
} from "./library-dnd.ts";

describe("normalizeLibraryDrop", () => {
  it("accepts a well-formed payload and keeps offsets", () => {
    const out = normalizeLibraryDrop({
      items: [
        { type: "progress", over: { name: "عمود" }, dx: 0, dy: -18 },
        { type: "progress", dx: 0, dy: 18 },
      ],
    });
    assert.ok(out);
    assert.equal(out!.items.length, 2);
    assert.equal(out!.items[0].dy, -18);
    assert.deepEqual(out!.items[0].over, { name: "عمود" });
  });

  it("drops unknown element types instead of inserting junk", () => {
    const out = normalizeLibraryDrop({ items: [{ type: "iframe" }, { type: "table" }] });
    assert.ok(out);
    assert.equal(out!.items.length, 1);
    assert.equal(out!.items[0].type, "table");
    assert.ok((LIBRARY_DROP_TYPES as readonly string[]).includes("table"));
  });

  it("returns null for anything that is not a payload", () => {
    assert.equal(normalizeLibraryDrop(null), null);
    assert.equal(normalizeLibraryDrop("table"), null);
    assert.equal(normalizeLibraryDrop({ items: "table" }), null);
    assert.equal(normalizeLibraryDrop({ items: [{ type: "iframe" }] }), null);
  });

  it("caps a hand-crafted payload so it cannot flood the page", () => {
    const items = Array.from({ length: 40 }, () => ({ type: "progress" }));
    const out = normalizeLibraryDrop({ items });
    assert.equal(out!.items.length, 8);
  });

  it("ignores non-finite offsets rather than producing NaN geometry", () => {
    const out = normalizeLibraryDrop({ items: [{ type: "table", dx: Number.NaN, dy: Infinity }] });
    assert.equal(out!.items[0].dx, undefined);
    assert.equal(out!.items[0].dy, undefined);
  });
});

describe("serialize/parse round trip", () => {
  it("survives a dataTransfer round trip", () => {
    const payload = { items: [{ type: "table", over: { style: { cols: 3, rows: 4 } }, dx: 2 }] };
    const raw = serializeLibraryDrop(payload);
    assert.deepEqual(parseLibraryDrop(raw), normalizeLibraryDrop(payload));
  });

  it("returns null for foreign or empty drag data", () => {
    assert.equal(parseLibraryDrop(""), null);
    assert.equal(parseLibraryDrop(null), null);
    assert.equal(parseLibraryDrop("just some text"), null);
    assert.equal(parseLibraryDrop('{"items":[]}'), null);
  });
});

describe("insertLibraryDrop", () => {
  /** Fake store: records every insert and returns the box it was given. */
  const recorder = () => {
    const calls: Array<{ type: string; over: Record<string, unknown>; center?: { x: number; y: number } }> = [];
    const addAt = (type: string, over: Record<string, unknown>, center?: { x: number; y: number }): InsertedBox => {
      calls.push({ type, over, center });
      // Simulate the store centring the element on the requested point.
      const w = Number(over.w ?? 40);
      const h = Number(over.h ?? 30);
      const x = (center?.x ?? 100) - w / 2;
      const y = (center?.y ?? 200) - h / 2;
      return { x, y, w, h };
    };
    return { calls, addAt };
  };

  it("anchors the first item on the drop point and keeps the template layout", () => {
    const { calls, addAt } = recorder();
    const created = insertLibraryDrop(
      {
        items: [
          { type: "progress", over: { w: 92, h: 14 }, dy: -18 },
          { type: "progress", over: { w: 92, h: 14 }, dy: 0 },
          { type: "progress", over: { w: 92, h: 14 }, dy: 18 },
        ],
      },
      { x: 60, y: 120 },
      addAt,
    );
    assert.equal(created, 3);
    assert.deepEqual(calls[0].center, { x: 60, y: 102 });
    assert.deepEqual(calls[1].center, { x: 60, y: 120 });
    assert.deepEqual(calls[2].center, { x: 60, y: 138 });
  });

  it("centres the first element itself when the card is clicked, then follows it", () => {
    const { calls, addAt } = recorder();
    insertLibraryDrop({ items: [{ type: "table", over: { w: 100, h: 40 } }, { type: "progress", dx: 30 }] }, null, addAt);
    assert.equal(calls[0].center, undefined, "click insert keeps the default centred placement");
    // The fake store centres the first element at (100, 200); the sibling keeps
    // its +30mm offset from that centre, exactly as it would after a drop.
    assert.deepEqual(calls[1].center, { x: 130, y: 200 });
  });

  it("skips items the store refuses and still reports the real count", () => {
    const calls: string[] = [];
    const created = insertLibraryDrop({ items: [{ type: "table" }, { type: "progress" }] }, { x: 0, y: 0 }, (type) => {
      calls.push(type);
      return type === "progress" ? { x: 0, y: 0, w: 10, h: 10 } : undefined;
    });
    assert.equal(created, 1);
    assert.deepEqual(calls, ["table", "progress"]);
  });
});
