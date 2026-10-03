import type {
  DesignAnalysis,
  DesignFormat,
  PaletteRoles,
  ReferenceFact,
} from "./schema";
import { INTELLIGENCE_SCHEMA_VERSION } from "./schema";

const ARABIC = /[\u0600-\u06FF]/;

export function classifyFormat(w: number, h: number): DesignFormat {
  if (h > w * 2.2) return "tall-story";
  if (w > h * 1.15) return "wide-slide";
  if (Math.abs(w - 210) < 8 && Math.abs(h - 297) < 15) return "a4-book";
  return "custom-brochure";
}

function luminance(hex: string): number {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return 1;
  const channels = [0, 2, 4].map((index) => {
    const value = Number.parseInt(raw.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function relLuma(hex: string): number {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return 1;
  const [r, g, b] = [0, 2, 4].map((index) => Number.parseInt(raw.slice(index, index + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Roles from counted edge pixels. Accent falls back to gold only when no second hue exists. */
export function paletteFromEdges(edge: Array<{ hex: string; count: number }>): PaletteRoles {
  const ranked = edge.filter((item) => /^#[0-9a-fA-F]{6}$/.test(item.hex));
  const paper =
    [...ranked].sort((a, b) => relLuma(b.hex) - relLuma(a.hex))[0]?.hex ?? "#f7f6f3";
  const dark = [...ranked].sort((a, b) => relLuma(a.hex) - relLuma(b.hex));
  const field = dark.find((item) => relLuma(item.hex) < 0.45)?.hex ?? dark[0]?.hex ?? "#0c3d2c";
  const accent =
    ranked.find((item) => {
      const luma = relLuma(item.hex);
      return item.hex !== field && item.hex !== paper && luma > 0.25 && luma < 0.82;
    })?.hex ?? "#c6a05a";
  const fieldLuma = relLuma(field);
  return {
    field,
    paper: relLuma(paper) > 0.75 ? paper : "#f7f6f3",
    ink: "#172033",
    accent,
    muted: "#5c6570",
    onField: fieldLuma < 0.45 ? "#f7f6f3" : "#172033",
  };
}

function cleanLine(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function extractLines(fact: ReferenceFact, limit = 12): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const sample of fact.textSamples) {
    for (const raw of sample.text.split(/\n+/)) {
      const line = cleanLine(raw);
      if (line.length < 2 || line.length > 140) continue;
      if ((line.match(/[^\u0600-\u06FF\u0020-\u007E]/g) || []).length > line.length * 0.4) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
      if (lines.length >= limit) return lines;
    }
  }
  return lines;
}

function displayTitle(file: string, lines: string[]): string {
  const arabic = lines.find((line) => ARABIC.test(line) && line.length >= 4 && line.length <= 72);
  if (arabic) return arabic;
  const stem = file.normalize("NFKC").replace(/\.pdf$/i, "").replace(/\uFFFD/g, "").replace(/\s+/g, " ").trim();
  return stem || "مرجع بدون عنوان مستخرج";
}

function languageOf(lines: string[]): "ar" | "mixed" | "unknown" {
  if (!lines.length) return "unknown";
  const arabic = lines.some((line) => ARABIC.test(line));
  const latin = lines.some((line) => /[A-Za-z]/.test(line));
  if (arabic && latin) return "mixed";
  if (arabic) return "ar";
  return "unknown";
}

function componentsFor(fact: ReferenceFact, lines: string[]): string[] {
  const blob = lines.join(" ");
  const found = ["cover", "title-block"];
  if (/إنفاذ|انفاذ|اإلسناد|الإسناد/.test(blob)) found.push("supervision");
  if (/\d{4}/.test(blob) || /محرم|صفر|أغسطس|يوليو/.test(blob)) found.push("date-block");
  if (/05\d{8}|9200/.test(blob)) found.push("contact");
  if (fact.pages > 1) found.push("running-head", "folio");
  if (fact.primarySize.h > fact.primarySize.w * 2.2) found.push("stacked-story");
  if (fact.primarySize.w > fact.primarySize.h) found.push("wide-stage");
  found.push("photo-slot", "footer");
  return found;
}

export function analyzeFact(fact: ReferenceFact, index: number): DesignAnalysis {
  const lines = extractLines(fact);
  const sizes = [...new Set(fact.spans.map((span) => span.size).filter((size) => size > 0))].sort(
    (a, b) => b - a,
  );
  const limitations: string[] = [
    "PDF pages were measured (count, size, edge colors, embedded font names, text). Layer geometry is not in the file.",
  ];
  if (!lines.length) {
    limitations.push("No extractable text. Type was outlined or painted into the artwork.");
  } else if (fact.textSamples.some((sample) => sample.text.normalize("NFKC") !== sample.text)) {
    limitations.push(
      "Arabic presentation forms were converted with NFKC into logical characters. Glyph positions were not in the PDF.",
    );
  }
  if (!fact.fonts.length) {
    limitations.push("No embedded font names were available.");
  }
  if (fact.sizes.length > 1) {
    limitations.push("Pages use more than one size. The improved document uses the dominant size.");
  }
  const primary = fact.primarySize;
  return {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    id: `ref-${String(index + 1).padStart(2, "0")}`,
    source: { file: fact.file, bytes: fact.bytes, kind: "pdf" },
    fidelity: "measured-pdf",
    limitations,
    document: {
      pages: fact.pages,
      primary: {
        w: primary.w,
        h: primary.h,
        orientation: primary.orientation,
      },
      variants: fact.sizes,
      format: classifyFormat(primary.w, primary.h),
      language: languageOf(lines),
      direction: "rtl",
    },
    title: displayTitle(fact.file, lines),
    typography: {
      families: fact.fonts.map((font) => font.name),
      sizes: sizes.slice(0, 8),
    },
    palette: paletteFromEdges(fact.colors.edge),
    colorSamples: fact.colors.edge.slice(0, 5).map((item) => item.hex),
    extractedLines: lines,
    components: componentsFor(fact, lines),
  };
}

export function analyzeFacts(facts: ReferenceFact[]): DesignAnalysis[] {
  return facts.map(analyzeFact);
}

/** Exposed for tests that check the contrast helper stays deterministic. */
export function contrastRatio(a: string, b: string): number {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}
