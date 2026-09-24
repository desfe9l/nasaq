import { toast } from "sonner";
import { downloadBlob, downloadText } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import {
  cssFont,
  pageSize,
  parseTable,
  type CanvasEl,
  type Page,
  type Project,
} from "./model";
import { prepareText, type PageContext } from "./text-render";
import { shapeSvgMarkup, strokeToUnits } from "./shape-render";
import { applyNumerals } from "./arabic";
import { safeImageSrc } from "./images";
import { applySvgColors, safeSvgSrc, sanitizeSvgContent } from "./svg";

export type ExportFormat =
  "pdf" | "pptx" | "docx" | "png" | "jpg" | "html" | "json";

/** Formats that produce editable Office documents rather than flattened pages. */
const OFFICE_FORMATS = new Set<ExportFormat>(["pptx", "docx"]);

function waitFrame() {
  return new Promise<void>((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r())),
  );
}

/**
 * Copy every registered web font into `doc`.
 *
 * html2canvas rasterises from a CLONED document inside an iframe, and that clone
 * re-parses stylesheets from scratch. `@font-face` rules registered at runtime
 * through `document.fonts.add(...)` (user-uploaded TTF/OTF via the font picker)
 * exist only in the live document — so in the clone every custom family falls
 * back, and the exported page ships with a different font and different text
 * metrics than the canvas the author was looking at. Cloning the FontFace
 * objects across is what makes the rasteriser see exactly the faces the editor
 * renders with.
 */
function cloneFontsInto(doc: Document) {
  if (!document.fonts) return;
  const target = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (!target) return;
  document.fonts.forEach((face) => {
    try {
      // A data-URL source is self-contained, so the clone can re-load it with no
      // network and no CORS involvement. `source` is newer than this project's
      // DOM typings, hence the guarded read.
      const src = (face as unknown as { source?: string }).source;
      const twin = new FontFace(
        face.family,
        typeof src === "string" && src
          ? src
          : (`url()` as unknown as BufferSource),
        {
          weight: face.weight,
          style: face.style,
          display: face.display,
        },
      );
      target.add(twin);
      void twin.load().catch(() => undefined);
    } catch {
      // A face that cannot be cloned (blob revoked, etc.) must not abort export;
      // the family simply falls back as before.
    }
  });
}

async function waitImages(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((res) => {
          if (img.complete && img.naturalWidth > 0) return res();
          const done = () => res();
          img.onload = done;
          img.onerror = done;
          // Large photos at export scale can take longer than a blink to decode;
          // a too-short timeout here is how pictures silently vanish from the
          // exported file while being perfectly visible on the canvas.
          setTimeout(done, 8000);
        }),
    ),
  );
}

/** Every distinct family/size currently painted inside the page, so the
 *  rasteriser can force each one to load before it snapshots. */
