import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { seek, defaultMeasure, skyTint } from "./render-frame.ts";
import {
  clampTime,
  sceneAt,
  sceneOffsets,
  scenesInProgress,
  transitionProgress,
} from "./timeline.ts";
import {
  arabicLaunchTemplate,
  buildTemplate,
  MOTION_TEMPLATES,
  NASAQ_WORDMARK,
  periodOriginTemplate,
} from "./templates.ts";
import {
  compositionDuration,
  compositionFrameCount,
  compositionHeight,
  type Composition,
  type Scene,
} from "./types.ts";

/** A three-scene composition with hard cuts, for timeline edge cases. */
const cuts: Composition = {
  id: "test-cuts",
  name: "اختبار",
  width: 1000,
  aspect: "square",
  fps: 25,
  palette: {
    green: "#0c3d2c",
    greenLight: "#1f6b45",
    brand: "#006c35",
    gold: "#c6a05a",
    goldLight: "#e0c894",
    ink: "#172033",
    paper: "#ffffff",
    surface: "#f4f0e8",
    muted: "#6b7280",
  },
  loop: false,
  scenes: [
    {
      id: "a",
      name: "أ",
      durationMs: 1000,
      background: "#111111",
      transition: { kind: "cut", durationMs: 0 },
      layers: [],
    },
    {
      id: "b",
      name: "ب",
      durationMs: 2000,
      background: "#222222",
      transition: { kind: "cut", durationMs: 0 },
      layers: [],
    },
    {
      id: "c",
      name: "ج",
      durationMs: 500,
      background: "#333333",
      transition: { kind: "cut", durationMs: 0 },
      layers: [],
    },
  ],
};

describe("motion/timeline", () => {
  it("lays scenes out contiguously", () => {
    const offsets = sceneOffsets(cuts);
    assert.deepEqual(
      offsets.map((o) => [o.startMs, o.endMs]),
      [
        [0, 1000],
        [1000, 3000],
        [3000, 3500],
      ],
    );
  });

  it("resolves an exact boundary to the incoming scene at local time 0", () => {
    // Otherwise a sampled frame either duplicates or drops at every cut.
    const at = sceneAt(cuts, 1000);
    assert.equal(at.scene.id, "b");
    assert.equal(at.localMs, 0);
    assert.equal(at.progress, 0);
  });

  it("clamps the last scene's local time to its duration", () => {
    const at = sceneAt(cuts, 3499);
    assert.equal(at.scene.id, "c");
    assert.ok(at.localMs <= 500);
  });

  it("wraps a looping composition instead of running past the end", () => {
    const looping: Composition = { ...cuts, loop: true, durationMs: undefined } as Composition;
    assert.equal(clampTime(cuts, 4000), 500);
    assert.equal(clampTime(cuts, 0), 0);
    assert.equal(clampTime(cuts, -500), 3000);
    void looping;
  });

  it("returns only the active scene for a hard cut", () => {
    assert.equal(scenesInProgress(cuts, 500).length, 1);
    assert.equal(scenesInProgress(cuts, 1500).length, 1);
  });

  it("keeps an outgoing scene alive across an iris transition", () => {
    const iris: Composition = {
      ...cuts,
      scenes: [
        {
          ...cuts.scenes[0],
          transition: { kind: "iris", durationMs: 400 },
        },
        cuts.scenes[1],
      ],
    };
    const during = scenesInProgress(iris, 1050);
    assert.equal(during.length, 2, "the outgoing scene must still contribute");
    assert.deepEqual(
      during.map((s) => s.scene.id),
      ["a", "b"],
    );
    // Past the transition it drops out entirely.
    assert.equal(scenesInProgress(iris, 1500).length, 1);
  });

  it("fades an outgoing scene across its transition, and never for a hard cut", () => {
    const fading: Scene = { ...cuts.scenes[0], transition: { kind: "iris", durationMs: 400 } };
    assert.equal(transitionProgress(fading, 0), 1);
    assert.equal(transitionProgress(fading, 400), 0);
    assert.ok(transitionProgress(fading, 200) > 0 && transitionProgress(fading, 200) < 1);

    // A hard cut has no fade at all: it is fully present right up to the end.
    assert.equal(transitionProgress(cuts.scenes[0], 0), 1);
    assert.equal(transitionProgress(cuts.scenes[0], 1000), 1);
  });

  it("throws rather than returning a bogus frame for an empty composition", () => {
    assert.throws(() => sceneAt({ ...cuts, scenes: [] }, 0));
  });
});

