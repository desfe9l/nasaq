import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { splitClusters } from "./arabic-type.ts";
import {
  findPeriodAnchor,
  hasPeriodAnchor,
  periodOriginProblem,
  periodOriginState,
  splitAroundAnchor,
  wordmarkOriginFor,
  type TextMeasure,
} from "./period-origin.ts";

/**
 * Cluster-aware measure: 0.5em per *grapheme cluster*, not per UTF-16 unit.
 *
 * This matters. A code-unit measure would price «نَسَق.» at 5 units (two
 * fathas counted as characters), while the anchor index comes from clusters —
 * so the two would disagree and every derived x would drift. A real shaping
 * engine advances per cluster too, which is what this mirrors.
 */
const measure: TextMeasure = (text, fontSize) =>
  splitClusters(text).length * fontSize * 0.5;

const config = {
  startMs: 0,
  openMs: 1000,
  closeMs: 2000,
  endMs: 3000,
  centreX: 500,
  centreY: 400,
  maxDiameter: 600,
  inner: {
    background: "#0c3d2c",
    accent: "#c6a05a",
    beats: [
      { text: "أول", startMs: 900, endMs: 1500 },
      { text: "ثاني", startMs: 1500, endMs: 2200 },
    ],
  },
};

describe("motion/period-origin", () => {
  describe("anchor detection", () => {
    it("anchors to the final period of a wordmark", () => {
      const anchor = findPeriodAnchor("نَسَق.", 100, measure);
      assert.ok(anchor, "expected an anchor for «نَسَق.»");
      // «نَسَق.» is 4 clusters — the two fathas weld onto ن and س, so the
      // period is the 4th, not the 6th. This is the tashkeel-welding contract.
      assert.equal(anchor.clusterIndex, 3);
      assert.ok(Math.abs(anchor.x - 175) < 1e-9, `x was ${anchor.x}`);
      assert.ok(Math.abs(anchor.width - 50) < 1e-9);
    });

    it("prefers the last period when the wordmark contains several", () => {
      const anchor = findPeriodAnchor("نَسَق. نَسَق.", 100, measure);
      assert.ok(anchor);
      // Must not anchor to the first period — the tail would fall outside.
      assert.equal(anchor.clusterIndex, 8);
      assert.ok(Math.abs(anchor.x - 425) < 1e-9, `x was ${anchor.x}`);
    });

    it("returns null when there is no period to grow from", () => {
      assert.equal(findPeriodAnchor("نَسَق", 100, measure), null);
      assert.equal(findPeriodAnchor("", 100, measure), null);
      assert.equal(hasPeriodAnchor("نَسَق"), false);
      assert.equal(hasPeriodAnchor("نَسَق."), true);
    });

    it("accepts the Arabic full stop and the middle dot as anchors", () => {
      assert.ok(findPeriodAnchor("نَسَق۔", 100, measure));
      assert.ok(findPeriodAnchor("نَسَق·", 100, measure));
    });

    it("keeps a tashkeel-marked letter with its base when indexing", () => {
      // «نَسَق.» — the two fathas stay welded to their base letters, so the
      // period is cluster 3, not 5.
      const anchor = findPeriodAnchor("نَسَق.", 100, measure);
      assert.equal(anchor?.clusterIndex, 3);
    });

    it("splits the wordmark around the anchor for per-glyph styling", () => {
      const anchor = findPeriodAnchor("نَسَق.", 100, measure);
      assert.ok(anchor);
      const parts = splitAroundAnchor("نَسَق.", anchor);
      assert.equal(parts.anchor, ".");
      assert.equal(parts.before, "نَسَق");
      assert.equal(parts.after, "");
    });
  });

  describe("state", () => {
    it("is fully closed before the cycle and fully closed after it", () => {
      assert.equal(periodOriginState(-500, config).radius, 0);
      const after = periodOriginState(5000, config);
      assert.equal(after.radius, 0);
      assert.equal(after.innerVisible, false);
    });

    it("reaches its full radius while open", () => {
      const state = periodOriginState(1500, config);
      assert.ok(Math.abs(state.radius - 300) < 1e-6, `radius was ${state.radius}`);
      assert.equal(state.innerVisible, true);
    });

    it("eases the area, so the radius outpaces the raw progress early", () => {
      const early = periodOriginState(200, config);
      const rawRadius = 200 / 1000; // radius if it were eased directly
      const areaRadius = early.radius / 300;
      assert.ok(
        areaRadius > rawRadius,
        "area easing must open faster than radius easing in the early frames",
      );
    });

    it("never exceeds its maximum diameter", () => {
      for (let t = 0; t <= 3000; t += 17) {
        const state = periodOriginState(t, config);
        assert.ok(state.radius <= 300 + 1e-9, `radius exceeded max at ${t}ms`);
        assert.ok(state.radius >= 0);
      }
    });

    it("locks the ink crossfade to the iris's perceived growth", () => {
      // The crossfade tracks the *radius*, not the area: perceived growth
      // follows the visible disc, and tuning that is the whole reason for area
      // easing. Tracking `open` directly would reach full gold while the disc
      // still looked tiny, which reads as a pop rather than a bloom.
      const maxRadius = config.maxDiameter / 2;
      for (let t = 0; t <= 1000; t += 13) {
        const state = periodOriginState(t, config);
        assert.ok(
          Math.abs(state.inkMix - state.radius / maxRadius) < 1e-9,
          `ink/radius disagreed at ${t}ms: ${state.inkMix} vs ${state.radius / maxRadius}`,
        );
      }
    });

    it("holds the inner ink through the close so the wordmark does not flicker", () => {
      // During the close the iris shrinks but the ink must stay inner — a
      // mirrored crossfade would strobe the wordmark on every loop.
      const whileClosing = periodOriginState(2400, config);
      assert.equal(whileClosing.inkMix, 1);
      assert.ok(whileClosing.open < 1, "the iris should be closing here");
    });

    it("holds the ink mix once fully open", () => {
      const open = periodOriginState(1500, config);
      const stillOpen = periodOriginState(1900, config);
      assert.ok(Math.abs(open.inkMix - stillOpen.inkMix) < 1e-9);
    });

    it("reports which inner beat is playing", () => {
      assert.equal(periodOriginState(1000, config).beatIndex, 0);
      assert.equal(periodOriginState(1600, config).beatIndex, 1);
      assert.equal(periodOriginState(2600, config).beatIndex, -1);
    });

    it("reports the anchor centre so the world rides with it", () => {
      const state = periodOriginState(1500, config);
      assert.equal(state.centreX, 500);
      assert.equal(state.centreY, 400);
    });
  });

  describe("wordmark placement", () => {
    it("positions the wordmark so the anchor lands on the target", () => {
      const wordmark = "نَسَق.";
      const anchor = findPeriodAnchor(wordmark, 100, measure);
      assert.ok(anchor);
      const target = 500;
      const origin = wordmarkOriginFor(wordmark, 100, measure, anchor, target);
      // Anchor centre relative to the draw origin must equal the target.
      assert.ok(Math.abs(origin + anchor.x - target) < 1e-9);
    });
  });

  describe("guard", () => {
    it("rejects a wordmark with no period", () => {
      assert.ok(periodOriginProblem("نَسَق"));
    });

    it("rejects a period that is not the final character", () => {
      assert.ok(periodOriginProblem("نَسَق.تجريبي"));
    });

    it("accepts a proper wordmark", () => {
      assert.equal(periodOriginProblem("نَسَق."), null);
    });

    it("rejects an empty name", () => {
      assert.ok(periodOriginProblem(""));
    });
  });
});