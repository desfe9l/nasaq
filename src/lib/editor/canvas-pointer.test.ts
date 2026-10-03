import assert from "node:assert/strict";
import { test } from "node:test";
import { CanvasPointerSession } from "./canvas-pointer.ts";
const p = (
  pointerId: number,
  clientX = 0,
  clientY = 0,
  pointerType = "touch",
) => ({ pointerId, clientX, clientY, pointerType }) as PointerEvent;
function fixture() {
  const calls = { undo: 0, redo: 0, nav: 0, move: 0, end: 0, cancel: 0 };
  const input = new CanvasPointerSession({
    undo: () => calls.undo++,
    redo: () => calls.redo++,
    navigate: () => () => calls.nav++,
  });
  const claim = (e: PointerEvent, yieldable = true) =>
    input.claim(e, {
      yieldable,
      move: () => calls.move++,
      end: () => calls.end++,
      cancel: () => calls.cancel++,
    });
  return { input, calls, claim };
}
test("two fingers promote only a pending press, then undo exactly once after sequential lifts", () => {
  const { input, calls, claim } = fixture();
  input.down(p(1), 0);
  claim(p(1));
  assert.equal(input.down(p(2, 100), 40), true);
  assert.equal(calls.cancel, 1);
  input.end(p(1), false, 110);
  input.end(p(1), true, 111); // implicit lostpointercapture after pointerup
  assert.equal(calls.undo, 0);
  input.end(p(2, 100), false, 150);
  input.end(p(2, 100), false, 170);
  assert.equal(calls.undo, 1);
  assert.equal(calls.end, 0);
});
test("stationary-centroid pinch cannot undo", () => {
  const { input, calls } = fixture();
  input.down(p(1, 100), 0);
  input.down(p(2, 200), 20);
  input.move(p(1, 80));
  input.move(p(2, 220));
  input.end(p(1, 80), false, 100);
  input.end(p(2, 220), false, 120);
  assert.ok(calls.nav > 0);
  assert.equal(calls.undo, 0);
});
test("pan, even returning to its origin, is not an undo tap", () => {
  const { input, calls } = fixture();
  input.down(p(1), 0);
  input.down(p(2, 100), 20);
  input.move(p(1, 20));
  input.move(p(2, 120));
  input.move(p(1));
  input.move(p(2, 100));
  input.end(p(1), false, 100);
  input.end(p(2, 100), false, 120);
  assert.equal(calls.undo, 0);
  assert.ok(calls.nav > 0);
});
test("handle/established drag retains ownership: other pointers cannot move or finish it", () => {
  for (const kind of ["touch", "pen", "mouse"]) {
    const { input, calls, claim } = fixture();
    input.down(p(1, 0, 0, kind), 0);
    claim(p(1, 0, 0, kind), false);
    input.down(p(2, 100), 10);
    input.move(p(2, 150));
    input.end(p(2, 150), false, 100);
    assert.equal(calls.move, 0);
    assert.equal(calls.end, 0);
    assert.equal(calls.cancel, 0);
    input.move(p(1, 10, 0, kind));
    input.end(p(1, 10, 0, kind), false, 150);
    assert.equal(calls.move, 1);
    assert.equal(calls.end, 1);
    assert.equal(calls.nav, 0);
    assert.equal(calls.undo, 0);
  }
});
test("lock removes pending-press eligibility", () => {
  const { input, calls, claim } = fixture();
  input.down(p(1), 0);
  claim(p(1));
  input.lock(1);
  input.down(p(2, 100), 30);
  assert.equal(calls.cancel, 0);
  assert.equal(calls.nav, 0);
});
test("cancel and blur dispose without undo or ghost callbacks", () => {
  const { input, calls, claim } = fixture();
  input.down(p(1), 0);
  input.down(p(2, 100), 20);
  input.end(p(1), true, 80);
  input.end(p(2, 100), false, 100);
  assert.equal(calls.undo, 0);
  input.down(p(3), 200);
  claim(p(3));
  input.reset();
  input.move(p(3, 50));
  assert.equal(calls.cancel, 1);
  assert.equal(calls.move, 0);
  assert.equal(input.busy, false);
});
test("slow/additional contacts and final-up displacement cannot undo", () => {
  for (const mode of ["slow", "late", "four", "final-move"]) {
    const { input, calls } = fixture();
    input.down(p(1), 0);
    input.down(p(2, 100), mode === "late" ? 220 : 20);
    if (mode === "four") {
      input.down(p(3, 150), 30);
      input.down(p(4, 200), 40);
      input.end(p(3, 150), false, 50);
      input.end(p(4, 200), false, 60);
    }
    input.end(p(1, mode === "final-move" ? 10 : 0), false, 250);
    input.end(p(2, 100), false, mode === "slow" ? 400 : 280);
    assert.equal(calls.undo, 0, mode);
  }
});
test("three-finger redo is preserved and cannot also undo", () => {
  const { input, calls } = fixture();
  input.down(p(1), 0);
  input.down(p(2, 100), 20);
  input.down(p(3, 200), 40);
  input.end(p(1), false, 80);
  input.end(p(2, 100), false, 100);
  input.end(p(3, 200), false, 120);
  assert.equal(calls.redo, 1);
  assert.equal(calls.undo, 0);
});
