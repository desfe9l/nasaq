import {
  snapshotPage,
  paintSnapshot,
  snapshotLayers,
  snapshotsHtml,
  type RenderSnapshot,
} from "./render-snapshot";
import { uploadedFontSources } from "../nsq/fonts";
import { assertUniformSlideSize } from "./render-units";
import { toast } from "sonner";
import { downloadBlob, downloadText } from "@/lib/utils";
import { mmToPx, pageSize, type Page, type Project } from "./model";
import { applySvgColors, safeSvgSrc, sanitizeSvgContent } from "./svg";

export type ExportFormat =
  "pdf" | "pptx" | "docx" | "png" | "jpg" | "html" | "svg" | "json" | "nsq";

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
async function cloneFontsInto(doc: Document) {
  if (!doc.fonts) return;
  await Promise.all(
    uploadedFontSources().map(async ({ family, dataUrl }) => {
      const face = new FontFace(family, `url(${JSON.stringify(dataUrl)})`);
      doc.fonts.add(await face.load());
    }),
  );
  await doc.fonts.ready;
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
  snapshot?: RenderSnapshot;
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
    onclone: async (doc) => {
      await cloneFontsInto(doc);
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
/**
 * Total decoded-pixel budget for ONE raster export job.
 *
 * `paintSnapshot` already refuses a single page above 64 MP, but nothing
 * bounded the JOB: every captured page is held until the file is written (a PDF
 * or a deck needs them all), so 30 A4 pages at 300 DPI is 30 × ~32 MP ≈ 950 MB
 * of RGBA alive at once. That is far past what mobile Safari will hand a tab —
 * the export died, or the tab was killed outright, on exactly the documents that
 * matter most, for a reason that had nothing to do with the document's content.
 *
 * Raising the per-page cap was never the fix; bounding the whole job is. 96 MP
 * (≈ 384 MB of RGBA) keeps a long report comfortably inside the mobile ceiling
 * while still allowing a single page to render at full 300 DPI.
 */
export const EXPORT_JOB_PIXEL_BUDGET = 96_000_000;

/**
 * The scale a whole job can actually afford.
 *
 * Pure, so the dialog can tell the author what it is doing instead of silently
 * shipping a softer file.
 */
export function jobExportScale(
  targets: { w: number; h: number }[],
  requested: number,
): number {
  // `mmToPx(mm, 1)` is the un-zoomed 96 DPI page the exporter always paints:
  // export resolution is independent of the editor's on-screen zoom.
  const base = targets.reduce(
    (sum, t) => sum + mmToPx(t.w, 1) * mmToPx(t.h, 1),
    0,
  );
  if (!(base > 0) || !(requested > 0)) return requested;
  return Math.min(requested, Math.sqrt(EXPORT_JOB_PIXEL_BUDGET / base));
}

export async function capturePages(
  targets: { node: HTMLElement; w: number; h: number }[],
  scale: number,
  onProgress?: (i: number, n: number) => void,
  delayMs = 30,
): Promise<CapturedPage[]> {
  // One scale for the whole job, chosen up front: degrading page 27 of 30 is
  // worse than rendering the document at one slightly softer, CONSISTENT
  // resolution — and it is the difference between a file and a crash.
  const jobScale = jobExportScale(targets, scale);
  const out: CapturedPage[] = [];
  for (let i = 0; i < targets.length; i++) {
    onProgress?.(i, targets.length);
    const target = targets[i];
    const snapshot = await snapshotPage(target);
    out.push({
      canvas: await paintSnapshot(snapshot, jobScale),
      snapshot,
      w: target.w,
      h: target.h,
    });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }
  return out;
}

/**
 * Drop the decoded bitmaps once the file is written.
 *
 * Canvas backing stores are freed by the garbage collector, not by dropping the
 * last JS reference, so a long export used to hold hundreds of megabytes until
 * the collector got round to it. Zeroing the dimensions releases them now.
 */
export function releaseCapturedPages(pages: CapturedPage[] | null) {
  if (!pages) return;
  for (const page of pages) {
    page.canvas.width = 0;
    page.canvas.height = 0;
  }
}

/** Resolve the same non-interactive artboards used by preview. No partial exports. */
export async function captureSnapshots(
  pages: Page[],
): Promise<RenderSnapshot[]> {
  const out: RenderSnapshot[] = [];
  for (const page of pages) {
    const node = document.querySelector<HTMLElement>(
      `[data-export-page="${CSS.escape(page.id)}"]`,
    );
    if (!node) throw new Error("تعذر العثور على صفحة التصدير");
    out.push(await snapshotPage({ node, ...pageSize(page) }));
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
export async function exportPptxEditable(
  pages: Page[],
  name: string,
  documentPages: Page[] = pages,
) {
  const { buildScene } = await import("./scene");
  const { writePptx } = await import("./pptx-writer");
  const blob = await writePptx(
    buildScene(await materializeSvgSources(pages), documentPages),
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
export async function exportDocxEditable(
  pages: Page[],
  name: string,
  documentPages: Page[] = pages,
) {
  const { buildScene } = await import("./scene");
  const { writeDocx } = await import("./docx-writer");
  const blob = await writeDocx({
    scenes: buildScene(await materializeSvgSources(pages), documentPages),
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

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality),
  );
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

/** The web document is serialized from the very same rendered artboards. */
export async function buildStandaloneHtml(project: Project, pages: Page[]) {
  return snapshotsHtml(await captureSnapshots(pages), project.name);
}

export function exportJson(project: Project) {
  downloadText(
    JSON.stringify(project, null, 2),
    `${project.name || "report"}.json`,
    "application/json",
  );
}

export async function exportHtmlFile(project: Project, pages: Page[]) {
  downloadText(
    await buildStandaloneHtml(project, pages),
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
 * Native Office mode reads the model. Fidelity Office and web formats read
 * the same hidden, non-interactive artboards as preview.
 *
 * Fidelity Office export is the default: independent browser-rendered layers.
 * `editableOffice` opts into native text/table objects with viewer-dependent layout.
 */
export async function runExport(
  format: ExportFormat,
  pages: CapturedPage[] | null,
  project: Project,
  selected: Page[],
  editableOffice = false,
  fidelityScale = 3,
) {
  const name = safeFileName(project.name);
  try {
    if (format === "nsq") {
      const { downloadCurrentNsq } = await import("@/lib/nsq/editor-io");
      await downloadCurrentNsq();
      return;
    }
    if (format === "json") {
      exportJson({ ...project, pages: project.pages, updatedAt: Date.now() });
      toast.success("تم تنزيل ملف المشروع");
      return;
    }
    if (format === "html") {
      await exportHtmlFile(project, selected);
      toast.success("تم تنزيل ملف HTML المستقل");
      return;
    }

    if (format === "svg") {
      const snapshots = await captureSnapshots(selected);
      if (snapshots.length === 1)
        downloadText(snapshots[0].svg, `${name}.svg`, "image/svg+xml");
      else {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        snapshots.forEach((p, i) => zip.file(`${name}-${i + 1}.svg`, p.svg));
        downloadBlob(
          await zip.generateAsync({ type: "blob" }),
          `${name}-svg.zip`,
        );
      }
      toast.success("تم تصدير SVG للويب مع الخطوط والصور المضمنة");
      return;
    }

    // Editable mode uses native Office objects; fidelity uses browser-shaped
    // transparent layers, never a single flattened page.

    if (format === "pptx" || format === "docx") {
      if (!selected.length) {
        toast.error("لا توجد صفحات للتصدير");
        return;
      }
      if (format === "pptx") assertUniformSlideSize(selected.map(pageSize));
      if (!editableOffice) {
        const snapshots =
          pages?.length === selected.length && pages.every((p) => p.snapshot)
            ? pages.map((p) => p.snapshot!)
            : await captureSnapshots(selected);
        const scenes = [];
        for (const snapshot of snapshots)
          scenes.push(await snapshotLayers(snapshot, fidelityScale));
        const blob =
          format === "pptx"
            ? await (await import("./pptx-writer")).writePptx(scenes, name)
            : await (
                await import("./docx-writer")
              ).writeDocx({ scenes, title: name });
        downloadBlob(blob, `${name}.${format}`);
        toast.success(
          "تم التصدير بطبقات مستقلة مطابقة للتصميم؛ النصوص محفوظة بصريًا",
        );
        return;
      }
      if (editableOffice) {
        if (format === "pptx")
          await exportPptxEditable(selected, name, project.pages);
        else await exportDocxEditable(selected, name, project.pages);
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
    else throw new Error(`صيغة غير مدعومة: ${format}`);
    toast.success("تم التصدير بنجاح");
  } catch (err) {
    console.error(err);
    toast.error("فشل التصدير. جرّب جودة أقل أو قلّل عدد الصور.");
    throw err;
  }
}
