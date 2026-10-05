#!/usr/bin/env node
/**
 * NASAQ Dedicated Application Icon Generator
 *
 * Generates the complete NASAQ app-icon suite for desktop, PWA, iOS/iPadOS,
 * and Android launchers, preserving the original NASAQ logo geometry and brand colors.
 *
 * Output assets:
 *  - public/icons/nasaq-app-icon.svg (Adaptive / responsive SVG icon with light/dark support)
 *  - public/icons/nasaq-app-icon-light.svg (Dedicated light mode SVG icon)
 *  - public/icons/nasaq-app-icon-dark.svg (Dedicated dark mode SVG icon)
 *  - public/icons/nasaq-16.png (16x16 raster)
 *  - public/icons/nasaq-32.png (32x32 raster)
 *  - public/icons/nasaq-48.png (48x48 raster)
 *  - public/icons/nasaq-96.png (96x96 raster)
 *  - public/icons/nasaq-128.png (128x128 raster)
 *  - public/icons/nasaq-180.png (180x180 iOS/iPadOS Apple Touch Icon)
 *  - public/icons/nasaq-192.png (192x192 PWA standard launcher icon)
 *  - public/icons/nasaq-384.png (384x384 PWA icon)
 *  - public/icons/nasaq-512.png (512x512 PWA desktop/mobile high-res icon)
 *  - public/icons/nasaq-maskable-512.png (512x512 maskable adaptive launcher icon)
 *  - public/icons/nasaq-light-192.png / nasaq-light-512.png (Light mode rasters)
 *  - public/icons/nasaq-dark-192.png / nasaq-dark-512.png (Dark mode rasters)
 *  - public/favicon.svg (Vector favicon with light/dark mode support)
 *  - public/__grok/icon-180.png (Platform 180px tile)
 */

import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ICONS = join(ROOT, "public/icons");
const OUT_PUBLIC = join(ROOT, "public");
const OUT_GROK = join(ROOT, "public/__grok");

mkdirSync(OUT_ICONS, { recursive: true });
mkdirSync(OUT_GROK, { recursive: true });

// Initialize Resvg WASM
const wasmBytes = readFileSync(join(ROOT, "src/lib/og/resvg.wasm"));
await initWasm(wasmBytes);

// Read the original NASAQ mark geometry from public/nasaq-mark.svg
const markSvg = readFileSync(join(ROOT, "public/nasaq-mark.svg"), "utf8");
const markPaths = [...markSvg.matchAll(/<path\s+class="(cls-\d)"\s+d="([^"]+)"/g)].map(
  ([, cls, d]) => ({ cls, d })
);

if (markPaths.length !== 4) {
  throw new Error(`Expected 4 paths in public/nasaq-mark.svg, found ${markPaths.length}`);
}

// Color palettes for variants
const PALETTES = {
  emerald: {
    // Standard Brand Emerald
    body: "#f5f1e6",
    accent: "#d9b45b",
    depth: "#e8e2d2",
    bgStart: "#007a3c",
    bgMid: "#006c35",
    bgEnd: "#004522",
    border: "rgba(255, 255, 255, 0.22)",
    shadowColor: "#000000",
    shadowOpacity: 0.36,
  },
  light: {
    // Light Institutional Mode
    body: "#063b35",
    accent: "#a48446",
    depth: "#1a1a1a",
    bgStart: "#ffffff",
    bgMid: "#faf7f0",
    bgEnd: "#eee7d8",
    border: "rgba(0, 108, 53, 0.18)",
    shadowColor: "#063b35",
    shadowOpacity: 0.16,
  },
  dark: {
    // Dark Obsidian Mode
    body: "#f5f1e6",
    accent: "#d9b45b",
    depth: "#e8e2d2",
    bgStart: "#0d221b",
    bgMid: "#071711",
    bgEnd: "#020906",
    border: "rgba(217, 180, 91, 0.3)",
    shadowColor: "#000000",
    shadowOpacity: 0.55,
  },
  maskable: {
    // Full-bleed Brand Emerald for Android Adaptive Icon
    body: "#f5f1e6",
    accent: "#d9b45b",
    depth: "#e8e2d2",
    bgStart: "#007a3c",
    bgMid: "#006c35",
    bgEnd: "#004d26",
    border: "none",
    shadowColor: "#000000",
    shadowOpacity: 0.3,
  },
};

