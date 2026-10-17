import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MOTION_RUNTIME_JS } from "./html-runtime.ts";
import {
  compositionClips,
  emitCompositionHtml,
  stageScaleScript,
} from "./html.ts";
import { seek, type FrameOp } from "./render-frame.ts";
import { splitClusters } from "./arabic-type.ts";
import { arabicLaunchTemplate, periodOriginTemplate } from "./templates.ts";
import type { TextMeasure } from "./period-origin.ts";
import { compositionDuration, compositionFrameCount } from "./types.ts";

/**
 * Cluster-aware measure, used for BOTH engines so the comparison isolates the
 * renderer rather than measuring. This mirrors a real shaping engine, which
 * advances per grapheme cluster rather than per UTF-16 unit.
 */
const measure: TextMeasure = (text, fontSize) =>
  splitClusters(text).length * fontSize * 0.5;

/** Evaluate the embedded runtime outside a browser and return its API. */
const loadRuntime = (): {
  frameAt: (c: unknown, t: number, m?: TextMeasure) => { ops: FrameOp[]; background: string };
  durationOf: (c: unknown) => number;
} => {
  const factory = new Function(
    MOTION_RUNTIME_JS +
      "\nreturn (typeof NasaqMotion !== 'undefined' ? NasaqMotion : globalThis.NasaqMotion);",
  );
  return factory() as never;
};

const runtime = loadRuntime();

/** Fields that must agree exactly between the two engines. */
const comparable = (ops: FrameOp[]): unknown[] =>
  ops.map((op) => {
    const base: Record<string, unknown> = {
      kind: op.kind,
      id: op.id,
      z: op.z,
      opacity: Math.round(op.opacity * 1e6) / 1e6,
    };
    if (op.kind === "text") {
      return {
        ...base,
        text: op.text,
        revealed: op.revealed,
        fontSize: op.fontSize,
        x: Math.round(op.x * 1e4) / 1e4,
        y: Math.round(op.y * 1e4) / 1e4,
        direction: op.direction,
      };
    }
    if (op.kind === "caption") {
      return { ...base, text: op.text, x: op.x, y: op.y };
    }
    if (op.kind === "rect") {
      return {
        ...base,
        x: Math.round(op.x * 1e4) / 1e4,
        y: Math.round(op.y * 1e4) / 1e4,
        width: Math.round(op.width * 1e4) / 1e4,
        height: Math.round(op.height * 1e4) / 1e4,
      };
    }
    if (op.kind === "progress") {
      return {
        ...base,
        value: Math.round(op.value * 1e6) / 1e6,
        width: op.width,
      };
    }
    if (op.kind === "period-origin") {
      return {
        ...base,
        originX: Math.round(op.originX * 1e4) / 1e4,
        radius: Math.round(op.radius * 1e4) / 1e4,
        centreX: op.centreX,
        centreY: op.centreY,
        beatIndex: op.beatIndex,
        anchorIndex: op.anchor.clusterIndex,
      };
    }
    return base;
  });

