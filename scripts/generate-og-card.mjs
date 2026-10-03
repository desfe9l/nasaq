#!/usr/bin/env node
/**
 * Regenerate `public/og.jpg` — the card every link/social preview uses.
 *
 * WHY A SCRIPT AND NOT A COMMITTED FILE ALONE
 *
 * The card used to carry a stand-in glyph (a rounded rectangle with three
 * lines) drawn before the NASAQ mark existed. Everywhere the link preview
 * renders — WhatsApp, X, LinkedIn, Slack, iMessage — that OLD logo is what
 * people saw. This script re-renders the same institutional composition with
 * the CURRENT mark (`public/nasaq-mark.svg`) so the brand asset and the card
 * can never drift apart again.
 *
 * Rendering is code-draw + the Cairo webfont: no browser, no network at build
 * time, and the output is a real 1200 × 630 JPEG (the size every major crawler
 * expects — an SVG `og:image` is silently dropped by all of them).
 *
 * Run it when the mark or the palette changes:
 *
 *   npm i --no-save sharp @expo-google-fonts/cairo
 *   node scripts/generate-og-card.mjs
 *
 * `sharp` is intentionally NOT a dependency: this is a maintenance tool, and a
 * native module in `dependencies` would cost every install for an asset that
 * changes once a year. The script fails with instructions when it is missing.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error(
    "[og-card] sharp is not installed.\n" +
      "  npm i --no-save sharp @expo-google-fonts/cairo\n" +
      "  node scripts/generate-og-card.mjs",
  );
  process.exit(1);
}

const fontFile = join(
  root,
  "node_modules/@expo-google-fonts/cairo/900Black/Cairo_900Black.ttf",
);
const fontBold = join(
  root,
  "node_modules/@expo-google-fonts/cairo/700Bold/Cairo_700Bold.ttf",
);
const fonts = [];
for (const [file, weight] of [
  [fontFile, 900],
  [fontBold, 700],
]) {
  try {
    fonts.push({ file, weight, css: `@font-face{font-family:'Cairo';font-weight:${weight};src:url('file://${file}');}` });
  } catch {
    /* missing font: the SVG falls back to a generic family */
  }
}
if (!fonts.length) {
  console.error(
    "[og-card] Cairo is not installed:\n  npm i --no-save @expo-google-fonts/cairo",
  );
  process.exit(1);
}

/* ── The current NASAQ mark, inlined so the card can never lag the asset ──── */
const markSvg = readFileSync(join(root, "public/nasaq-mark.svg"), "utf8");
const markPaths = [...markSvg.matchAll(/<path class="cls-(\d)" d="([^"]+)"/g)].map(
  ([, cls, d]) => ({ cls, d }),
);
if (!markPaths.length) {
  console.error("[og-card] could not read the mark paths from public/nasaq-mark.svg");
  process.exit(1);
}
/** The mark's own palette (emerald body, gold accents, ink counter). */
const MARK_COLOR = { 1: "#c9a86a", 2: "#f5f1e6", 3: "#f5f1e6" };
const MARK_VIEW = { w: 141.11, h: 210.14 };
const MARK_H = 300;
const MARK_W = (MARK_VIEW.w / MARK_VIEW.h) * MARK_H;

const W = 1200;
const H = 630;
const EMERALD = "#006c35";
const DEEP = "#00552a";
const GOLD = "#c9a86a";
const CREAM = "#e0c894";

const BRAND_TAGLINE = "منصة التصميم والتحرير المؤسسي — من تطوير فريق نَسَق";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const card = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
${fonts.map((f) => f.css).join("\n")}
text{font-family:'Cairo',sans-serif}
</style>
<defs>
  <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
    <path d="M60 0H0V60" fill="none" stroke="#ffffff" stroke-opacity="0.05" stroke-width="1"/>
  </pattern>
  <clipPath id="sheet"><rect x="0" y="0" width="392" height="502" rx="6"/></clipPath>
</defs>
<rect width="${W}" height="${H}" fill="${EMERALD}"/>
<rect width="${W}" height="${H}" fill="url(#grid)"/>

<!-- ── Left column: the word ─────────────────────────────────────────────── -->
<g transform="translate(72,64)">
  <g>
    <rect x="0" y="9" width="44" height="3" rx="1.5" fill="${CREAM}"/>
    <text x="60" y="16" font-size="19" font-weight="700" fill="${CREAM}">${esc("NASAQ | نَسَق")}</text>
  </g>
  <text x="0" y="96" font-size="58" font-weight="900" fill="#ffffff">${esc("صمّم تقاريرك")}</text>
  <text x="0" y="164" font-size="58" font-weight="900" fill="#ffffff">${esc("باحتراف مؤسسي")}</text>
  <text x="0" y="228" font-size="23" font-weight="700" fill="#b9c4d6">${esc("منصة التصميم والتحرير المؤسسي — محرر عربي بمقاسات A4 وA3")}</text>
  <text x="0" y="264" font-size="23" font-weight="700" fill="#b9c4d6">${esc("وشرائح 16:9، مع تصدير PDF وWord وPowerPoint.")}</text>

  <g transform="translate(0,318)">
    <g fill="none" stroke="#ffffff" stroke-opacity="0.17">
      <rect x="0.5" y="0.5" width="128" height="38" rx="19"/>
      <rect x="140.5" y="0.5" width="118" height="38" rx="19"/>
      <rect x="270.5" y="0.5" width="150" height="38" rx="19"/>
    </g>
    <text x="64" y="25" font-size="16" font-weight="700" fill="#dfe6f0" text-anchor="middle">${esc("A4 رأسي وأفقي")}</text>
    <text x="199" y="25" font-size="16" font-weight="700" fill="#dfe6f0" text-anchor="middle">${esc("جداول ومؤشرات")}</text>
    <text x="345" y="25" font-size="16" font-weight="700" fill="#dfe6f0" text-anchor="middle">${esc("PDF · PNG · Word")}</text>
  </g>
