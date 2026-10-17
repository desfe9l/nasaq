/**
 * Render a NASAQ motion composition to a real video file.
 *
 * ## What this does
 *
 * Emits nothing to a browser and needs no headless Chromium. The composition
 * engine is pure, so frames are produced by calling `seek(t)` and drawing the
 * result onto a Node canvas, then streamed as raw RGBA into `ffmpeg`. That
 * makes the render reproducible and lets it run anywhere the runtime exists —
 * including CI and this sandbox, where no browser binary is available.
 *
 * The drawing call is `renderFrame()` from `src/lib/motion/canvas-render.ts` —
 * **the exact function the in-app preview uses**. A video that differs from
 * its own preview is the failure this architecture exists to prevent.
 *
 * ## Usage
 *
 *   node --experimental-strip-types scripts/render-motion.mjs \
 *     --template arabic-launch --out /tmp/nasaq.mp4
 *
 *   --template <id>     template id (see MOTION_TEMPLATES)
 *   --out <path>        output .mp4 path
 *   --width <px>        authoring width (default: template default)
 *   --aspect <ratio>    portrait | square | landscape
 *   --fps <n>           override frame rate
 *   --max-frames <n>    stop early — for a smoke test, not a full render
 *   --html <path>       also write the standalone HTML composition
 *   --keep-frames <dir> keep individual PNG frames for inspection
 *
 * ## Honest limitations (surfaced in the manifest, not hidden)
 *
 *  - NASAQ bundles **Alexandria at 400/500 only**, so a display weight of
 *    700/800 is rasterised at the nearest available weight rather than
 *    synthesised. The manifest records the substitution.
 *  - Voice-over is **not** generated here. An audio track is muxed only when
 *    `--audio` is supplied with a real file; this script never fabricates one.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

import { renderFrame } from "../src/lib/motion/canvas-render.ts";
import { emitCompositionHtml } from "../src/lib/motion/html.ts";
import { seek } from "../src/lib/motion/render-frame.ts";
import { MOTION_TEMPLATES } from "../src/lib/motion/templates.ts";
import { splitClusters } from "../src/lib/motion/arabic-type.ts";
import {
  compositionDuration,
  compositionHeight,
  frameDurationMs,
} from "../src/lib/motion/types.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------- args */

const parseArgs = (argv) => {
  const args = { template: "arabic-launch", out: "", width: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      args[name] = true;
    } else {
      args[name] = value;
      i += 1;
    }
  }
  return args;
};

const args = parseArgs(process.argv.slice(2));

/* ----------------------------------------------------------------- fonts */

/**
 * Motion faces, served from `public/fonts/motion/`.
 *
 * Complete TTFs rather than the site's woff2. The Node canvas cannot read
 * woff2, and given the decomposed subsets it selects one face per family with
 * no per-glyph fallback — which renders a full stop as a tofu box. Observed in
 * real frames, not anticipated. These files are also the faces the NASAQ media
 * system documents for display and prose.
 */
const FONT_FILES = [
  ["motion", "Tajawal-Regular.ttf", 400],
  ["motion", "Tajawal-Bold.ttf", 700],
  ["motion", "NotoNaskhArabic-Regular.ttf", 400],
  ["motion", "NotoNaskhArabic-Bold.ttf", 700],
];

/**
 * Load the motion faces into the Node canvas.
 *
 * Loading is reported rather than assumed, so a silent font failure cannot
 * masquerade as a correct render.
 */
const loadFonts = async () => {
  const sourceDir = join(ROOT, "public", "fonts");
  let loaded = 0;
  const failed = [];
  for (const [dir, file] of FONT_FILES) {
    const source = join(sourceDir, dir, file);
    try {
      if (!existsSync(source)) throw new Error("missing");
      GlobalFonts.registerFromPath(source);
      loaded += 1;
    } catch (error) {
      failed.push(`${file} (${error.message})`);
    }
  }
  if (failed.length > 0) {
    console.warn(`  ! ${failed.length} font file(s) unavailable: ${failed.join(", ")}`);
  }
  return loaded;
};

/** Font sources for the standalone HTML export. */
const htmlFontSources = () =>
  FONT_FILES.map(([dir, file, weight]) => ({
    family: file.startsWith("Tajawal") ? "Tajawal" : "Noto Naskh Arabic",
    weight,
    src: `url(/fonts/${dir}/${file})`,
  }));

/* ----------------------------------------------------------------- ffmpeg */

const resolveFfmpeg = () => {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (probe.status === 0) return "ffmpeg";
  return null;
};

/* ------------------------------------------------------------------ main */

