/**
 * Rasterise a template SVG into a PNG crawlers will actually fetch.
 *
 * WhatsApp, X and Telegram do not render `image/svg+xml` as `og:image`.
 * The thumbnail endpoint calls this for stored SVG previews and returns PNG.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { SHARE_RASTER_WIDTH } from "@/lib/templates/share-image";

const require = createRequire(import.meta.url);

let ready: Promise<void> | null = null;
let fonts: Uint8Array[] | null = null;

async function ensureWasm(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const { initWasm } = await import("@resvg/resvg-wasm");
      const wasmPath = require.resolve("@resvg/resvg-wasm/index_bg.wasm");
      await initWasm(await readFile(wasmPath));
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  await ready;
}

async function fontBuffers(): Promise<Uint8Array[]> {
  if (fonts) return fonts;
  const files = [
    new URL("./fonts/Tajawal-Regular.ttf", import.meta.url),
    new URL("./fonts/Tajawal-Bold.ttf", import.meta.url),
    new URL("./fonts/NotoNaskhArabic-Regular.ttf", import.meta.url),
    new URL("./fonts/NotoNaskhArabic-Bold.ttf", import.meta.url),
  ];
  const loaded: Uint8Array[] = [];
  for (const file of files) {
    try {
      loaded.push(await readFile(file));
    } catch {
      /* a missing face falls back to the default family */
    }
  }
  fonts = loaded;
  return loaded;
}

function decodeDataUrl(href: string): Uint8Array | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(href);
  if (!match) return null;
  try {
    return Buffer.from(match[2].replace(/\s/g, ""), "base64");
  } catch {
    return null;
  }
}

export async function rasterizeSvgToPng(svg: string, width = SHARE_RASTER_WIDTH): Promise<Uint8Array> {
  await ensureWasm();
  const { Resvg } = await import("@resvg/resvg-wasm");
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: Math.max(1, Math.round(width)) },
    font: {
      fontBuffers: await fontBuffers(),
      defaultFontFamily: "Tajawal",
      sansSerifFamily: "Tajawal",
      serifFamily: "Noto Naskh Arabic",
    },
    languages: ["ar", "en"],
    textRendering: 2,
    shapeRendering: 2,
  });
  const pending = resvg.imagesToResolve?.() ?? [];
  for (const item of pending) {
    const href = typeof item === "string" ? item : String(item?.url ?? item?.href ?? "");
    if (!href.startsWith("data:image/")) continue;
    const bytes = decodeDataUrl(href);
    if (bytes) resvg.resolveImage(href, bytes);
  }
  const rendered = resvg.render();
  try {
    return rendered.asPng();
  } finally {
    rendered.free();
    resvg.free();
  }
}
