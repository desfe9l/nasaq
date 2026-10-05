import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FRAME_PLACEHOLDER_SRC,
  IMAGE_FRAMES,
  frameClipParts,
  frameFillRule,
  frameNeedsClip,
  frameOfStyle,
  framedImageOverrides,
  imageFrameDef,
  imageFramesByGroup,
  isImageFrameId,
  normalizeFrameId,
} from "./image-frames.ts";
import { shapeDef, SHAPES } from "./shapes.ts";
import { safeImageSrc } from "./images.ts";

test("the frame catalogue is real geometry, not decoration", () => {
  assert.ok(IMAGE_FRAMES.length >= 20, "a professional gallery, not three tiles");
  const ids = IMAGE_FRAMES.map((frame) => frame.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate frame ids");
  const shapeIds = new Set(SHAPES.map((shape) => shape.id));
  for (const frame of IMAGE_FRAMES) {
    assert.ok(frame.label.trim(), `frame ${frame.id} needs a name`);
    assert.ok(
      shapeIds.has(frame.shapeId),
      `frame ${frame.id} points at unknown shape ${frame.shapeId}`,
    );
    assert.equal(shapeDef(frame.shapeId).id, frame.shapeId);
    assert.ok(frame.w > 0 && frame.h > 0, `frame ${frame.id} needs a size`);
    assert.equal(imageFrameDef(frame.id)?.id, frame.id);
  }
});

test("the shapes the brief names are all in the gallery", () => {
  const required = [
    "circle",
    "rounded",
    "square",
    "portrait",
    "landscape",
    "oval",
    "pill",
    "arch",
    "hexagon",
    "octagon",
    "diamond",
    "triangle",
    "blob",
  ];
  for (const id of required) {
    assert.ok(imageFrameDef(id), `missing frame ${id}`);
  }
  assert.ok(
    IMAGE_FRAMES.some((frame) => frame.group === "organic"),
    "organic/editorial silhouettes must be offered",
  );
  assert.ok(imageFramesByGroup("basic").length > 0);
});

test("frame clips are fractional box geometry — they scale with the picture", () => {
  assert.equal(frameClipParts("square"), null, "a plain box needs no clip");
  assert.equal(frameNeedsClip(imageFrameDef("square")), false);
  for (const frame of IMAGE_FRAMES) {
    const parts = frameClipParts(frame.id);
    if (!frameNeedsClip(frame)) {
      assert.equal(parts, null, `${frame.id} is a box frame`);
      continue;
    }
    assert.ok(parts && parts.length > 0, `${frame.id} produced no clip geometry`);
    for (const part of parts!) {
      const values = Object.entries(part)
        .filter(([, v]) => typeof v === "number")
        .map(([, v]) => v as number);
      for (const value of values) {
        assert.ok(
          value >= -0.01 && value <= 1.01,
          `${frame.id} clip coordinate ${value} is not in objectBoundingBox units`,
        );
      }
      assert.notEqual(
        part.k,
        "circle",
        `${frame.id}: a circle in bounding-box units is scaled by the diagonal`,
      );
    }
  }
});

test("an unknown or corrupt frame id degrades to a plain rectangle", () => {
  assert.equal(normalizeFrameId("nope"), undefined);
  assert.equal(normalizeFrameId(undefined), undefined);
  assert.equal(normalizeFrameId(42), undefined);
  assert.equal(normalizeFrameId("circle"), "circle");
  assert.ok(isImageFrameId("blob"));
  assert.ok(!isImageFrameId("__proto__"));
  assert.equal(frameOfStyle(undefined), null);
  assert.equal(frameOfStyle({ frameId: "gone" }), null);
  assert.equal(frameOfStyle({ frameId: "arch" })?.id, "arch");
  assert.equal(frameFillRule("circle"), undefined);
});

test("one click yields an editable framed image element", () => {
  const overrides = framedImageOverrides("circle");
  assert.ok(overrides);
  assert.equal(overrides!.style.frameId, "circle");
  assert.equal(overrides!.style.objectFit, "cover");
  assert.equal(overrides!.style.aspectLock, true, "a circle keeps its proportions");
  assert.equal(overrides!.w, overrides!.h);
  // The placeholder is a real, safe image source, so the frame shows at once.
  assert.ok(safeImageSrc(overrides!.src), "placeholder must survive safeImageSrc");
  assert.equal(safeImageSrc(FRAME_PLACEHOLDER_SRC), FRAME_PLACEHOLDER_SRC);
  assert.equal(framedImageOverrides("missing"), null);
  assert.equal(framedImageOverrides("landscape")!.style.aspectLock, false);
});
