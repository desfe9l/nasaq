import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanvasEl } from "./model.ts";
import { nudgeStack, restack } from "./layers.ts";

function layer(id: string, z: number): CanvasEl {
  return {
    id,
    z,
    type: "text",
    name: id,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    rotation: 0,
    opacity: 1,
    content: "",
    style: {},
  };
}

test("restack honors the drop side and rewrites z with the array", () => {
  const list = [layer("a", 1), layer("b", 3), layer("c", 2)];
  const after = restack(list, "a", "b", "after");
  assert.ok(after);
  assert.deepEqual(after!.map((el) => el.id), ["b", "a", "c"]);
  assert.deepEqual(after!.map((el) => el.z), [3, 2, 1]);
  const before = restack(list, "a", "b", "before");
  assert.deepEqual(before!.map((el) => el.id), ["a", "b", "c"]);
});

test("nudgeStack moves toward the front without losing siblings", () => {
  const list = [layer("a", 1), layer("b", 2)];
  const next = nudgeStack(list, "a", 1);
  assert.deepEqual(next!.map((el) => [el.id, el.z]), [["a", 2], ["b", 1]]);
  assert.equal(nudgeStack(list, "b", 1), null);
});