async function ensureFonts(root: HTMLElement) {
  if (!document.fonts) return;
  const specs = new Set<string>();
  root.querySelectorAll<HTMLElement>("*").forEach((el) => {
    const cs = getComputedStyle(el);
    if (!cs.fontFamily) return;
    const size = parseFloat(cs.fontSize) || 14;
    const weight = cs.fontWeight || "400";
    cs.fontFamily.split(",").forEach((family) => {
      const clean = family.trim().replace(/^["']|["']$/g, "");
      if (clean) specs.add(`${weight} ${size}px "${clean}"`);
    });
  });
  await Promise.all(
    [...specs].map((spec) => document.fonts.load(spec).catch(() => undefined)),
  );
  await Promise.race([
    document.fonts.ready,
    new Promise((r) => setTimeout(r, 3000)),
  ]);
}

/** Editor chrome that must never appear in an export. */
function stripAuthoringChrome(doc: Document) {
  // Selection handles are UI, not artwork — and CSS pseudo-elements are never
  // captured, so only the real handle nodes need removing. The whole selection
  // layer goes with them: it is overlay chrome above the artwork, not content.
  doc
    .querySelectorAll(
      ".handle, .rotate-handle, .selection-layer, .overflow-badge, .guide-v, .guide-h, .marquee",
    )
    .forEach((h) => h.remove());
  // The selection ring is authoring chrome; it must not bake into the asset.
  doc.querySelectorAll(".selected, .is-secondary, .locked").forEach((n) => {
    n.classList.remove("selected", "is-secondary", "locked");
  });
}

export interface CapturedPage {
  canvas: HTMLCanvasElement;
  /** Page size in mm, so writers never assume A4. */
  w: number;
  h: number;
}

/**
 * Rasterise one selected element to a transparent PNG data URL.
 *
 * Used by "save to library": a shape the author arranged on the canvas (a
 * divider, a seal, a decorated box) becomes a reusable picture. Scaled from the
 * element's own millimetre box so the saved asset keeps its print resolution
 * instead of the current zoom level.
 */
export async function captureElement(
  elId: string,
  exportScale: number,
): Promise<string | null> {
  const node = document.querySelector<HTMLElement>(
    `[data-el-id="${CSS.escape(elId)}"]`,
  );
  if (!node) return null;
  const html2canvas = (await import("html2canvas")).default;
  await waitFrame();
  await waitImages(node);
  await ensureFonts(node);
  const canvas = await html2canvas(node, {
    scale: exportScale,
    useCORS: true,
    allowTaint: true,
    // Selection handles are UI, not artwork — and CSS pseudo-elements are never
    // captured, so only the real handle nodes need removing.
    backgroundColor: null,
    logging: false,
    width: node.offsetWidth,
    height: node.offsetHeight,
    windowWidth: node.offsetWidth,
    windowHeight: node.offsetHeight,
    onclone: (doc) => {
      cloneFontsInto(doc);
      stripAuthoringChrome(doc);
    },
  });
  return canvas.toDataURL("image/png");
}

/**
 * Rasterise the hidden 1:1 desktop pages.
 *
 * `delayMs` is offered as an escape hatch for very heavy documents: a short
 * pause between pages lets the main thread breathe so the dialog stays
 * responsive and the browser does not drop the file handle.
 */
export async function capturePages(
  targets: { node: HTMLElement; w: number; h: number }[],
  scale: number,
  onProgress?: (i: number, n: number) => void,
  delayMs = 30,
): Promise<CapturedPage[]> {
  const html2canvas = (await import("html2canvas")).default;
  const out: CapturedPage[] = [];
  for (let i = 0; i < targets.length; i++) {
    const { node, w, h } = targets[i];
    onProgress?.(i, targets.length);
    await waitFrame();
    await waitImages(node);
    await ensureFonts(node);
    // The live page allows elements to overflow its edges (free positioning
    // while editing — see model.ts:constrainElement). Export must still be
    // page-bounded, so we clip only the *cloned* node html2canvas rasterises,
    // never the interactive DOM the user is actually working in.
    const pageId = node.getAttribute("data-export-page");
    const canvas = await html2canvas(node, {
      scale,
      useCORS: true,
      allowTaint: true,
      // The page itself owns its background (including transparent pages). Do
      // not let html2canvas replace it with a white export backdrop.
      backgroundColor: null,
      logging: false,
      width: node.offsetWidth,
      height: node.offsetHeight,
      windowWidth: node.offsetWidth,
      windowHeight: node.offsetHeight,
      onclone: (clonedDoc) => {
        cloneFontsInto(clonedDoc);
        const target = pageId
          ? (clonedDoc.querySelector(
              `[data-export-page="${CSS.escape(pageId)}"]`,
            ) as HTMLElement | null)
          : null;
        if (target) target.style.overflow = "hidden";
        // The hidden capture pages are rendered with `interactive={false}`, so
        // handles and badges never appear — but the shared helper keeps the
        // guarantee in one place in case an authoring class ever lands here.
        stripAuthoringChrome(clonedDoc);
      },
    });
    out.push({ canvas, w, h });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }
  return out;
}

/** Highest-quality JPEG payload for a canvas (print-safe at 1.0). */
function jpegData(canvas: HTMLCanvasElement, quality = 0.94) {
  return canvas.toDataURL("image/jpeg", quality);
}

export async function exportPdf(pages: CapturedPage[], name: string) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    orientation: pages[0].w > pages[0].h ? "landscape" : "portrait",
    unit: "mm",
    format: [pages[0].w, pages[0].h],
    compress: true,
  });
  pages.forEach((p, i) => {
    const orientation = p.w > p.h ? "landscape" : "portrait";
    if (i > 0) pdf.addPage([p.w, p.h], orientation);
    pdf.addImage(jpegData(p.canvas), "JPEG", 0, 0, p.w, p.h, undefined, "FAST");
  });
  pdf.save(`${name}.pdf`);
}

