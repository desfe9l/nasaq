/**
 * Font portability for `.nsq` files (browser-only).
 *
 * Uploaded fonts live only in `document.fonts` for the session, so the upload
 * path records each file's data URL here; saving a project embeds the ones it
 * uses. Opening a file registers its embedded faces and reports any family
 * that is neither bundled, embedded nor installed — the element keeps its
 * font name (layout data intact) and renders with the editor's fallback stack
 * until the font is available.
 */

import { BUNDLED_FONTS, type NsqFontEntry } from "./format";

const uploaded = new Map<string, string>();

/** Remember an uploaded font's source so `.nsq` saves can embed it. */
export function rememberUploadedFont(family: string, dataUrl: string): void {
  const name = String(family || "").trim();
  if (name && /^data:/i.test(dataUrl)) uploaded.set(name, dataUrl);
}

export function uploadedFontSources(): { family: string; dataUrl: string }[] {
  return [...uploaded].map(([family, dataUrl]) => ({ family, dataUrl }));
}

/** Register embedded faces; returns the families that loaded. */
export async function loadEmbeddedFonts(
  fonts: { family: string; dataUrl: string }[],
  register: (family: string) => void,
): Promise<Set<string>> {
  const loaded = new Set<string>();
  if (typeof FontFace === "undefined" || !document.fonts) return loaded;
  for (const font of fonts) {
    try {
      const face = new FontFace(font.family, `url(${font.dataUrl})`);
      document.fonts.add(await face.load());
      rememberUploadedFont(font.family, font.dataUrl);
      register(font.family);
      loaded.add(font.family);
    } catch {
      /* an unreadable font falls back like any missing one */
    }
  }
  return loaded;
}

/**
 * True when the browser can render `family` (installed, bundled or loaded).
 * Width comparison against generic fallbacks is the one check that works for
 * locally installed fonts too — `document.fonts.check` answers `true` for any
 * family it has no face for.
 */
export function isFontAvailable(family: string): boolean {
  if (BUNDLED_FONTS.has(family)) return true;
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return true;
    const sample = "نَسَق للتصميم abcdefghijklmnop 0123456789";
    const quoted = `"${family.replace(/"/g, "")}"`;
    return ["monospace", "serif", "sans-serif"].some((generic) => {
      ctx.font = `32px ${generic}`;
      const base = ctx.measureText(sample).width;
      ctx.font = `32px ${quoted}, ${generic}`;
      return Math.abs(ctx.measureText(sample).width - base) > 0.5;
    });
  } catch {
    return true;
  }
}

export function missingFonts(
  entries: NsqFontEntry[],
  loaded: Set<string>,
): string[] {
  return entries
    .filter(
      (f) => !f.bundled && !loaded.has(f.family) && !isFontAvailable(f.family),
    )
    .map((f) => f.family);
}
