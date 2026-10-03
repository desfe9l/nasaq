import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_FADE,
  FADE_DIRECTIONS,
  fadeBackground,
  fadeDirectionLabel,
  fadeStyle,
  isFadeOverlay,
  normalizeFade,
  type FadeOverlay,
} from "./fade.ts";

describe("fade overlay", () => {
  it("builds a physical linear gradient per direction", () => {
    assert.equal(
      fadeBackground({ ...DEFAULT_FADE, direction: "toBottom" }),
      "linear-gradient(to bottom, #0f172a, transparent)",
    );
    assert.equal(
      fadeBackground({ ...DEFAULT_FADE, direction: "toTop" }),
      "linear-gradient(to top, #0f172a, transparent)",
    );
    // Physical, not logical: the author chose "left to right", so it stays that.
    assert.equal(
      fadeBackground({ ...DEFAULT_FADE, direction: "toRight" }),
      "linear-gradient(to right, #0f172a, transparent)",
    );
  });

  it("builds a centred radial gradient", () => {
    assert.equal(
      fadeBackground({
        ...DEFAULT_FADE,
        direction: "radial",
        from: "#000000",
        to: "#ffffff",
      }),
      "radial-gradient(circle at 50% 50%, #000000, #ffffff)",
    );
  });

  it("has a human label for every direction", () => {
    for (const direction of FADE_DIRECTIONS) {
      assert.ok(fadeDirectionLabel(direction).length > 3, direction);
    }
  });

  it("spreads into a layer style with blend and opacity", () => {
    const style = fadeStyle({
      ...DEFAULT_FADE,
      direction: "toTop",
      opacity: 0.4,
      blend: "multiply",
    });
    assert.equal(style.opacity, 0.4);
    assert.equal(style.mixBlendMode, "multiply");
    assert.match(style.background, /^linear-gradient\(to top/);
  });

  it("rejects anything that is not a fade", () => {
    assert.equal(isFadeOverlay(null), false);
    assert.equal(isFadeOverlay(undefined), false);
    assert.equal(isFadeOverlay("toBottom"), false);
    assert.equal(
      isFadeOverlay({ direction: "sideways", from: "#000", to: "#fff" }),
      false,
    );
    assert.equal(
      isFadeOverlay({ direction: "toBottom", from: "#000", to: "#fff" }),
      true,
    );
  });

  it("repairs a hand-edited save instead of throwing", () => {
    const repaired = normalizeFade({
      direction: "toLeft",
      from: "",
      to: "",
      opacity: 9,
    } as unknown as FadeOverlay);
    assert.equal(
      repaired,
      null,
      "an unknown direction is not renderable at all",
    );

    const partial = normalizeFade({
      direction: "radial",
      from: "",
      to: "",
      opacity: 9,
      blend: "hue",
    } as unknown as FadeOverlay);
    assert.ok(partial);
    assert.equal(partial.from, "#000000");
    assert.equal(partial.to, "transparent");
    assert.equal(partial.opacity, 1);
    assert.equal(partial.blend, "normal");
  });

  it("clamps a negative opacity to zero", () => {
    const fixed = normalizeFade({ ...DEFAULT_FADE, opacity: -3 });
    assert.ok(fixed);
    assert.equal(fixed.opacity, 0);
  });

  it("keeps the default overlay renderable", () => {
    assert.deepEqual(normalizeFade(DEFAULT_FADE), DEFAULT_FADE);
  });
});