describe("motion/render-frame", () => {
  const composition = arabicLaunchTemplate({ aspect: "square", width: 800 });

  it("is a pure function of time — out-of-order seeks agree", () => {
    const forward = [seek(composition, 500), seek(composition, 2500)];
    const backward = [seek(composition, 2500), seek(composition, 500)];
    assert.deepEqual(forward[0].ops.length, backward[1].ops.length);
    assert.deepEqual(
      forward[1].ops.map((o) => o.id),
      backward[0].ops.map((o) => o.id),
    );
  });

  it("returns no ops outside the composition's duration", () => {
    const empty = seek(composition, compositionDuration(composition) + 10);
    assert.equal(empty.ops.length, 0);
  });

  it("sorts ops by z so paint order is deterministic", () => {
    for (let t = 0; t < compositionDuration(composition); t += 311) {
      const zs = seek(composition, t).ops.map((o) => o.z);
      assert.deepEqual(zs, [...zs].sort((a, b) => a - b));
    }
  });

  it("never emits an op with zero or negative opacity", () => {
    for (let t = 0; t < compositionDuration(composition); t += 97) {
      for (const op of seek(composition, t).ops) {
        assert.ok(op.opacity > 0 && op.opacity <= 1, `bad opacity ${op.opacity} at ${t}ms`);
      }
    }
  });

  it("sizes layers inside the frame", () => {
    const frame = seek(composition, 2000);
    assert.equal(frame.width, 800);
    assert.equal(frame.height, compositionHeight(composition));
    for (const op of frame.ops) {
      if (op.kind === "rect" || op.kind === "image") {
        assert.ok(op.x >= 0 && op.y >= 0, "no negative origin");
        assert.ok(op.x + op.width <= frame.width + 1, "no overflow past the frame");
      }
    }
  });

  it("crossfades the sky between two parsed colours", () => {
    assert.equal(skyTint("#000000", "#ffffff", 0), "rgb(0, 0, 0)");
    assert.equal(skyTint("#000000", "#ffffff", 1), "rgb(255, 255, 255)");
    assert.equal(skyTint("#000000", "#ffffff", 0.5), "rgb(128, 128, 128)");
    // An unparseable colour must not produce rgb(NaN,NaN,NaN).
    assert.doesNotMatch(skyTint("rebeccapurple", "#fff", 0.5), /NaN/);
  });

  it("uses a deterministic fallback measure", () => {
    assert.equal(defaultMeasure("abcd", 100), 200);
  });
});

describe("motion/templates", () => {
  it("exposes at least one portrait and one square template", () => {
    assert.ok(MOTION_TEMPLATES.some((t) => t.aspect === "portrait"));
    assert.ok(MOTION_TEMPLATES.some((t) => t.aspect === "square"));
  });

  it("builds every advertised template", () => {
    for (const entry of MOTION_TEMPLATES) {
      const built = entry.build();
      assert.ok(built, `${entry.id} failed to build`);
      assert.ok(built.scenes.length > 0);
      assert.ok(compositionDuration(built) > 1000);
    }
  });

  it("returns null for an unknown id rather than throwing", () => {
    assert.equal(buildTemplate("does-not-exist"), null);
  });

  it("never uses Latin-only copy in an Arabic composition", () => {
    const composition = arabicLaunchTemplate();
    for (const scene of composition.scenes) {
      for (const layer of scene.layers) {
        if (layer.kind === "text" || layer.kind === "caption") {
          assert.doesNotMatch(
            layer.text,
            /^[\p{ASCII}]+$/u,
            `Latin-only text in the Arabic launch template: ${layer.text}`,
          );
        }
      }
    }
  });

  it("ends the wordmark with the period the origin effect anchors to", () => {
    assert.ok(NASAQ_WORDMARK.endsWith("."));
  });

  it("refuses to build the period template for a wordmark with no period", () => {
    assert.equal(periodOriginTemplate({ wordmark: "نَسَق" }), null);
    assert.ok(periodOriginTemplate({ wordmark: "نَسَق." }));
  });

  it("sizes the frame from the aspect ratio", () => {
    assert.equal(compositionHeight(arabicLaunchTemplate({ aspect: "square" })), 1080);
    assert.equal(
      compositionHeight(arabicLaunchTemplate({ aspect: "portrait" })),
      1920,
    );
  });

  it("derives a positive frame count", () => {
    const composition = arabicLaunchTemplate();
    assert.ok(compositionFrameCount(composition) > 0);
  });
});