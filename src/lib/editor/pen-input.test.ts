import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import {
  PALM_MIN_CONTACT_PX,
  PEN_GRACE_MS,
  isPalmTouch,
  noteElementTap,
  notePenActivity,
  resetPenInput,
  resetTapPairing,
} from "./pen-input.ts";

const penEvent = (
  type: string,
  pointerId = 1,
  pointerType = "pen",
): { type: string; pointerId: number; pointerType: string } => ({
  type,
  pointerId,
  pointerType,
});

describe("palm rejection", () => {
  beforeEach(() => {
    resetPenInput();
  });

  it("rejects a touch while the pen is pressed", () => {
    notePenActivity(penEvent("pointerdown"), 1000);
    assert.equal(isPalmTouch({ pointerType: "touch" }, 1000), true);
    // Still rejected deep into the stroke.
    assert.equal(isPalmTouch({ pointerType: "touch" }, 1000 + 5000), true);
    notePenActivity(penEvent("pointerup"), 1000 + 5001);
    assert.equal(isPalmTouch({ pointerType: "touch" }, 1000 + 5002), true);
  });

  it("lets a real finger through after the pen has been idle", () => {
    notePenActivity(penEvent("pointerdown"), 0);
    notePenActivity(penEvent("pointerup"), 10);
    // Inside the grace window the contact is still suspect…
    assert.equal(isPalmTouch({ pointerType: "touch" }, 10 + PEN_GRACE_MS - 1), true);
    // …and free the moment the window has fully elapsed.
    assert.equal(
      isPalmTouch({ pointerType: "touch" }, 10 + PEN_GRACE_MS),
      false,
    );
  });

  it("treats pen hover/move activity as recent pen presence", () => {
    notePenActivity(penEvent("pointermove", 7), 2000);
    assert.equal(isPalmTouch({ pointerType: "touch" }, 2000 + 100), true);
    assert.equal(
      isPalmTouch({ pointerType: "touch" }, 2000 + PEN_GRACE_MS + 1),
      false,
    );
  });

  it("rejects a wide contact near the pen as a resting palm", () => {
    notePenActivity(penEvent("pointerdown"), 1000);
    assert.equal(
      isPalmTouch(
        {
          pointerType: "touch",
          width: PALM_MIN_CONTACT_PX,
          height: PALM_MIN_CONTACT_PX,
        },
        1000,
      ),
      true,
    );
    assert.equal(
      isPalmTouch({ pointerType: "touch", width: 12, height: 96 }, 1000),
      true,
    );
  });

  it("lets a fingertip through next to an active Pencil (Pencil + finger)", () => {
    notePenActivity(penEvent("pointerdown"), 1000);
    assert.equal(
      isPalmTouch(
        { pointerType: "touch", width: 14, height: 16 },
        1000 + 5000,
      ),
      false,
    );
    // Also inside the hover grace window: the other hand is deliberate.
    notePenActivity(penEvent("pointerup"), 1000 + 5001);
    assert.equal(
      isPalmTouch({ pointerType: "touch", width: 14, height: 16 }, 1000 + 5002),
      false,
    );
  });

  it("keeps the conservative rule when the platform reports no geometry", () => {
    notePenActivity(penEvent("pointerdown"), 0);
    assert.equal(isPalmTouch({ pointerType: "touch", width: 0 }, 1), true);
    assert.equal(isPalmTouch({ pointerType: "touch", height: 0 }, 1), true);
  });

  it("never rejects the pen itself or a mouse", () => {
    notePenActivity(penEvent("pointerdown"), 0);
    assert.equal(isPalmTouch({ pointerType: "pen" }, 1), false);
    assert.equal(isPalmTouch({ pointerType: "mouse" }, 1), false);
    assert.equal(isPalmTouch({}, 1), false);
  });

  it("ignores non-pen events when recording activity", () => {
    notePenActivity(penEvent("pointerdown", 1, "touch"), 0);
    assert.equal(isPalmTouch({ pointerType: "touch" }, 1), false);
  });

  it("clears the pen-down set on cancel so a lost pointer cannot lock touch out", () => {
    notePenActivity(penEvent("pointerdown"), 0);
    notePenActivity(penEvent("pointercancel"), 1);
    assert.equal(isPalmTouch({ pointerType: "touch" }, 1 + PEN_GRACE_MS), false);
    resetPenInput();
    assert.equal(isPalmTouch({ pointerType: "touch" }, 0), false);
  });

  it("supports multiple pen contacts (one down, one cancelled)", () => {
    notePenActivity(penEvent("pointerdown", 1), 0);
    notePenActivity(penEvent("pointerdown", 2), 5);
    notePenActivity(penEvent("pointercancel", 2), 6);
    assert.equal(isPalmTouch({ pointerType: "touch" }, 7), true);
    notePenActivity(penEvent("pointerup", 1), 8);
    assert.equal(isPalmTouch({ pointerType: "touch" }, 9), true);
  });
});

describe("double-tap pairing", () => {
  beforeEach(() => {
    resetTapPairing();
  });

  it("fires only on a second touch/pen tap of the same page-scoped element", () => {
    assert.equal(noteElementTap("page-1", "el-1", "touch", 0), false);
    assert.equal(noteElementTap("page-1", "el-1", "touch", 150), true);
    // Pairing consumed — a third tap starts a new pair.
    assert.equal(noteElementTap("page-1", "el-1", "touch", 300), false);
  });

  it("does not pair across pages, elements or beyond the window", () => {
    assert.equal(noteElementTap("page-1", "el-1", "pen", 0), false);
    // The same element ID on another page is a different target.
    assert.equal(noteElementTap("page-2", "el-1", "pen", 50), false);
    // A different element breaks the pair…
    assert.equal(noteElementTap("page-2", "el-2", "pen", 100), false);
    // …and so does a gap wider than the double-tap window.
    assert.equal(noteElementTap("page-2", "el-2", "pen", 100 + 401), false);
    assert.equal(noteElementTap("page-2", "el-2", "pen", 100 + 402), true);
  });

  it("never pairs mouse taps (the browser owns native dblclick)", () => {
    assert.equal(noteElementTap("page-1", "el-1", "mouse", 0), false);
    assert.equal(noteElementTap("page-1", "el-1", "mouse", 50), false);
  });
});
