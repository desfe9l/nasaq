/**
 * Automatic device font detection.
 *
 * Browsers deliberately hide the installed-font list, so "what fonts does this
 * machine have?" cannot be answered directly. The workable signal is width
 * comparison: render a probe string in a generic fallback and again with the
 * candidate family appended, then measure. A different measurement means the
 * candidate exists — the browser only picks a different face when it has one.
 *
 * Measurement uses a 2D canvas rather than DOM nodes: no layout, no reflow, no
 * nodes to clean up, and it can run inside one animation frame for hundreds of
 * candidates.
 */

/** Curated Arabic-capable families by platform. Order is the display order. */
const ARABIC_CANDIDATES: { family: string; note: string }[] = [
  // macOS / iOS
  { family: "Geeza Pro", note: "ماك — عربي نظامي" },
  { family: "Al Nile", note: "ماك — عربي حديث" },
  { family: "Baghdad", note: "ماك — عربي كلاسيكي" },
  { family: "Damascus", note: "ماك — عربي بصري" },
  { family: "Diwan Kufi", note: "ماك — كوفي" },
  { family: "Diwan Thuluth", note: "ماك — ثلث" },
  { family: "Farah", note: "ماك — عربي حر" },
  { family: "KufiStandardGK", note: "ماك — كوفي" },
  { family: "Nadeem", note: "ماك — نعيم" },
  { family: "Noto Naskh Arabic UI", note: "ماك — نسخ" },
  { family: "Sana", note: "ماك — صنعاء" },
  { family: "Times New Roman", note: "ماك — نسخ كلاسيكي" },
  // Windows
  { family: "Segoe UI", note: "ويندوز — الواجهة" },
  { family: "Traditional Arabic", note: "ويندوز — عربي تقليدي" },
  { family: "Simplified Arabic", note: "ويندوز — عربي مبسّط" },
  { family: "Sakkal Majalla", note: "ويندوز — مجلة" },
  { family: "Arabic Typesetting", note: "ويندوز — تنضيد" },
  { family: "Urdu Typesetting", note: "ويندوز — أردو" },
  { family: "Arial", note: "ويندوز/ماك" },
  { family: "Tahoma", note: "ويندوز — شاشة" },
  { family: "Verdana", note: "ويندوز — شاشة" },
  // Linux / ChromeOS
  { family: "DejaVu Sans", note: "لينكس" },
  { family: "Liberation Sans", note: "لينكس" },
  { family: "Noto Sans", note: "لينكس — شامل" },
  { family: "Noto Naskh Arabic", note: "شامل — نسخ" },
  { family: "Noto Kufi Arabic", note: "شامل — كوفي" },
  { family: "Scheherazade", note: "لينكس — شهرزاد" },
  { family: "Amiri", note: "حر — أميري" },
  { family: "Cairo", note: "حر — القاهرة" },
  { family: "Tajawal", note: "حر — تجوّل" },
];

const LATIN_CANDIDATES: { family: string; note: string }[] = [
  { family: "Helvetica Neue", note: "ماك" },
  { family: "Helvetica", note: "ماك" },
  { family: "Menlo", note: "ماك — أحادي" },
  { family: "Monaco", note: "ماك — أحادي" },
  { family: "Consolas", note: "ويندوز — أحادي" },
  { family: "Courier New", note: "ويندوز/ماك — أحادي" },
  { family: "Georgia", note: "ماك/ويندوز — مذيَّل" },
  { family: "Times New Roman", note: "ويندوز/ماك" },
  { family: "Trebuchet MS", note: "ويندوز/ماك" },
  { family: "Verdana", note: "ويندوز/ماك" },
  { family: "Segoe UI", note: "ويندوز" },
];

export interface DetectedFont {
  family: string;
  note: string;
  /** True when the family is one the app already ships through Google Fonts. */
  bundled: boolean;
  /** A plausible Arabic sample set in this family, for the picker preview. */
  script: "arabic" | "latin";
}

/**
 * Families the app loads itself. Kept in sync with `model.ts#FONTS`; duplicating
 * the small list here keeps this module free of imports (it also runs in a
 * plain browser context in tests).
 */