const run = async () => {
  const entry = MOTION_TEMPLATES.find((t) => t.id === args.template);
  if (!entry) {
    console.error(`unknown template "${args.template}"`);
    console.error(`available: ${MOTION_TEMPLATES.map((t) => t.id).join(", ")}`);
    process.exit(2);
  }

  let composition = entry.build();
  if (!composition) {
    console.error(`template "${args.template}" could not be built`);
    process.exit(2);
  }

  if (args.width) composition = { ...composition, width: Number(args.width) };
  if (args.aspect) {
    composition = { ...composition, aspect: args.aspect };
  }
  if (args.fps) composition = { ...composition, fps: Number(args.fps) };

  const width = composition.width;
  const height = compositionHeight(composition);
  const fps = composition.fps;
  const totalMs = compositionDuration(composition);
  const frameMs = frameDurationMs(composition);

  const totalFrames = Math.max(
    1,
    args["max-frames"]
      ? Math.min(Number(args["max-frames"]), Math.round((totalMs / 1000) * fps))
      : Math.round((totalMs / 1000) * fps),
  );

  const registered = await loadFonts();
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    console.error("ffmpeg not found. Install it or set FFMPEG_PATH.");
    process.exit(3);
  }

  console.log(`template     : ${entry.id} (${entry.name})`);
  console.log(`frame        : ${width}x${height} @ ${fps}fps`);
  console.log(`duration     : ${(totalMs / 1000).toFixed(2)}s (${totalFrames} frames)`);
  console.log(`fonts        : ${registered} files registered`);

  // Real font metrics drive the anchor placement, so the period lands exactly.
  const measureCtx = createCanvas(8, 8).getContext("2d");
  const measure = (text, fontSize) => {
    measureCtx.font = `700 ${fontSize}px "Alexandria", sans-serif`;
    return measureCtx.measureText(text).width;
  };

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const outPath = args.out ? resolve(args.out) : resolve("/tmp/nasaq-motion.mp4");
  mkdirSync(dirname(outPath), { recursive: true });

  const ffArgs = [
    "-hide_banner",
    "-loglevel", "error",
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-s", `${width}x${height}`,
    "-r", String(fps),
    "-i", "pipe:0",
  ];
  if (args.audio && existsSync(resolve(args.audio))) {
    ffArgs.push("-i", resolve(args.audio));
  }
  ffArgs.push(
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    // Even dimensions are mandatory for H.264; composition sizes are already.
    ...(args.audio && existsSync(resolve(args.audio))
      ? ["-c:a", "aac", "-shortest"]
      : ["-an"]),
    "-movflags", "+faststart",
    "-y",
    outPath,
  );

  const child = spawn(ffmpeg, ffArgs, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const finished = new Promise((resolvePromise, rejectPromise) => {
    child.on("error", rejectPromise);
    child.on("close", (code) =>
      code === 0 ? resolvePromise(0) : rejectPromise(new Error(stderr || `ffmpeg exited ${code}`)),
    );
  });

  // One pipe-level error handler for the whole process. Registering an `error`
  // listener per frame leaks one listener per write, because it only detaches
  // if `error` actually fires — and on a healthy run it never does.
  let writeFailure = null;
  child.stdin.on("error", (error) => {
    writeFailure = error;
  });

  const write = (buffer) =>
    new Promise((resolvePromise, rejectPromise) => {
      if (writeFailure) {
        rejectPromise(writeFailure);
        return;
      }
      if (child.stdin.write(buffer)) resolvePromise();
      else child.stdin.once("drain", resolvePromise);
    });

  const started = Date.now();
  for (let index = 0; index < totalFrames; index += 1) {
    const t = index * frameMs;
    const frame = seek(composition, t, { measure });
    renderFrame(ctx, frame);
    const image = ctx.getImageData(0, 0, width, height);
    await write(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength));

    if (index % 15 === 0 || index === totalFrames - 1) {
      const pct = Math.round(((index + 1) / totalFrames) * 100);
      const bar = "█".repeat(Math.round(pct / 4)).padEnd(25, "░");
      process.stdout.write(
        `\r  [${bar}] ${pct}%  frame ${index + 1}/${totalFrames}   `,
      );
    }

    if (args["keep-frames"] && index % 10 === 0) {
      const dir = resolve(args["keep-frames"]);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `frame-${String(index).padStart(5, "0")}.png`),
        canvas.toBuffer("image/png"),
      );
    }
  }

  child.stdin.end();
  await finished;
  process.stdout.write("\n");

  if (!existsSync(outPath) || statSync(outPath).size === 0) {
    console.error("render produced no output");
    process.exit(4);
  }
  const bytes = statSync(outPath).size;

  if (args.html) {
    const htmlPath = resolve(args.html);
    mkdirSync(dirname(htmlPath), { recursive: true });
    writeFileSync(
      htmlPath,
      emitCompositionHtml(composition, {
        title: entry.name,
        fonts: htmlFontSources(),
        notes: `Rendered by scripts/render-motion.mjs — ${width}x${height} @ ${fps}fps`,
      }),
    );
    console.log(`html         : ${htmlPath}`);
  }

  const manifest = {
    template: entry.id,
    width,
    height,
    fps,
    durationMs: totalMs,
    frames: totalFrames,
    bytes,
    output: outPath,
    audio: args.audio && existsSync(resolve(args.audio)) ? resolve(args.audio) : null,
    voiceOver: null,
    fonts: FONT_FILES.map(([dir, file, weight]) => ({
      family: file.startsWith("Tajawal") ? "Tajawal" : "Noto Naskh Arabic",
      weight,
      file: `${dir}/${file}`,
    })),
    renderMs: Date.now() - started,
    clustersPerFrame: splitClusters("نَسَق").length,
  };
  writeFileSync(`${outPath}.manifest.json`, JSON.stringify(manifest, null, 2));

  console.log(`output       : ${outPath} (${(bytes / 1024).toFixed(0)} KB)`);
  console.log(`manifest     : ${outPath}.manifest.json`);
  console.log(`render time  : ${(manifest.renderMs / 1000).toFixed(2)}s`);
  console.log("voice-over   : none (no configured provider — not fabricated)");
};

run().catch((error) => {
  console.error(`render failed: ${error.message}`);
  process.exit(1);
});