/**
 * Generate SVG for a specific theme and style
 */
function buildAppIconSvg({
  theme = "emerald",
  rounded = true,
  rx = 112,
  size = 512,
  includeTopSheen = true,
} = {}) {
  const p = PALETTES[theme] || PALETTES.emerald;
  const isMaskable = theme === "maskable";
  
  // Mark geometry scaling (Original viewBox is 141.11 x 210.14)
  // Standard mark height: 330px on 512px canvas (64.5% height)
  // Maskable mark height: 282px on 512px canvas (fits strictly inside 80% safe zone = 409.6px circle)
  const markTargetHeight = isMaskable ? 282 : 330;
  const scale = (markTargetHeight / 210.14) * (size / 512);
  const markW = 141.11 * scale;
  const markH = 210.14 * scale;
  const tx = (size - markW) / 2;
  const ty = (size - markH) / 2;
  const actualRx = rounded ? (rx * size) / 512 : 0;

  const pathsSvg = markPaths
    .map((item) => {
      let fill = p.body;
      if (item.cls === "cls-1") fill = p.accent;
      else if (item.cls === "cls-3") fill = p.depth;
      return `<path fill="${fill}" d="${item.d}"/>`;
    })
    .join("\n      ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${p.bgStart}"/>
      <stop offset="48%" stop-color="${p.bgMid}"/>
      <stop offset="100%" stop-color="${p.bgEnd}"/>
    </linearGradient>
    ${
      includeTopSheen && theme === "emerald"
        ? `<radialGradient id="topSheen" cx="50%" cy="8%" r="70%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>`
        : ""
    }
    <filter id="markShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${(8 * size) / 512}" stdDeviation="${(12 * size) / 512}" flood-color="${p.shadowColor}" flood-opacity="${p.shadowOpacity}"/>
    </filter>
  </defs>
  
  <!-- App Container Background -->
  <rect width="${size}" height="${size}" rx="${actualRx}" fill="url(#bgGrad)"/>
  ${
    includeTopSheen && theme === "emerald"
      ? `<rect width="${size}" height="${size}" rx="${actualRx}" fill="url(#topSheen)"/>`
      : ""
  }
  ${
    p.border !== "none" && actualRx > 0
      ? `<rect x="${size >= 64 ? 1 : 0.5}" y="${size >= 64 ? 1 : 0.5}" width="${size - (size >= 64 ? 2 : 1)}" height="${size - (size >= 64 ? 2 : 1)}" rx="${Math.max(0, actualRx - 1)}" fill="none" stroke="${p.border}" stroke-width="${size >= 128 ? 2 : 1}"/>`
      : ""
  }
  
  <!-- NASAQ Brand Mark -->
  <g transform="translate(${tx.toFixed(2)}, ${ty.toFixed(2)}) scale(${scale.toFixed(5)})" filter="url(#markShadow)">
    ${pathsSvg}
  </g>
</svg>`;
}

/**
 * Generate Adaptive Responsive SVG App Icon with media query support
 */
function buildAdaptiveAppIconSvg() {
  const size = 512;
  const scale = (330 / 210.14) * (size / 512);
  const markW = 141.11 * scale;
  const markH = 210.14 * scale;
  const tx = (size - markW) / 2;
  const ty = (size - markH) / 2;
  const rx = 112;

  const path1_a = markPaths.find((p, i) => i === 1)?.d || "";
  const path1_b = markPaths.find((p, i) => i === 2)?.d || "";
  const path2 = markPaths.find((p, i) => i === 0)?.d || "";
  const path3 = markPaths.find((p, i) => i === 3)?.d || "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Brand Emerald Gradient (Default / Dark) -->
    <linearGradient id="bgEmerald" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#007a3c"/>
      <stop offset="48%" stop-color="#006c35"/>
      <stop offset="100%" stop-color="#004522"/>
    </linearGradient>
    <radialGradient id="topSheen" cx="50%" cy="8%" r="70%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    
    <!-- Light Mode Gradient -->
    <linearGradient id="bgLight" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="48%" stop-color="#faf7f0"/>
      <stop offset="100%" stop-color="#eee7d8"/>
    </linearGradient>

    <!-- Dark Obsidian Gradient -->
    <linearGradient id="bgDark" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0d221b"/>
      <stop offset="48%" stop-color="#071711"/>
      <stop offset="100%" stop-color="#020906"/>
    </linearGradient>

    <filter id="markShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.36"/>
    </filter>

    <style>
      .app-bg { fill: url(#bgEmerald); }
      .app-sheen { display: block; }
      .app-border { stroke: rgba(255, 255, 255, 0.22); }
      .mark-body { fill: #f5f1e6; }
      .mark-accent { fill: #d9b45b; }
      .mark-depth { fill: #e8e2d2; }
      
      @media (prefers-color-scheme: light) {
        .app-bg { fill: url(#bgEmerald); }
        .app-sheen { display: block; }
        .app-border { stroke: rgba(255, 255, 255, 0.22); }
        .mark-body { fill: #f5f1e6; }
        .mark-accent { fill: #d9b45b; }
        .mark-depth { fill: #e8e2d2; }
      }
      
      @media (prefers-color-scheme: dark) {
        .app-bg { fill: url(#bgDark); }
        .app-sheen { display: none; }
        .app-border { stroke: rgba(217, 180, 91, 0.3); }
        .mark-body { fill: #f5f1e6; }
        .mark-accent { fill: #d9b45b; }
        .mark-depth { fill: #e8e2d2; }
      }
    </style>
  </defs>

  <!-- Container -->
  <rect class="app-bg" width="512" height="512" rx="${rx}"/>
  <rect class="app-sheen" width="512" height="512" rx="${rx}" fill="url(#topSheen)"/>
  <rect class="app-border" x="1" y="1" width="510" height="510" rx="${rx - 1}" fill="none" stroke-width="2"/>

  <!-- NASAQ Mark -->
  <g transform="translate(${tx.toFixed(2)}, ${ty.toFixed(2)}) scale(${scale.toFixed(5)})" filter="url(#markShadow)">
    <path class="mark-body" d="${path2}"/>
    <path class="mark-accent" d="${path1_a}"/>
    <path class="mark-accent" d="${path1_b}"/>
    <path class="mark-depth" d="${path3}"/>
  </g>
</svg>`;
}

/**
 * Generate Favicon SVG (crisp 32x32 vector container)
 */
function buildFaviconSvg() {
  const size = 32;
  const scale = (20.5 / 210.14);
  const markW = 141.11 * scale;
  const markH = 210.14 * scale;
  const tx = (size - markW) / 2;
  const ty = (size - markH) / 2;
  const rx = 7;

  const path1_a = markPaths.find((p, i) => i === 1)?.d || "";
  const path1_b = markPaths.find((p, i) => i === 2)?.d || "";
  const path2 = markPaths.find((p, i) => i === 0)?.d || "";
  const path3 = markPaths.find((p, i) => i === 3)?.d || "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <defs>
    <linearGradient id="favBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#007a3c"/>
      <stop offset="100%" stop-color="#004822"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="${rx}" fill="url(#favBg)"/>
  <rect x="0.5" y="0.5" width="31" height="31" rx="${rx - 0.5}" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
  <g transform="translate(${tx.toFixed(2)}, ${ty.toFixed(2)}) scale(${scale.toFixed(5)})">
    <path fill="#f5f1e6" d="${path2}"/>
    <path fill="#d9b45b" d="${path1_a}"/>
    <path fill="#d9b45b" d="${path1_b}"/>
    <path fill="#e8e2d2" d="${path3}"/>
  </g>
</svg>`;
}

/**
 * Render SVG string to PNG Buffer at target size
 */
function renderPng(svgStr, targetSize) {
  const resvg = new Resvg(svgStr, {
    fitTo: { mode: "width", value: targetSize },
    shapeRendering: 2, // geometricPrecision
    imageRendering: 0, // optimizeQuality
  });
  return resvg.render().asPng();
}

console.log("Generating NASAQ Application Icon suite...");

// 1. Emit SVG App Icons
const adaptiveSvg = buildAdaptiveAppIconSvg();
writeFileSync(join(OUT_ICONS, "nasaq-app-icon.svg"), adaptiveSvg);

const lightSvg = buildAppIconSvg({ theme: "light", rounded: true, size: 512 });
writeFileSync(join(OUT_ICONS, "nasaq-app-icon-light.svg"), lightSvg);

const darkSvg = buildAppIconSvg({ theme: "dark", rounded: true, size: 512 });
writeFileSync(join(OUT_ICONS, "nasaq-app-icon-dark.svg"), darkSvg);

const faviconSvg = buildFaviconSvg();
writeFileSync(join(OUT_PUBLIC, "favicon.svg"), faviconSvg);

// 2. Base SVGs for Rasterization
const emeraldRoundedSvg = buildAppIconSvg({ theme: "emerald", rounded: true, size: 512 });
const emeraldSquareSvg = buildAppIconSvg({ theme: "emerald", rounded: false, size: 512 });
const maskableSvg = buildAppIconSvg({ theme: "maskable", rounded: false, size: 512 });
const lightRoundedSvg = buildAppIconSvg({ theme: "light", rounded: true, size: 512 });
const darkRoundedSvg = buildAppIconSvg({ theme: "dark", rounded: true, size: 512 });

// 3. Emit Standard PWA / Desktop Icons
const standardSizes = [16, 32, 48, 96, 128, 192, 384, 512];
for (const size of standardSizes) {
  const pngBuf = renderPng(emeraldRoundedSvg, size);
  writeFileSync(join(OUT_ICONS, `nasaq-${size}.png`), pngBuf);
  console.log(`  ✓ public/icons/nasaq-${size}.png (${size}x${size}, ${(pngBuf.length / 1024).toFixed(1)} KB)`);
}

// 4. Emit iOS / iPadOS Apple Touch Icon (Square edge-to-edge for native iOS squircle mask)
const ios180 = renderPng(emeraldSquareSvg, 180);
writeFileSync(join(OUT_ICONS, "nasaq-180.png"), ios180);
console.log(`  ✓ public/icons/nasaq-180.png (180x180 iOS Apple Touch Icon)`);

// Also update public/__grok/icon-180.png
writeFileSync(join(OUT_GROK, "icon-180.png"), ios180);
console.log(`  ✓ public/__grok/icon-180.png (180x180 Platform Tile)`);

// 5. Emit Android Maskable Adaptive Icon
const maskable512 = renderPng(maskableSvg, 512);
writeFileSync(join(OUT_ICONS, "nasaq-maskable-512.png"), maskable512);
console.log(`  ✓ public/icons/nasaq-maskable-512.png (512x512 Maskable Icon)`);

// 6. Emit Light & Dark Mode Rasters
writeFileSync(join(OUT_ICONS, "nasaq-light-192.png"), renderPng(lightRoundedSvg, 192));
writeFileSync(join(OUT_ICONS, "nasaq-light-512.png"), renderPng(lightRoundedSvg, 512));
writeFileSync(join(OUT_ICONS, "nasaq-dark-192.png"), renderPng(darkRoundedSvg, 192));
writeFileSync(join(OUT_ICONS, "nasaq-dark-512.png"), renderPng(darkRoundedSvg, 512));
console.log(`  ✓ public/icons/nasaq-light-* & nasaq-dark-* (192 & 512)`);

console.log("\nAll NASAQ app icon assets generated successfully!");