const BUNDLED = new Set([
  "Tajawal",
  "Cairo",
  "IBM Plex Sans Arabic",
  "Noto Sans Arabic",
  "Noto Naskh Arabic",
  "Noto Kufi Arabic",
  "Amiri",
  "Reem Kufi",
]);

/** A generic family must never be reported as "installed" — it always resolves. */
const GENERIC = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
]);

const ARABIC_PROBE = "أبجد هوز شمسية";
const LATIN_PROBE = "ABCDEFGHIJKLM";

function isAvailable(
  ctx: CanvasRenderingContext2D,
  family: string,
  probe: string,
): boolean {
  // Compare against two generic baselines: a family counts as present only when
  // it differs from BOTH, which rules out the cases where the default face
  // happens to coincide with one probe.
  const safe = family.replace(/"/g, "");
  for (const base of ["monospace", "serif"]) {
    ctx.font = `72px ${base}`;
    const baseWidth = ctx.measureText(probe).width;
    ctx.font = `72px "${safe}", ${base}`;
    const testWidth = ctx.measureText(probe).width;
    if (Math.abs(testWidth - baseWidth) > 0.5) return true;
  }
  return false;
}

let cache: DetectedFont[] | null = null;

/**
 * Detect fonts installed on this machine.
 *
 * Each candidate is probed with text of its own script: measuring Arabic with a
 * Latin-only face would fall back to the same system Arabic font in both the
 * probe and the baseline, making the widths equal and hiding a font that is
 * genuinely installed.
 *
 * Result is cached: probing touches the font cache, and the answer cannot change
 * without a page reload. Returns an empty list in environments without canvas
 * (SSR), so callers must treat "no fonts" as "unknown" rather than "none".
 */
export function detectDeviceFonts(): DetectedFont[] {
  if (cache) return cache;
  if (typeof document === "undefined") return [];

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const found: DetectedFont[] = [];
  const seen = new Set<string>();

  for (const { family, note } of ARABIC_CANDIDATES) {
    if (GENERIC.has(family.toLowerCase()) || seen.has(family)) continue;
    if (isAvailable(ctx, family, ARABIC_PROBE)) {
      seen.add(family);
      found.push({
        family,
        note,
        bundled: BUNDLED.has(family),
        script: "arabic",
      });
    }
  }
  for (const { family, note } of LATIN_CANDIDATES) {
    if (GENERIC.has(family.toLowerCase()) || seen.has(family)) continue;
    if (isAvailable(ctx, family, LATIN_PROBE)) {
      seen.add(family);
      found.push({
        family,
        note,
        bundled: BUNDLED.has(family),
        script: "latin",
      });
    }
  }

  // Bundled families stay selectable even on a machine where the webfont had not
  // finished loading when the probe ran.
  for (const family of BUNDLED) {
    if (!seen.has(family)) {
      seen.add(family);
      found.push({
        family,
        note: "مضمّن في المنصة",
        bundled: true,
        script: "arabic",
      });
    }
  }

  cache = found;
  return found;
}

/** Environment names for the "detected on" caption in the font panel. */
export function detectPlatform(): string {
  if (typeof navigator === "undefined") return "غير معروف";
  const ua = navigator.userAgent;
  // iPad reports as Macintosh, so check touch support before declaring macOS.
  const iPad =
    /Macintosh/.test(ua) &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1;
  if (/Windows/i.test(ua)) return "ويندوز";
  if (iPad) return "آيباد";
  if (/Mac OS X|Macintosh/i.test(ua)) return "ماك";
  if (/Android/i.test(ua)) return "أندرويد";
  if (/iPhone|iPad|iPod/i.test(ua)) return "آيفون/آيباد";
  if (/CrOS/i.test(ua)) return "كروم بوك";
  if (/Linux/i.test(ua)) return "لينكس";
  return "غير معروف";
}

/** Reset the memo — used by tests that swap the canvas implementation. */
export function clearDeviceFontCache() {
  cache = null;
}
