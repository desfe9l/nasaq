import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  interactionState,
  marqueeForPage,
  useInteraction,
  type TransientGeom,
} from "./interaction-store.ts";

/**
 * The transient interaction layer. These tests pin the contract the canvas
 * drag loop relies on: overrides are keyed per element, publishing one
 * element's geometry never disturbs another's, and `endInteraction` clears
 * every overlay in one step.
 */

function reset() {
  interactionState().endInteraction();
}

describe("interaction store", () => {
  it("begins and ends an interaction atomically", () => {
    reset();
    interactionState().beginInteraction();
    assert.equal(useInteraction.getState().active, true);
    interactionState().endInteraction();
    assert.equal(useInteraction.getState().active, false);
    assert.equal(Object.keys(useInteraction.getState().overrides).length, 0);
    assert.equal(useInteraction.getState().marquee, null);
    assert.equal(useInteraction.getState().rotationHint, null);
  });

  it("isolates per-element overrides", () => {
    reset();
    const s = interactionState();
    s.beginInteraction();
    s.setOverride("el-a", { x: 10, y: 20 });
    s.setOverride("el-b", { x: 1, y: 2 });

    const state = useInteraction.getState();
    assert.deepEqual(state.overrides["el-a"], { x: 10, y: 20 });
    assert.deepEqual(state.overrides["el-b"], { x: 1, y: 2 });

    // Updating one element must not replace the other's override object.
    const before: TransientGeom | undefined = state.overrides["el-b"];
    useInteraction.getState().setOverride("el-a", { x: 11, y: 21 });
    assert.equal(useInteraction.getState().overrides["el-b"], before);
    interactionState().endInteraction();
  });

  it("bumps the version on every transient write", () => {
    reset();
    const v0 = useInteraction.getState().version;
    interactionState().setOverride("x", { x: 0 });
    assert.ok(useInteraction.getState().version > v0);
    interactionState().setGuides({ v: [5], h: [] });
    assert.ok(useInteraction.getState().version > v0 + 1);
    interactionState().setMarquee({
      pageId: "page-a",
      x0: 0,
      y0: 0,
      x1: 5,
      y1: 5,
    });
    assert.ok(useInteraction.getState().version > v0 + 2);
    assert.ok(marqueeForPage(useInteraction.getState().marquee, "page-a"));
    assert.equal(marqueeForPage(useInteraction.getState().marquee, "page-b"), null);
    interactionState().endInteraction();
    // End also notifies (a follower gets the final clear).
    assert.ok(useInteraction.getState().version > v0 + 3);
  });

  it("collapses empty guides to the shared empty object", () => {
    reset();
    interactionState().setGuides({ v: [], h: [] });
    const { guides } = useInteraction.getState();
    assert.equal(guides.v.length, 0);
    assert.equal(guides.h.length, 0);
    interactionState().endInteraction();
  });

  it("notifies only subscribers whose selected slice changed", () => {
    reset();
    let aNotifications = 0;
    let bNotifications = 0;
    const unsubA = useInteraction.subscribe((s) => {
      // Selector the way a component would use it.
      if (s.overrides["el-a"]) aNotifications += 1;
    });
    const unsubB = useInteraction.subscribe((s) => {
      if (s.overrides["el-b"]) bNotifications += 1;
    });

    const s = interactionState();
    s.beginInteraction();
    s.setOverride("el-a", { x: 1 });
    assert.equal(aNotifications, 1);
    assert.equal(bNotifications, 0);
    s.setOverride("el-a", { x: 2 });
    assert.equal(aNotifications, 2);
    assert.equal(bNotifications, 0);

    unsubA();
    unsubB();
    interactionState().endInteraction();
  });
});
