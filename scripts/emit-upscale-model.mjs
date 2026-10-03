/**
 * Vendor the ESRGAN ×4 super-resolution weights into `public/models`.
 *
 * The upscaler loads the model same-origin at runtime (see
 * src/lib/editor/image-enhance/upscale.ts) — no CDN dependency. The weights
 * live in node_modules (@upscalerjs/esrgan-medium) and are copied here at
 * config-load time, mirroring emit-share-raster-assets.mjs, so dev server,
 * local builds and Vercel builds all resolve the identical bytes without
 * committing binaries to Git.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SOURCE_DIR = join(
  root,
  "node_modules/@upscalerjs/esrgan-medium/models/x4",
);
const TARGET_DIR = join(root, "public/models/esrgan-medium-x4");
const FILES = ["model.json", "group1-shard1of1.bin"];

export function emitUpscaleModel() {
  mkdirSync(TARGET_DIR, { recursive: true });
  for (const file of FILES) {
    const source = join(SOURCE_DIR, file);
    const target = join(TARGET_DIR, file);
    if (!existsSync(source)) {
      // Dependency missing (install not run yet): let the normal tooling
      // report it instead of failing config load with a cryptic error.
      continue;
    }
    if (existsSync(target) && statSync(target).size === statSync(source).size) {
      continue; // already vendored
    }
    copyFileSync(source, target);
  }
}