/**
 * Export editable PowerPoint slides.
 *
 * Each page becomes a slide whose text, tables, shapes and pictures are real
 * PowerPoint objects, so the deck can be corrected and restyled after export.
 * This runs off the page model rather than the rendered DOM, so it needs no
 * raster capture at all.
 */
export async function exportPptxEditable(pages: Page[], name: string) {
  const { buildScene } = await import("./scene");
  const { writePptx } = await import("./pptx-writer");
  const blob = await writePptx(
    buildScene(await materializeSvgSources(pages)),
    name,
  );
  downloadBlob(blob, `${name}.pptx`);
}

/**
 * Export an editable Word document.
 *
 * Text arrives as real runs in floating frames, tables as Word tables, and
 * shapes as native `wps:wsp` drawings with preset or custom geometry, so the
 * document can be edited rather than being a set of page images.
 */
export async function exportDocxEditable(pages: Page[], name: string) {
  const { buildScene } = await import("./scene");
  const { writeDocx } = await import("./docx-writer");
  const blob = await writeDocx({
    scenes: buildScene(await materializeSvgSources(pages)),
    title: name,
  });
  downloadBlob(blob, `${name}.docx`);
}

/**
 * Materialise every svg element's raster source before scene building.
 *
 * SVG elements carry their vector markup in `content`; the Office scene needs
 * image bytes in `src`. Each svg's PNG is written into a CLONE of the page
 * list (originals untouched — the editor keeps its vector), then the scene is
 * built from the clones. Failures leave `src` empty and the element is simply
 * skipped by the scene mapper, exactly like a broken image.
 */
async function materializeSvgSources(pages: Page[]): Promise<Page[]> {
  const needs = pages.some((p) =>
    p.elements.some((el) => el.type === "svg" && !safeSvgSrc(el.src)),
  );
  if (!needs) return pages;
  const { svgToPngDataUrl } = await import("./svg");
  return Promise.all(
    pages.map(async (page) => ({
      ...page,
      elements: await Promise.all(
        page.elements.map(async (el) => {
          if (el.type !== "svg" || safeSvgSrc(el.src)) return el;
          // Rasterise with the same panel overrides the canvas showed, so the
          // exported file matches what the author sees.
          const painted = applySvgColors(sanitizeSvgContent(el.content || ""), {
            fill: el.style.svgFill,
            stroke: el.style.svgStroke,
            strokeWidth: el.style.svgStrokeWidth,
          });
          const png = await svgToPngDataUrl(painted, el.w, el.h, 2);
          return png ? { ...el, src: png } : el;
        }),
      ),
    })),
  );
}

/**
 * Flatten captured pages into a Word document.
 *
 * The escape hatch for documents whose fonts or exotic shapes a viewer would
 * mangle in the editable path: each page becomes one full-bleed picture, so the
 * result is not editable but is an exact match for the design.
 */
export async function exportDocxRaster(pages: CapturedPage[], name: string) {
  const { Document, ImageRun, Packer, Paragraph, convertMillimetersToTwip } =
    await import("docx");
  const first = pages[0];
  const landscape = first.w > first.h;
  const section = {
    page: {
      size: {
        width: convertMillimetersToTwip(first.w),
        height: convertMillimetersToTwip(first.h),
        orientation: landscape ? ("landscape" as const) : ("portrait" as const),
      },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    children: pages.map(
      (p) =>
        new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [
            new ImageRun({
              type: "png",
              data: pngBytes(p.canvas),
              transformation: { width: p.w, height: p.h },
            }),
          ],
        }),
    ),
  };
  const doc = new Document({ sections: [section] });
  downloadBlob(await Packer.toBlob(doc), `${name}.docx`);
}

