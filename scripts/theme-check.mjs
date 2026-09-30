#!/usr/bin/env node
/**
 * Theme contrast guard.
 *
 * Two checks, no browser needed:
 *
 *  1. ROLE AUDIT — every class list in the source is read as a set of colour
 *     roles (background + label, including their `hover:`/`focus:`/`active:`
 *     forms). Each pair must clear WCAG AA against the resolved surface in BOTH
 *     themes, using the palettes from src/styles.css. This is what catches the
 *     "label disappears on hover in Dark" family of bugs.
 *  2. RAW COLOUR AUDIT — chrome must not paint fixed colours. A literal hex or
 *     a Tailwind palette step cannot follow the theme, so each one is reported
 *     unless the file is document artwork (a page of paper keeps its design
 *     colours in both themes) or listed below as an intentionally dark surface.
 *
 * Run: node scripts/theme-check.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS = readFileSync(join(ROOT, "src/styles.css"), "utf8");

/* ------------------------------------------------------------- palette ---- */

const problems0 = [];

const hexToRgb = (h) => {
  const s = h.replace("#", "");
  const f = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255);
};

function parsePalette(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

const themeBlock = CSS.slice(CSS.indexOf("@theme {"), CSS.indexOf("\n}", CSS.indexOf("@theme {")));
const darkBlock = CSS.slice(
  CSS.indexOf("html.dark {"),
  CSS.indexOf("\n}", CSS.indexOf("html.dark {")),
);
const lightTokens = parsePalette(themeBlock);
const darkBlockParsed = parsePalette(darkBlock);
const darkTokens = { ...lightTokens, ...darkBlockParsed };

/* The whole system hangs on one block: if `html.dark` stops re-pointing the core
   roles, every role utility below it goes unreadable and this guard would
   otherwise stay silent (identical palettes trivially "pass"). Fail loudly. */
for (const role of ["color-page", "color-ink", "color-muted", "color-line", "color-brand"]) {
  if (darkBlockParsed[role] === undefined)
    problems0.push(`html.dark no longer re-points --${role}; the theme toggle cannot work`);
}
for (const role of ["color-page", "color-ink", "color-muted", "color-line"]) {
  if (darkBlockParsed[role] !== undefined && darkBlockParsed[role] === lightTokens[role])
    problems0.push(`--${role} has the same value in both palettes — Dark mode will not adapt`);
}

function resolve(name, tokens, depth = 0) {
  const raw = tokens[name] ?? tokens[`color-${name}`];
  if (raw == null || depth > 6) return null;
  const v = String(raw).trim();
  if (v.startsWith("#")) return v;
  const ref = v.match(/^var\(--([a-z0-9-]+)\)$/);
  if (ref) return resolve(ref[1].replace(/^color-/, ""), tokens, depth + 1);
  const mix = v.match(/^color-mix\(in srgb,\s*(#[0-9a-f]{3,8})\s+(\d+)%,\s*transparent\)$/i);
  if (mix) return mix[1];
  return null;
}

const relLum = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const l1 = relLum(a);
  const l2 = relLum(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};
/** Alpha foreground over a background hex. */
const over = (fg, bg, alpha) => {
  const [r, g, b] = hexToRgb(fg);
  const [br, bg2, bb] = hexToRgb(bg);
  const m = (a, b2) => Math.round((a * alpha + b2 * (1 - alpha)) * 255);
  return `#${[m(r, br), m(g, bg2), m(b, bb)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

/* ---------------------------------------------------------- class lists ---- */

/** Roles the audit resolves. Anything outside this set is ignored (spacing…). */
const ROLE =
  /^(?:paper|page|surface|surface-2|ink|muted|line|line-2|navy|navy-2|navy-3|green|green-2|gold|gold-2|brand|brand-hover|on-brand|inverse|inverse-hover|on-inverse|danger|ok|error|success|warning|scrim|on-gold|white|black)$/;
const ROLE_UTIL = /^(bg|text|border|ring|divide|placeholder|fill|stroke)-(on-brand|on-inverse|brand-hover|surface-2|inverse-hover|line-2|navy-2|navy-3|green-2|gold-2|brand|surface|paper|page|ink|muted|line|navy|green|gold|inverse|danger|ok|error|success|warning|scrim|on-gold|white|black)$/;
const RAW_UTIL = /^(bg|text|border|ring|divide|placeholder|fill|stroke)-(\[#|slate-|gray-|zinc-|neutral-|stone-|emerald-|green-|red-|rose-|amber-|yellow-|blue-|sky-|indigo-|violet-|purple-|orange-|teal-|cyan-|lime-|fuchsia-|pink-)/;

/* A few surfaces are deliberately fixed-tone: the owner gate renders on its own
 * near-black backdrop in both themes, and the preview viewport / document
 * artwork must stay paper- or stage-coloured. They are allowlisted below and
 * each of those files keeps its own explicit light labels. */
const FIXED_TONE = new Set([
  "src/components/site/BrandKitPage.tsx", // labels sit on the kit's own colour, not on the page
  "src/components/admin/AdminDashboard.tsx", // owner gate backdrop
  "src/components/editor/ExportDialog.tsx", // page-preview viewport (stage)
  "src/components/editor/NsqIntake.tsx", // intake preview stage
  "src/components/editor/WorkspaceOverlays.tsx", // poster preview stage
]);
const CHROME_EXEMPT = new Set([
  // Document artwork: a page of paper keeps its own colours in both themes.
  "src/components/site/TemplatePreview.tsx",
  "src/components/site/HeroShowcase.tsx",
  "src/components/editor/CanvasStage.tsx",
  "src/components/editor/ElementNode.tsx",
  "src/components/editor/ShapeGlyph.tsx",
  "src/components/editor/ShapePreview.tsx",
  "src/components/editor/PrintGuides.tsx",
  "src/components/editor/ui/ColorField.tsx",
  "src/components/editor/StudioToolDock.tsx",
  // The owner vault is a deliberately dark, self-contained surface: its colours
  // are chosen for that surface, not for the visitor's theme.
  "src/components/admin/OwnerVaultPage.tsx",
  "src/components/admin/OwnerSetupPanel.tsx",
  "src/components/admin/GumroadGatewayCard.tsx",
]);

function* tsxFiles(dir, base = "") {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = base ? `${base}/${entry}` : entry;
    const abs = join(ROOT, dir, entry);
    if (statSync(abs).isDirectory()) yield* tsxFiles(join(dir, entry), rel);
    else if (/\.tsx?$/.test(entry) && !/\.test\.ts$/.test(entry)) yield rel;
  }
}

const STRING_RE = /(["'`])((?:\\.|(?!\1)[^\\\r\n])*)\1/gs;

const problems = [];
let lists = 0;

for (const rel of tsxFiles("src", "src")) {
  const exempt = CHROME_EXEMPT.has(rel) || FIXED_TONE.has(rel);
  const src = readFileSync(join(ROOT, rel), "utf8");
    const srcLines = src.split("\n");
  for (const m of src.matchAll(STRING_RE)) {
    const body = m[2];
    const looksLikeClasses = body
      .split(/\s+/)
      .some((t) => ROLE_UTIL.test(t.replace(/^(?:[a-z-]+:)*/, "")) || RAW_UTIL.test(t.replace(/^(?:[a-z-]+:)*/, "")));
    if (!looksLikeClasses) continue;
    if (!/(^|\s)(?:[a-z-]+:)*(?:bg|text|border)-/.test(body)) continue;
    lists++;
    const lineStart = src.slice(0, m.index).split("\n").length;
    const tokens = body.split(/\s+/).filter(Boolean);
    /* group by variant chain ("" for the default state) */
    const byVariant = new Map();
    for (const t of tokens) {
      const parts = t.split(":");
      const base = parts.at(-1);
      const variants = parts.slice(0, -1).filter((v) => v !== "dark");
      const key = variants.join(":");
      const list = byVariant.get(key) ?? [];
      list.push({ base, darkOnly: parts.includes("dark") });
      byVariant.set(key, list);
    }

    for (const [variant, group] of byVariant) {
      if (variant === "group-hover" || variant === "peer-hover") continue;
      const bg = group.filter((g) => /^bg-/.test(g.base) && !g.darkOnly);
      const fg = group.filter((g) => /^text-/.test(g.base) && !g.darkOnly);
      for (const raw of group) {
        if (exempt && RAW_UTIL.test(raw.base)) continue;
        if (RAW_UTIL.test(raw.base) && !raw.darkOnly) {
          problems.push({
            file: rel,
            kind: "raw-colour",
            detail: `${variant ? `${variant}:` : ""}${raw.darkOnly ? "dark:" : ""}${raw.base} paints a fixed colour and cannot follow the theme`,
          });
        }
      }
      // `text-white` with no fill of its own is white-on-page: unreadable in Light.
      for (const f of group) {
        if (!/^text-white$/.test(f.base) || f.darkOnly) continue;
        const onArtwork = group.some((g) => /^bg-(inverse|navy|green|gold|danger|ok|black|\[#|white\/)/.test(g.base));
        // A `cn(...)` call may pass the fill in a sibling argument, so look at the
        // surrounding source rather than only this one string literal.
        const window = srcLines.slice(Math.max(0, lineStart - 6), lineStart + 4).join(" ");
        const fillNearby = /bg-(inverse|navy|navy-2|green|gold|danger|ok|black)\b|bg-\[/.test(window);
        if (!onArtwork && !fillNearby && !exempt)
          problems.push({ file: rel, kind: "contrast", detail: `${variant ? `${variant}:` : ""}text-white without a fill of its own` });
      }
      /* A solid fill carries its own label: without an explicit one the text
         inherits the page ink and disappears (light ink on a light fill, or the
         other way round). Tints and artwork are exempt. */
      const SOLID_FILL = /^(?:bg-(navy|navy-2|navy-3|green|green-2|danger|ok|gold|inverse|inverse-hover))$/;
      for (const b of bg) {
        if (!SOLID_FILL.test(b.base) || variant) continue;
        if (b.base.includes("/")) continue;
        const hasLabel = group.some((g) => /^text-/.test(g.base));
        const hasOwnLabel = group.some((g) => /^text-/.test(g.base) && !/^text-\[/.test(g.base) && !/^text-(xs|sm|base|lg|xl|2xl)$/.test(g.base));
        // A list with no typography at all is a bar, a dot or a swatch: nothing
        // to read, so no label to lose.
        const texty = group.some((g) => /^text-\[\d|^text-(xs|sm|base|lg|xl)|^font-/.test(g.base));
        if (!hasLabel && texty && !hasOwnLabel && !exempt)
          problems.push({
            file: rel,
            kind: "contrast",
            detail: `${variant ? `${variant}:` : ""}${b.base} has no label colour of its own`,
          });
      }
      if (!bg.length || !fg.length) continue;
      for (const theme of ["light", "dark"]) {
        const tokens2 = theme === "light" ? lightTokens : darkTokens;
        const surface = resolve("color-surface", tokens2) ?? "#ffffff";
        for (const b of bg) {
          for (const f of fg) {
            const bName = b.base.slice(3);
            const fName = f.base.slice(5);
            const [bRole, bAlphaRaw] = bName.split("/");
            const [fRole] = fName.split("/");
            if (!ROLE.test(bRole) || !ROLE.test(fRole)) continue;
            let bgHex = resolve(bRole, tokens2);
            let fgHex = resolve(fRole, tokens2);
            if (!bgHex || !fgHex) continue;
            const a = bAlphaRaw?.startsWith("[")
              ? Number(bAlphaRaw.slice(1, -1))
              : Number(bAlphaRaw) / 100;
            if (bAlphaRaw && !Number.isNaN(a)) bgHex = over(bgHex, surface, a);
            const ratio = contrast(fgHex, bgHex);
            const need = 4.5;
            if (ratio < need) {
              problems.push({
                file: rel,
                kind: "contrast",
                detail: `${theme}: ${variant ? `${variant}:` : ""}${b.base} + ${f.base} = ${ratio.toFixed(2)}:1 (min ${need})`,
              });
            }
          }
        }
      }
    }
  }
}

/* ------------------------------------------------- palette self-audit ---- */

/**
 * Every role pair the theme promises. Values come from styles.css, so this is a
 * test of the palette itself — the numbers cannot be edited here to pass.
 */
const PAIR_CHECKS = [
  ["ink", "paper"], ["ink", "surface"], ["ink", "surface-2"],
  ["muted", "paper"], ["muted", "surface"], ["muted", "surface-2"],
  ["brand", "paper"], ["brand", "surface"], ["brand", "surface-2"],
  ["brand-hover", "surface"],
  ["on-brand", "navy"], ["on-brand", "navy-2"], ["on-brand", "green"], ["on-brand", "danger"], ["on-brand", "ok"], ["on-gold", "gold"],
  ["on-inverse", "inverse"], ["on-inverse", "inverse-hover"],
  ["error", "surface"], ["error", "paper"], ["success", "surface"], ["warning", "surface"],
  ["line", "surface"],
];
for (const theme of ["light", "dark"]) {
  const tokens = theme === "light" ? lightTokens : darkTokens;
  for (const [fg, bg] of PAIR_CHECKS) {
    const f = resolve(fg, tokens);
    const b = resolve(bg, tokens);
    if (!f || !b) {
      problems.push({ file: "src/styles.css", kind: "token", detail: `${theme}: missing token ${fg} or ${bg}` });
      continue;
    }
    const ratio = contrast(f, b);
    const isBorder = fg === "line";
    if (ratio < (isBorder ? 1.15 : 4.5)) {
      problems.push({
        file: "src/styles.css",
        kind: "palette",
        detail: `${theme}: --color-${fg} on --color-${bg} = ${ratio.toFixed(2)}:1`,
      });
    }
  }
}

/* ------------------------------------------------------------- report ---- */

const byKind = new Map();
for (const p of problems) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
console.log(
  `scanned ${lists} class list(s); ${problems.length + problems0.length} issue(s) ${[...byKind]
    .map(([k, v]) => `${k}=${v}`)
    .join(" ")}${problems0.length ? ` palette=${problems0.length}` : ""}`,
);
const shown = new Map();
for (const detail of problems0) console.error(`  [palette] src/styles.css\n      ${detail}`);
for (const p of problems) {
  const key = `${p.file}:${p.kind}`;
  const n = (shown.get(key) ?? 0) + 1;
  shown.set(key, n);
  if (n <= 3) console.log(`  [${p.kind}] ${p.file}\n      ${p.detail}`);
}
if (problems.length + problems0.length) process.exitCode = 1;