describe("motion/html", () => {
  const compositions = [
    { name: "arabic launch (portrait)", comp: arabicLaunchTemplate({ aspect: "portrait" }) },
    { name: "arabic launch (square)", comp: arabicLaunchTemplate({ aspect: "square" }) },
    { name: "period origin", comp: periodOriginTemplate({ aspect: "square" }) },
  ];

  describe("runtime parity with the TypeScript engine", () => {
    for (const { name, comp } of compositions) {
      if (!comp) continue;
      it(`emitted runtime reproduces seek() exactly — ${name}`, () => {
        const total = compositionDuration(comp);
        // Sample across the whole timeline including every scene boundary.
        const samples: number[] = [];
        for (let t = 0; t < total; t += 137) samples.push(t);
        samples.push(total - 1, total / 2, 0);

        for (const t of samples) {
          const ts = seek(comp, t, { measure });
          const js = runtime.frameAt(comp, t, measure);
          assert.equal(
            js.background,
            ts.background,
            `background mismatch at ${t}ms`,
          );
          assert.deepEqual(
            comparable(js.ops as FrameOp[]),
            comparable(ts.ops),
            `frame mismatch at ${t}ms in "${name}"`,
          );
        }
      });
    }

    it("agrees on total duration", () => {
      for (const { comp } of compositions) {
        if (!comp) continue;
        assert.equal(runtime.durationOf(comp), compositionDuration(comp));
      }
    });
  });

  describe("clips", () => {
    it("emits one clip per scene, contiguous and ordered", () => {
      const comp = arabicLaunchTemplate();
      const clips = compositionClips(comp);
      assert.equal(clips.length, comp.scenes.length);
      for (let i = 1; i < clips.length; i += 1) {
        assert.equal(
          clips[i].startMs,
          clips[i - 1].startMs + comp.scenes[i - 1].durationMs,
          "clips must be contiguous",
        );
      }
    });

    it("pulls each clip end in by a frame so the final state renders", () => {
      // The visibility window is half-open, so a clip ending exactly on the
      // scene end would never show its resolved end state.
      const comp = arabicLaunchTemplate();
      const clips = compositionClips(comp);
      for (let i = 0; i < clips.length; i += 1) {
        const sceneEnd = clips[i].startMs + comp.scenes[i].durationMs;
        assert.ok(clips[i].endMs < sceneEnd, `clip ${i} must end before its scene`);
      }
    });
  });

  describe("document structure", () => {
    const html = emitCompositionHtml(arabicLaunchTemplate({ aspect: "portrait" }), {
      title: "اختبار",
      fonts: [
        { family: "Alexandria", weight: 800, src: "url(data:font/woff2;base64,AAAA)" },
      ],
    });

    it("declares the required root attributes", () => {
      const comp = arabicLaunchTemplate({ aspect: "portrait" });
      assert.match(html, new RegExp(`data-composition-id="${comp.id}"`));
      assert.match(html, /data-width="1080"/);
      assert.match(html, /data-height="1920"/);
      assert.match(html, /data-root="true"/);
      assert.ok(html.includes(`data-fps="${comp.fps}"`));
    });

    it("writes data-duration as a static literal in seconds", () => {
      // Read at compile time — a script assignment would be ignored.
      const comp = arabicLaunchTemplate({ aspect: "portrait" });
      const expected = (compositionDuration(comp) / 1000).toFixed(4);
      assert.match(html, new RegExp(`data-duration="${expected}"`));
      assert.ok(!/setAttribute\(\s*["']data-duration/.test(html));
    });

    it("writes clip timing in seconds, not milliseconds", () => {
      // The first clip legitimately starts at 0; check the ones that follow.
      const values = [...html.matchAll(/data-start="([\d.]+)"/g)].map((m) =>
        Number(m[1]),
      );
      assert.ok(values.length > 1);
      // The second scene starts at 2800ms = 2.8s. In milliseconds it would
      // read 2800, which would be a 46-minute composition.
      assert.ok(Math.abs(values[1] - 2.8) < 1e-6, `expected 2.8s, got ${values[1]}`);
      assert.ok(values.every((v) => v < 120), "a clip start exceeds 120s");
    });

    it("keeps the standalone root out of a template", () => {
      // Comments legitimately mention <template>; only a real element counts.
      const markup = html.replace(/<!--[\s\S]*?-->/g, "");
      const rootIndex = markup.indexOf('id="root"');
      const templateIndex = markup.indexOf("<template");
      assert.ok(rootIndex > -1, "composition root is missing");
      assert.equal(
        templateIndex,
        -1,
        "the standalone root must not sit inside a <template>",
      );
    });

    it("gives every clip a unique id", () => {
      const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
      assert.equal(new Set(ids).size, ids.length, "duplicate ids in the document");
    });

    it("marks clips with class=clip", () => {
      const clipCount = (html.match(/class="clip/g) ?? []).length;
      assert.ok(clipCount > 0);
      assert.equal(clipCount, arabicLaunchTemplate().scenes.length);
    });

    it("inlines fonts rather than referencing them over the network", () => {
      assert.match(html, /@font-face\{font-family:"Alexandria"/);
      assert.match(html, /src:url\(data:font\/woff2/);
      // No stylesheet or script may point off-box.
      assert.ok(!/<link[^>]+href=/.test(html), "no external stylesheet allowed");
      assert.ok(!/<script[^>]+src=/.test(html), "no external script allowed");
    });

    it("is RTL Arabic and declares the frame background", () => {
      assert.match(html, /<html lang="ar" dir="rtl">/);
      assert.match(html, /#root \{[\s\S]*?position: relative;/);
    });

    it("contains no render-time clocks or randomness", () => {
      assert.ok(!/Date\.now|performance\.now/.test(html));
      assert.ok(!/Math\.random/.test(html));
    });

    it("embeds the runtime and registers the timeline after fonts are ready", () => {
      assert.match(html, /NasaqMotion/);
      assert.match(html, /__timelines\[composition\.id\]/);
      assert.match(html, /document\.fonts\.ready\.then\(boot\)/);
    });

    it("escapes authored text so a caption cannot break out of the script", () => {
      // `JSON.stringify` leaves `</script>` intact, so an author-supplied scene
      // name could otherwise terminate the element and inject markup into a
      // file that is written to disk and opened locally.
      const evil = emitCompositionHtml({
        ...arabicLaunchTemplate(),
        scenes: [
          {
            ...arabicLaunchTemplate().scenes[0],
            name: '</script><img src=x onerror=alert(1)>',
          },
        ],
      });
      const inline = evil.slice(evil.indexOf("var composition = "));
      assert.ok(
        !inline.includes("</script><img"),
        "raw tag terminator leaked into the embedded JSON",
      );
      assert.ok(inline.includes("\\u003C"), "angle brackets must be unicode-escaped");
    });

    it("escapes authored text in markup attributes too", () => {
      const evil = emitCompositionHtml({
        ...arabicLaunchTemplate(),
        name: '"><script>alert(1)</script>',
      });
      assert.ok(!evil.includes('"><script>'), "raw quote broke out of an attribute");
    });
  });

  describe("stageScaleScript", () => {
    it("scales with a transform rather than resizing the frame", () => {
      const script = stageScaleScript();
      assert.match(script, /transform = "scale/);
      assert.ok(!/root\.style\.width/.test(script), "must never resize the frame");
    });
  });

  describe("render plan", () => {
    it("computes a sane frame count for the built-in templates", () => {
      const comp = arabicLaunchTemplate();
      const frames = compositionFrameCount(comp);
      assert.ok(frames > 100, `expected a real animation, got ${frames} frames`);
      assert.equal(frames, Math.round((compositionDuration(comp) / 1000) * comp.fps));
    });
  });
});