/**
 * Flatten captured pages into a PowerPoint deck.
 *
 * One full-bleed picture per slide. Like the Word raster path this trades
 * editability for a pixel-exact match, and is the fallback when the editable
 * path cannot represent a design faithfully.
 */
export async function exportPptxRaster(pages: CapturedPage[], name: string) {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.rtlMode = true;
  const first = pages[0];
  const layout = "page";
  pptx.defineLayout({
    name: layout,
    width: first.w / 25.4,
    height: first.h / 25.4,
  });
  pptx.layout = layout;
  pages.forEach((p) => {
    const slide = pptx.addSlide();
    slide.addImage({
      data: pngDataUrl(p.canvas),
      x: 0,
      y: 0,
      w: p.w / 25.4,
      h: p.h / 25.4,
    });
  });
  const blob = (await pptx.write({ outputType: "blob" })) as Blob;
  downloadBlob(blob, `${name}.pptx`);
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality),
  );
}

/** PNG bytes for the Word writer, which needs a byte array rather than a URL. */
function pngBytes(canvas: HTMLCanvasElement): Uint8Array {
  const url = canvas.toDataURL("image/png");
  const binary = atob(url.slice(url.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pngDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

export async function exportImages(
  pages: CapturedPage[],
  name: string,
  type: "png" | "jpg",
) {
  const mime = type === "png" ? "image/png" : "image/jpeg";
  const ext = type === "png" ? "png" : "jpg";
  if (pages.length === 1) {
    const blob = await canvasToBlob(
      pages[0].canvas,
      mime,
      type === "jpg" ? 0.95 : undefined,
    );
    if (blob) downloadBlob(blob, `${name}.${ext}`);
    return;
  }
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (let i = 0; i < pages.length; i++) {
    const blob = await canvasToBlob(
      pages[i].canvas,
      mime,
      type === "jpg" ? 0.95 : undefined,
    );
    if (blob)
      zip.file(`${name}-p${String(i + 1).padStart(2, "0")}.${ext}`, blob);
  }
  const out = await zip.generateAsync({ type: "blob" });
  downloadBlob(out, `${name}-pages.zip`);
}

function esc(v: unknown) {
  const map: Record<string, string> = {
    "&": "\u0026amp;",
    "<": "\u0026lt;",
    ">": "\u0026gt;",
    '"': "\u0026quot;",
    "'": "\u0026#039;",
  };
  return String(v ?? "").replace(/[&<>"']/g, (ch) => map[ch] || ch);
}

function formatMultiline(text: string) {
  return esc(text).replace(/\n/g, "<br/>");
}

/** Only allow values that are safe inside a CSS declaration. */
function cssColor(v: string | undefined, fallback: string) {
  if (!v) return fallback;
  const value = String(v).trim();
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
  if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$/i.test(value)) return value;
  if (/^[a-z]+$/i.test(value)) return value;
  return fallback;
}

/**
 * Exported HTML is a standalone document that the user may open, host or email,
 * and its element data can arrive from an imported `.json` file. Every value
 * interpolated into that document is therefore treated as untrusted: numbers are
 * coerced, keyword/enum values are whitelisted, and anything unrecognised falls
 * back to a safe default rather than reaching the markup — a crafted style value
 * would otherwise break out of the attribute and inject script.
 */
function num(v: unknown, fallback: number, min = -1e6, max = 1e6) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Whitelisted CSS keyword (alignment, object-fit, font style, …). */
function cssKeyword(v: unknown, allowed: readonly string[], fallback: string) {
  const value = String(v ?? "")
    .trim()
    .toLowerCase();
  return allowed.includes(value) ? value : fallback;
}

const TEXT_ALIGN = [
  "right",
  "left",
  "center",
  "justify",
  "start",
  "end",
] as const;
const OBJECT_FIT = ["cover", "contain", "fill", "none", "scale-down"] as const;
const FONT_STYLE = ["normal", "italic", "oblique"] as const;

/**
 * One element as HTML.
 *
 * `pageRef` carries the page the element belongs to so `{رقم_الصفحة_من_الكل}`
 * resolves per page — the standalone file renders the whole document in one
 * pass, where a single ambient page number would print the same number on every
 * sheet.
 */
function elHtml(el: CanvasEl, pageRef?: PageContext): string {
  const s = el.style || {};
  const wrap = (inner: string) =>
    `<div class="el" style="left:${num(el.x, 0, -1e4, 1e4)}mm;top:${num(el.y, 0, -1e4, 1e4)}mm;width:${num(el.w, 40, 0, 1e4)}mm;height:${num(el.h, 20, 0, 1e4)}mm;transform:rotate(${num(el.rotation, 0, -3600, 3600)}deg);opacity:${num(el.opacity, 1, 0, 1)};z-index:${num(el.z, 1, -1e4, 1e4)};box-shadow:${esc(s.shadow || "none")}">${inner}</div>`;

  /** Mirror of the canvas text options so the exported file matches the screen. */
  const text = prepareText(el, pageRef);
  const verticalCss =
    s.writingMode === "vertical"
      ? "writing-mode:vertical-rl;text-orientation:mixed;"
      : "";
  // `prepareText` already applied the numeral style, so the string is used as-is.
  const body = (fallback = "") => formatMultiline(text.text || fallback);

  if (el.hidden) return "";
  if (el.type === "group") {
    return wrap(
      (el.children || [])
        .slice()
        .sort((a, b) => num(a.z, 0) - num(b.z, 0))
        .map((child) => elHtml(child, pageRef))
        .join(""),
    );
  }
  if (el.type === "text") {
    return wrap(
      `<div class="text" style="font-family:${cssFont(s.fontFamily)};font-size:${num(text.fontSize, 14, 4, 400)}pt;color:${cssColor(s.color, "#172033")};font-weight:${num(s.fontWeight, 600, 100, 900)};text-align:${cssKeyword(s.textAlign, TEXT_ALIGN, "right")};line-height:${num(text.lineHeight, 1.45, 0.5, 5)};font-style:${cssKeyword(s.fontStyle, FONT_STYLE, "normal")};letter-spacing:${num(s.letterSpacing, 0, -10, 50)}mm;direction:rtl;${verticalCss}">${body()}</div>`,
    );
  }
  if (el.type === "box" || el.type === "stat") {
    return wrap(
      `<div class="box" style="background:${cssColor(s.fill || s.background, "#f7f8fb")};border:${num(s.borderWidth, 0.35, 0, 50)}mm solid ${cssColor(s.borderColor, "#d9dee8")};border-radius:${num(s.radius, 4, 0, 500)}mm;padding:${num(s.padding, 4, 0, 200)}mm;font-family:${cssFont(s.fontFamily)};font-size:${num(text.fontSize, 12, 4, 400)}pt;color:${cssColor(s.color, "#172033")};font-weight:${num(s.fontWeight, 600, 100, 900)};text-align:${cssKeyword(s.textAlign, TEXT_ALIGN, "right")};line-height:${num(text.lineHeight, 1.5, 0.5, 5)};direction:rtl;${verticalCss}">${body()}</div>`,
    );
  }
  if (el.type === "progress") {
    const value = num(s.value, 0, 0, 100);
    const shown = s.numerals
      ? `${applyNumerals(String(value), s.numerals)}%`
      : `${value}%`;
    const valueHtml =
      s.showValue === false
        ? ""
        : `<span style="flex-shrink:0">${shown}</span>`;

    if (s.variant === "steps") {
      const total = Math.max(2, Math.min(12, Number(s.steps) || 5));
      const filled = Math.round((value / 100) * total);
      const dotSize = Math.max(2.4, Math.min(num(el.h, 18, 0, 1e4) * 0.34, 7));
      const dots = Array.from(
        { length: total },
        (_, i) =>
          `<span style="width:${dotSize}mm;height:${dotSize}mm;border-radius:999px;flex-shrink:0;background:${i < filled ? cssColor(s.fill, "#006c35") : cssColor(s.background, "#e8ecf3")}"></span>`,
      ).join("");
      return wrap(
        `<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;gap:1.4mm;direction:rtl;overflow:hidden;font-family:${cssFont(s.fontFamily)}">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:2mm;font-size:${num(text.fontSize, 10, 4, 400)}pt;font-weight:${num(s.fontWeight, 700, 100, 900)};color:${cssColor(s.color, "#172033")}"><span class="progress-caption" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${body()}</span>${valueHtml}</div>
          <div style="display:flex;align-items:center;gap:${dotSize * 0.55}mm;flex-shrink:0">${dots}</div>
        </div>`,
      );
    }

    if (s.variant === "ring") {
      const size = Math.max(
        8,
        Math.min(num(el.w, 40, 0, 1e4), num(el.h, 40, 0, 1e4)),
      );
      const thickness = Math.max(1.5, size * 0.11);
      const r = (size - thickness) / 2;
      const circumference = 2 * Math.PI * r;
      const dash = (circumference * value) / 100;
      return wrap(
        `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1mm;direction:rtl;overflow:hidden;font-family:${cssFont(s.fontFamily)};color:${cssColor(s.color, "#172033")}">
          <div style="position:relative;width:${size}mm;height:${size}mm;flex-shrink:0">
            <svg viewBox="0 0 ${size} ${size}" width="100%" height="100%">
              <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${cssColor(s.background, "#e8ecf3")}" stroke-width="${thickness}"/>
              <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${cssColor(s.fill, "#006c35")}" stroke-width="${thickness}" stroke-linecap="round" stroke-dasharray="${dash} ${circumference}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
            </svg>
            <div style="position:absolute;inset:0;display:grid;place-items:center;font-size:${num(text.fontSize, 11, 4, 400)}pt;font-weight:${num(s.fontWeight, 700, 100, 900)}">${shown}</div>
          </div>
          <span class="progress-caption" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">${body()}</span>
        </div>`,
      );
    }

    return wrap(
      `<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;gap:1.4mm;direction:rtl;overflow:hidden;font-family:${cssFont(s.fontFamily)}">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:2mm;font-size:${num(text.fontSize, 10, 4, 400)}pt;font-weight:${num(s.fontWeight, 700, 100, 900)};color:${cssColor(s.color, "#172033")}"><span class="progress-caption" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${body()}</span>${valueHtml}</div>
        <div style="height:${Math.max(2, num(el.h, 16, 0, 1e4) * 0.3)}mm;background:${cssColor(s.background, "#e8ecf3")};border-radius:${num(s.radius, 3, 0, 500)}mm;overflow:hidden;flex-shrink:0"><div style="width:${value}%;height:100%;background:${cssColor(s.fill, "#006c35")}"></div></div>
      </div>`,
    );
  }
  if (el.type === "shape") {
    const borderWidth = num(s.borderWidth, 0, 0, 50);
    return wrap(
      shapeSvgMarkup(s.shapeId || s.shape, {
        fill: cssColor(s.fill, "#006c35"),
        stroke: cssColor(s.borderColor, "transparent"),
        strokeUnits: strokeToUnits(borderWidth, {
          w: num(el.w, 40, 1, 1e4),
          h: num(el.h, 20, 1, 1e4),
        }),
      }),
    );
  }
  if (el.type === "line") {
    const stroke = num(s.stroke, 0.8, 0.05, 50);
    const vertical = num(el.h, 0) > num(el.w, 0);
    return wrap(
      `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center"><div style="${vertical ? `width:${stroke}mm;height:100%` : `height:${stroke}mm;width:100%`};background:${cssColor(s.color, "#c9a86a")}"></div></div>`,
    );
  }
  if (el.type === "divider") {
    const stroke = num(s.stroke, 0.5, 0.05, 50);
    return wrap(
      `<div style="width:100%;height:100%;display:flex;align-items:center;gap:6px"><span style="flex:1;height:${stroke}mm;background:${cssColor(s.color, "#c9a86a")}"></span><span style="width:4mm;height:4mm;border:0.45mm solid ${cssColor(s.color, "#c9a86a")};transform:rotate(45deg)"></span><span style="flex:1;height:${stroke}mm;background:${cssColor(s.color, "#c9a86a")}"></span></div>`,
    );
  }
  if (el.type === "image" || el.type === "logo" || el.type === "qr") {
    const safeSrc = safeImageSrc(el.src);
    return wrap(
      `<img alt="" src="${esc(safeSrc)}" style="width:100%;height:100%;object-fit:${cssKeyword(s.objectFit, OBJECT_FIT, "cover")};object-position:${num(s.objectX, 50, 0, 100)}% ${num(s.objectY, 50, 0, 100)}%;border-radius:${num(s.radius, 0, 0, 500)}mm"/>`,
    );
  }
  if (el.type === "icon") {
    return wrap(
      `<div style="width:100%;height:100%;color:${cssColor(s.color, "#c9a86a")};display:grid;place-items:center"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${num(s.stroke, 1.8, 0.1, 20)}" stroke-linecap="round" stroke-linejoin="round" style="width:100%;height:100%"><path d="M12 3 14.8 9l6.2.7-4.6 4.2 1.2 6.1L12 16.8 6.4 20l1.2-6.1L3 9.7 9.2 9 12 3Z"/></svg></div>`,
    );
  }
  if (el.type === "stamp") {
    return wrap(
      `<div style="width:100%;height:100%;border-radius:999px;border:0.7mm double ${cssColor(s.borderColor || s.color, "#c9a86a")};color:${cssColor(s.color, "#c9a86a")};display:grid;place-items:center;text-align:center;font-family:${cssFont(s.fontFamily || "Amiri")};font-weight:700;font-size:${num(text.fontSize, 12, 4, 400)}pt;transform:rotate(-12deg);overflow:hidden">${body("معتمد")}</div>`,
    );
  }
  if (el.type === "table") {
    const cols = num(s.cols, 3, 1, 60);
    const rows = num(s.rows, 4, 1, 400);
    const data = parseTable(el.content, cols, rows);
    const stripe = cssColor(s.stripeBg, "");
    const cells = data
      .map((row, ri) => {
        const tag = ri === 0 ? "th" : "td";
        return `<tr>${row
          .map((c) => {
            const cellText = applyNumerals(c, s.numerals);
            const rowBg =
              ri === 0
                ? `background:${cssColor(s.headerBg, "#006c35")};color:${cssColor(s.headerColor, "#fff")}`
                : `background:${ri % 2 === 0 && stripe ? stripe : cssColor(s.tableBg, "#fff")};color:${cssColor(s.color, "#172033")}`;
            return `<${tag} style="border:${num(s.borderWidth, 0.3, 0, 50)}mm solid ${cssColor(s.borderColor, "#bfc7d6")};padding:2mm;text-align:${cssKeyword(s.cellAlign, TEXT_ALIGN, "right")};${rowBg}">${esc(cellText)}</${tag}>`;
          })
          .join("")}</tr>`;
      })
      .join("");
    return wrap(
      `<table style="width:100%;height:100%;border-collapse:collapse;table-layout:fixed;font-family:${cssFont(s.fontFamily)};font-size:${num(text.fontSize, 11, 4, 400)}pt;direction:rtl">${cells}</table>`,
    );
  }
  return "";
}

export function buildStandaloneHtml(project: Project, pages: Page[]) {
  const body = pages
    .map((p, index) => {
      const size = pageSize(p);
      const pageRef = { number: index + 1, count: pages.length };
      return `<section class="page" style="width:${num(size.w, 210, 10, 1e4)}mm;height:${num(size.h, 297, 10, 1e4)}mm;background:${cssColor(p.bg, "#fff")}">${p.elements
        .slice()
        .sort((a, b) => num(a.z, 0) - num(b.z, 0))
        .map((el) => elHtml(el, pageRef))
        .join("")}</section>`;
    })
    .join("\n");

  const firstSize = pageSize(pages[0]);

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>${esc(project.name)}</title>
<meta name="generator" content="${esc(BRAND.lockup)} — ${esc(BRAND.platformEn)}"/>
<meta name="author" content="${esc(BRAND.developer)}"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Cairo:wght@400;600;700;800&family=IBM+Plex+Sans+Arabic:wght@400;600;700&family=Noto+Kufi+Arabic:wght@400;700&family=Noto+Naskh+Arabic:wght@400;700&family=Noto+Sans+Arabic:wght@400;700&family=Reem+Kufi:wght@400;700&family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet"/>
<style>
  @page { size: ${firstSize.w}mm ${firstSize.h}mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e8eaef; font-family: "Tajawal","Cairo",sans-serif; }
  .page { position: relative; overflow: hidden; background: #fff; margin: 12mm auto; box-shadow: 0 18px 50px rgba(15,23,42,.16); page-break-after: always; }
  .el { position: absolute; overflow: visible; }
  .text, .box { width: 100%; height: 100%; white-space: pre-wrap; word-break: break-word; }
  img { display: block; }
  @media print {
    body { background: #fff; }
    .page { margin: 0; box-shadow: none; page-break-after: always; }
  }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function exportJson(project: Project) {
  downloadText(
    JSON.stringify(project, null, 2),
    `${project.name || "report"}.json`,
    "application/json",
  );
}

export function exportHtmlFile(project: Project, pages: Page[]) {
  downloadText(
    buildStandaloneHtml(project, pages),
    `${project.name || "report"}.html`,
    "text/html",
  );
}

export function safeFileName(name: string) {
  return (name || "تقرير").replace(/[\\/:*?"<>|]+/g, "-").trim() || "تقرير";
}

/**
 * Run one export.
 *
 * `pages` is the rasterised capture and is only required for the pixel formats.
 * Word and PowerPoint are generated from the page model instead, so they stay
 * fully editable and do not need a hidden DOM render to be present.
 *
 * `editableOffice` lets the user fall back to the flattened, pixel-perfect
 * rendering when a viewer mangles an exotic font or shape.
 */
export async function runExport(
  format: ExportFormat,
  pages: CapturedPage[] | null,
  project: Project,
  selected: Page[],
  editableOffice = true,
) {
  const name = safeFileName(project.name);
  try {
    if (format === "json") {
      exportJson({ ...project, pages: project.pages, updatedAt: Date.now() });
      toast.success("تم تنزيل ملف المشروع");
      return;
    }
    if (format === "html") {
      exportHtmlFile(project, selected);
      toast.success("تم تنزيل ملف HTML المستقل");
      return;
    }

    // Office formats read the model, so they never need a raster capture.
    if (format === "pptx" || format === "docx") {
      if (!selected.length) {
        toast.error("لا توجد صفحات للتصدير");
        return;
      }
      if (editableOffice) {
        if (format === "pptx") await exportPptxEditable(selected, name);
        else await exportDocxEditable(selected, name);
        toast.success(
          format === "pptx"
            ? "تم تصدير عرض PowerPoint بنصوص وعناصر قابلة للتعديل"
            : "تم تصدير مستند Word بنصوص وجداول قابلة للتعديل",
        );
        return;
      }
    }
    if (!pages?.length) {
      toast.error("تعذر التقاط الصفحات — أعد المحاولة");
      return;
    }
    if (format === "pdf") await exportPdf(pages, name);
    else if (format === "png") await exportImages(pages, name, "png");
    else if (format === "jpg") await exportImages(pages, name, "jpg");
    else if (format === "pptx") await exportPptxRaster(pages, name);
    else if (format === "docx") await exportDocxRaster(pages, name);
    else throw new Error(`صيغة غير مدعومة: ${format}`);
    toast.success(
      OFFICE_FORMATS.has(format)
        ? "تم التصدير كصورة مطابقة للتصميم (بدون عناصر قابلة للتعديل)"
        : "تم التصدير بنجاح",
    );
  } catch (err) {
    console.error(err);
    toast.error("فشل التصدير. جرّب جودة أقل أو قلّل عدد الصور.");
    throw err;
  }
}