</g>

<!-- ── Right column: a real report cover, with the current mark on it ─────── -->
<g transform="translate(736,64) rotate(-1.4 196 251)">
  <rect width="392" height="502" rx="6" fill="#ffffff"/>
  <g clip-path="url(#sheet)">
    <rect width="392" height="74" fill="${DEEP}"/>
    <rect y="74" width="392" height="5" fill="${GOLD}"/>
    <g transform="translate(28,110)">
      <text x="336" y="26" font-size="26" font-weight="900" fill="#00552a" text-anchor="end">${esc("تقرير أداء")}</text>
      <text x="336" y="58" font-size="17" font-weight="700" fill="#5d6b80" text-anchor="end">${esc("الربع الثالث — 2025")}</text>
      <rect x="0" y="86" width="336" height="12" rx="3" fill="#00552a" fill-opacity="0.12"/>
      <rect x="0" y="110" width="180" height="12" rx="3" fill="#00552a" fill-opacity="0.12"/>
      <g transform="translate(0,146)">
        <g>
          <rect width="104" height="70" rx="5" fill="#ffffff" stroke="#00552a" stroke-opacity="0.13"/>
          <text x="52" y="34" font-size="26" font-weight="900" fill="#00552a" text-anchor="middle">904</text>
          <text x="52" y="54" font-size="11" font-weight="700" fill="#5d6b80" text-anchor="middle">${esc("إجمالي الحالات")}</text>
        </g>
        <g transform="translate(116,0)">
          <rect width="104" height="70" rx="5" fill="#ffffff" stroke="#00552a" stroke-opacity="0.13"/>
          <text x="52" y="34" font-size="26" font-weight="900" fill="#00552a" text-anchor="middle">27</text>
          <text x="52" y="54" font-size="11" font-weight="700" fill="#5d6b80" text-anchor="middle">${esc("إصابة")}</text>
        </g>
        <g transform="translate(232,0)">
          <rect width="104" height="70" rx="5" fill="#ffffff" stroke="#00552a" stroke-opacity="0.13"/>
          <text x="52" y="34" font-size="26" font-weight="900" fill="#00552a" text-anchor="middle">%68</text>
          <text x="52" y="54" font-size="11" font-weight="700" fill="#5d6b80" text-anchor="middle">${esc("نسبة الإنجاز")}</text>
        </g>
      </g>
      <g transform="translate(0,244)">
        <rect width="336" height="11" rx="4" fill="#00552a" fill-opacity="0.08"/>
        <rect width="262" height="11" rx="4" fill="${GOLD}"/>
        <rect y="26" width="336" height="11" rx="4" fill="#00552a" fill-opacity="0.08"/>
        <rect y="26" width="181" height="11" rx="4" fill="${GOLD}"/>
        <rect y="52" width="336" height="11" rx="4" fill="#00552a" fill-opacity="0.08"/>
        <rect y="52" width="121" height="11" rx="4" fill="${GOLD}"/>
      </g>
    </g>
    <!-- The CURRENT NASAQ mark, watermarked on the cover. -->
    <g transform="translate(${392 - MARK_W * 0.62},${502 - MARK_H * 0.62}) scale(0.62)" opacity="0.16">
      ${markPaths
        .map((p) => `<path d="${p.d}" fill="${MARK_COLOR[p.cls] ?? "#00552a"}"/>`)
        .join("")}
    </g>
  </g>
</g>

<!-- ── Attribution, with the mark at its true aspect ratio ───────────────── -->
<g transform="translate(72,${H - 96})">
  <g transform="translate(0,0) scale(${46 / MARK_W})">
    ${markPaths
      .map((p) => `<path d="${p.d}" fill="${MARK_COLOR[p.cls] ?? CREAM}"/>`)
      .join("")}
  </g>
  <text x="64" y="24" font-size="21" font-weight="900" fill="#ffffff">${esc("NASAQ | نَسَق")}</text>
  <text x="64" y="50" font-size="15" font-weight="700" fill="#93a3bb">${esc(BRAND_TAGLINE)}</text>
</g>
</svg>`;

const out = join(root, "public/og.jpg");
mkdirSync(dirname(out), { recursive: true });
// Render at 2× and downsample to the 1200 × 630 every crawler expects: the
// supersample is what keeps the Arabic outlines and the mark's hairlines crisp
// instead of stair-stepped.
const buf = await sharp(Buffer.from(card), { density: 192 })
  .resize(W, H, { kernel: "lanczos3" })
  .flatten({ background: EMERALD })
  .jpeg({ quality: 88, chromaSubsampling: "4:4:4", mozjpeg: false })
  .toBuffer();
writeFileSync(out, buf);
const meta = await sharp(buf).metadata();
console.log(
  `[og-card] wrote public/og.jpg — ${meta.width}×${meta.height}, ${(buf.length / 1024).toFixed(1)} KB`,
);
