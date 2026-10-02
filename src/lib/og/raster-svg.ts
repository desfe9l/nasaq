/**
 * Rasterise a template SVG into a PNG crawlers will actually fetch.
 *
 * WhatsApp, X and Telegram do not render `image/svg+xml` as `og:image`.
 * The thumbnail endpoint calls this for stored SVG previews and returns PNG.
 *
 * The wasm binary and the Arabic faces are inlined (see
 * `share-raster-assets.generated.ts`). Opening them with `import.meta.url`
 * resolves to `/var/task/_ssr/…` on Vercel, where Nitro does not emit the
 * files, and the share image 500s.
 */

import { initWasm, Resvg } from "@resvg/resvg-wasm";

import { SHARE_RASTER_WIDTH } from "@/lib/templates/share-image";
import { fonts, wasm } from "./share-raster-assets.generated";

let ready: Promise<void> | null = null;

async function ensureWasm(): Promise<void> {
  if (!ready) {
    ready = initWasm(wasm).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      // Dev reloads re-evaluate this module after the isolate already started.
      if (message.includes("Already initialized")) return;
      ready = null;
      throw error;
    });
  }
  await ready;
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
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: Math.max(1, Math.round(width)) },
    font: {
      fontBuffers: fonts,
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
