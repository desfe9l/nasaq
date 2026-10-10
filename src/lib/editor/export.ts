import {
  snapshotPage,
  paintSnapshot,
  snapshotLayers,
  snapshotLayer,
  snapshotsHtml,
  type RenderSnapshot,
} from "./render-snapshot";
import { uploadedFontSources } from "../nsq/fonts";
import { assertUniformSlideSize, pxToMm as flatPxToMm } from "./render-units";
import { toast } from "sonner";
import { downloadBlob, downloadText } from "@/lib/utils";
import {
  findElement,
  mmToPx,
  pageSize,
  type Page,
  type Project,
  type CanvasEl,
} from "./model";
import { officeSvgMarkup } from "./svg";
import { isOfficeEmbeddableRaster, rasterSourceToPng } from "./images";
import { normalizeBlurMm } from "./blur";
import { projectAccessBlock } from "./access-limits";
import { editorAccessResolved, useEditor } from "./store";
import {
  canUseDemoExport,
  effectiveExportScale,
} from "@/lib/product/product";
import { incrementFreeExportUsage, canUseFreeExport, getFreeExportUsage } from "@/lib/license/server";

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
      ".handle, .rotate-handle, .selection-layer, .overflow-badge, .guide-v, .guide-h, .marquee, .page-trim",
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
  pageId: string,
  elId: string,
  exportScale: number,
): Promise<{ src: string; w: number; h: number } | null> {
  /*
   * Preferred path: render ONLY the element's own layer from the hidden
   * export surface and trim it to the artwork's box. The saved library asset
   * is then exactly the element's size — authors kept getting page-sized
   * crops around a small shape because a live-node raster carries whatever
   * surrounded it.
   */
  const model = useEditor.getState().pages.find((p) => p.id === pageId);
  const exportNode = document.querySelector<HTMLElement>(
    `[data-export-page="${CSS.escape(pageId)}"]`,
  );
  if (model && exportNode) {
    const snapshot = await snapshotPage({ node: exportNode, ...pageSize(model) });
    const layer = await snapshotLayer(snapshot, elId, exportScale, "عنصر");
    if (layer) return { src: layer.src, w: layer.w, h: layer.h };
  }
  const page = document.querySelector<HTMLElement>(
    `.editor-canvas-stage [data-page-id="${CSS.escape(pageId)}"]`,
  );
  const node = page?.querySelector<HTMLElement>(
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
  const src = canvas.toDataURL("image/png");
  // Fallback raster is the element's own node box, so its model size is the
  // honest dimension to store beside it.
  const el = model
    ? findElement(model.elements, elId)?.el
    : undefined;
  return {
    src,
    w: el?.w ?? flatPxToMm(node.offsetWidth),
    h: el?.h ?? flatPxToMm(node.offsetHeight),
  };
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
  if (notifyExportFormatBlock("pdf")) return;
  const { jsPDF } = await import("jspdf");
  if (notifyExportFormatBlock("pdf")) return;
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
  project?: Project,
) {
  if (
    project
      ? notifyProjectAccessBlock(project, "pptx")
      : notifyExportFormatBlock("pptx")
  )
    return;
  const { buildScene } = await import("./scene");
  const { writePptx } = await import("./pptx-writer");
  const blob = await writePptx(
    buildScene(await materializeSceneSources(pages), documentPages),
    name,
  );
  if (
    project
      ? notifyProjectAccessBlock(project, "pptx")
      : notifyExportFormatBlock("pptx")
  )
    return;
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
  project?: Project,
) {
  if (
    project
      ? notifyProjectAccessBlock(project, "docx")
      : notifyExportFormatBlock("docx")
  )
    return;
  const { buildScene } = await import("./scene");
  const { writeDocx } = await import("./docx-writer");
  const blob = await writeDocx({
    scenes: buildScene(await materializeSceneSources(pages), documentPages),
    title: name,
  });
  if (
    project
      ? notifyProjectAccessBlock(project, "docx")
      : notifyExportFormatBlock("docx")
  )
    return;
  downloadBlob(blob, `${name}.docx`);
}

/** Native Office keeps normal objects editable. Only unsupported gradient,
 * crop or layer-blur paint (including groups that contain it) uses the
 * existing browser renderer — dropping a blur would change the artwork, so it
 * is rasterised instead of being rewritten into a crisp object. */
export async function materializeSceneSources(pages: Page[]): Promise<Page[]> {
  const needsPaint = (el: CanvasEl): boolean =>
    !!el.style.gradient ||
    !!el.style.crop ||
    normalizeBlurMm(el.style.blur) > 0 ||
    !!el.children?.some(needsPaint);
  const { svgToPngDataUrl } = await import("./svg");
  const scale = jobExportScale(pages.map(pageSize), 2);
  const output: Page[] = [];
  for (const page of pages) {
    const painted = page.elements.filter(needsPaint);
    let snapshot: RenderSnapshot | undefined;
    if (page.bgGradient || painted.length) {
      const node = document.querySelector<HTMLElement>(
        `[data-export-page="${CSS.escape(page.id)}"]`,
      );
      if (!node) throw new Error("تعذر العثور على صفحة التصدير");
      snapshot = await snapshotPage({ node, ...pageSize(page) });
    }
    const imageLayer = async (el?: CanvasEl): Promise<CanvasEl | null> => {
      const image = await snapshotLayer(snapshot!, el?.id, scale, el?.name);
      if (!image) return null;
      return {
        id: el?.id || `background-${page.id}`,
        type: "image",
        name: el?.name || "خلفية الصفحة",
        x: image.x,
        y: image.y,
        w: image.w,
        h: image.h,
        rotation: 0,
        opacity: 1,
        z:
          el?.z ?? Math.min(0, ...page.elements.map((item) => item.z || 0)) - 1,
        content: "",
        src: image.src,
        locked: true,
        style: { objectFit: "fill", radius: 0 },
      };
    };
    const visit = async (el: CanvasEl): Promise<CanvasEl> => {
      if (needsPaint(el))
        return (await imageLayer(el)) || { ...el, opacity: 0 };
      if (el.children?.length)
        return { ...el, children: await Promise.all(el.children.map(visit)) };
      // The Office writers embed raster bytes only; an SVG-sourced picture (the
      // AI design generator's artwork, an uploaded `.svg`, a library asset) or
      // a native `svg` element is drawn to PNG here so it is never silently
      // missing from the export. See `officeSvgMarkup`.
      const markup = officeSvgMarkup(el);
      if (!markup) {
        // An image the Office writers cannot embed verbatim — a `webp` data
        // URL, a remote `https://` URL, a legacy `blob:` source — is drawn to
        // PNG here too. The writers accept raster bytes only, and their regex
        // matches png/jpeg/gif/bmp, so anything else used to be dropped from
        // the .docx/.pptx entirely. Rasterising at the export boundary keeps
        // the original source in the project and only rewrites the Office copy.
        if (el.type === "image" && !isOfficeEmbeddableRaster(el.src)) {
          const png = await rasterSourceToPng(el.src);
          return png ? { ...el, src: png } : el;
        }
        return el;
      }
      const png = await svgToPngDataUrl(markup, el.w, el.h, 2);
      return png ? { ...el, src: png } : el;
    };
    // One full-page bitmap at a time, including on memory-limited iPads.
    const elements: CanvasEl[] = [];
    for (const element of page.elements) elements.push(await visit(element));
    if (page.bgGradient) {
      const background = await imageLayer();
      if (background) elements.unshift(background);
    }
    output.push({
      ...page,
      bg: page.bgGradient ? "transparent" : page.bg,
      elements,
    });
  }
  return output;
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

function clampCapturedPagesToScale(
  pages: CapturedPage[],
  maxScale: number,
): CapturedPage[] {
  return pages.map((page) => {
    const maxWidth = Math.max(1, Math.floor(mmToPx(page.w, 1) * maxScale));
    const maxHeight = Math.max(1, Math.floor(mmToPx(page.h, 1) * maxScale));
    if (page.canvas.width <= maxWidth && page.canvas.height <= maxHeight)
      return page;
    const ratio = Math.min(
      maxWidth / page.canvas.width,
      maxHeight / page.canvas.height,
      1,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(page.canvas.width * ratio));
    canvas.height = Math.max(1, Math.floor(page.canvas.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return page;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(page.canvas, 0, 0, canvas.width, canvas.height);
    return { ...page, canvas, snapshot: undefined };
  });
}

export async function exportImages(
  pages: CapturedPage[],
  name: string,
  type: "png" | "jpg",
) {
  if (notifyExportFormatBlock(type)) return;
  const advanced = useEditor.getState().entitlements.advanced_export === true;
  const outputPages = advanced
    ? pages
    : clampCapturedPagesToScale(
        pages,
        effectiveExportScale(1, false),
      );
  const sourceCanvases = new Set(pages.map((page) => page.canvas));
  const mime = type === "png" ? "image/png" : "image/jpeg";
  const ext = type === "png" ? "png" : "jpg";
  try {
    if (outputPages.length === 1) {
      const blob = await canvasToBlob(
        outputPages[0].canvas,
        mime,
        type === "jpg" ? 0.95 : undefined,
      );
      if (blob && !notifyExportFormatBlock(type))
        downloadBlob(blob, `${name}.${ext}`);
      return;
    }
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    for (let i = 0; i < outputPages.length; i++) {
      const blob = await canvasToBlob(
        outputPages[i].canvas,
        mime,
        type === "jpg" ? 0.95 : undefined,
      );
      if (blob)
        zip.file(`${name}-p${String(i + 1).padStart(2, "0")}.${ext}`, blob);
    }
    const out = await zip.generateAsync({ type: "blob" });
    if (!notifyExportFormatBlock(type))
      downloadBlob(out, `${name}-pages.zip`);
  } finally {
    for (const page of outputPages) {
      if (!sourceCanvases.has(page.canvas)) {
        page.canvas.width = 0;
        page.canvas.height = 0;
      }
    }
  }
}

/** The web document is serialized from the very same rendered artboards. */
export async function buildStandaloneHtml(project: Project, pages: Page[]) {
  if (notifyProjectAccessBlock(project, "html"))
    throw new Error("لا يمكن تصدير هذا المستند قبل اكتمال التحقق من الصلاحيات");
  const snapshots = await captureSnapshots(pages);
  if (notifyProjectAccessBlock(project, "html"))
    throw new Error("تغيّرت صلاحيات التصدير أثناء تجهيز الملف");
  return snapshotsHtml(snapshots, project.name);
}

function notifyExportFormatBlock(format: ExportFormat): boolean {
  if (!editorAccessResolved()) {
    toast.error("انتظر اكتمال التحقق من الحساب والترخيص قبل التصدير");
    return true;
  }
  const advanced = useEditor.getState().entitlements.advanced_export === true;
  const basic = useEditor.getState().entitlements.basic_export === true;
  if (canUseDemoExport(format, advanced, basic)) return false;
  toast.error(
    basic
      ? "هذه الصيغة متاحة ضمن الترخيص المتقدم فقط"
      : "لا يمكن حفظ أي صيغة قبل شراء الترخيص",
  );
  return true;
}

function notifyProjectAccessBlock(
  project: Project,
  format?: ExportFormat,
): boolean {
  if (format && notifyExportFormatBlock(format)) return true;
  if (!editorAccessResolved()) {
    toast.error("انتظر اكتمال التحقق من الحساب والترخيص قبل التصدير");
    return true;
  }
  const block = projectAccessBlock(project, useEditor.getState().entitlements);
  if (!block) return false;
  toast.error(
    block === "premium-template"
      ? "يتطلب تصدير هذا المستند ترخيصًا مناسبًا"
      : "يتجاوز هذا المستند حد الصفحات في خطتك الحالية",
  );
  return true;
}

export function exportJson(project: Project): boolean {
  if (notifyProjectAccessBlock(project, "json")) return false;
  downloadText(
    JSON.stringify(project, null, 2),
    `${project.name || "report"}.json`,
    "application/json",
  );
  return true;
}

export async function exportHtmlFile(
  project: Project,
  pages: Page[],
): Promise<boolean> {
  if (notifyProjectAccessBlock(project, "html")) return false;
  const html = await buildStandaloneHtml(project, pages);
  if (notifyProjectAccessBlock(project, "html")) return false;
  downloadText(
    html,
    `${project.name || "report"}.html`,
    "text/html",
  );
  return true;
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
  if (notifyProjectAccessBlock(project, format)) return;
  const name = safeFileName(project.name);
  try {
    if (format === "nsq") {
      const { downloadCurrentNsq } = await import("@/lib/nsq/editor-io");
      await downloadCurrentNsq();
      return;
    }
    if (format === "json") {
      if (
        exportJson({ ...project, pages: project.pages, updatedAt: Date.now() })
      )
        toast.success("تم تنزيل ملف المشروع");
      return;
    }
    if (format === "html") {
      if (await exportHtmlFile(project, selected))
        toast.success("تم تنزيل ملف HTML المستقل");
      return;
    }

    if (format === "svg") {
      const snapshots = await captureSnapshots(selected);
      if (notifyProjectAccessBlock(project, format)) return;
      if (snapshots.length === 1)
        downloadText(snapshots[0].svg, `${name}.svg`, "image/svg+xml");
      else {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        snapshots.forEach((p, i) => zip.file(`${name}-${i + 1}.svg`, p.svg));
        const archive = await zip.generateAsync({ type: "blob" });
        if (notifyProjectAccessBlock(project, format)) return;
        downloadBlob(archive, `${name}-svg.zip`);
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
        if (notifyProjectAccessBlock(project, format)) return;
        const blob =
          format === "pptx"
            ? await (await import("./pptx-writer")).writePptx(scenes, name)
            : await (
                await import("./docx-writer")
              ).writeDocx({ scenes, title: name });
        if (notifyProjectAccessBlock(project, format)) return;
        downloadBlob(blob, `${name}.${format}`);
        toast.success(
          "تم التصدير بطبقات مستقلة مطابقة للتصميم؛ النصوص محفوظة بصريًا",
        );
        return;
      }
      if (editableOffice) {
        if (format === "pptx")
          await exportPptxEditable(selected, name, project.pages, project);
        else await exportDocxEditable(selected, name, project.pages, project);
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
    // Check free export allowance for PNG, JPG, and PDF
    if (format === "png" || format === "jpg" || format === "pdf") {
      const canExport = await canUseFreeExportFn();
      if (!canExport.canUse) {
        const usage = await getFreeExportUsageFn();
        toast.error(
          `لقد استهلكت جميع التصديرات المجانية الثلاث. لقد استخدمت ${usage.totalUsed}/3 تصديرات مجانية. قم بالترقية لتصدير المزيد.`
        );
        return;
      }
      // After successful export, we'll increment the usage
      if (format === "pdf") await exportPdf(pages, name);
      else if (format === "png") await exportImages(pages, name, "png");
      else if (format === "jpg") await exportImages(pages, name, "jpg");
      else throw new Error(`صيغة غير مدعومة: ${format}`);
      
      // Increment the usage counter after successful export
      await incrementFreeExportUsageFn({ format });
      toast.success("تم التصدير بنجاح");
      return;
    }
     // Handle remaining formats (PPTX, DOCX, HTML, SVG, JSON, NSQ)     if (format === "pptx" || format === "docx") {       if (!selected.length) {         toast.error("لا توجد صفحات للتصدير");         return;       }       if (format === "pptx") assertUniformSlideSize(selected.map(pageSize));       if (!editableOffice) {         const snapshots =           pages?.length === selected.length && pages.every((p) => p.snapshot)             ? pages.map((p) => p.snapshot!)             : await captureSnapshots(selected);         const scenes = [];         for (const snapshot of snapshots) {           scenes.push(await snapshotLayers(snapshot, fidelityScale));         }         if (notifyProjectAccessBlock(project, format)) return;         const blob =           format === "pptx"             ? await (await import("./pptx-writer")).writePptx(scenes, name)             : await (                 await import("./docx-writer")               ).writeDocx({ scenes, title: name });         if (notifyProjectAccessBlock(project, format)) return;         downloadBlob(blob, `${name}.${format}`);         toast.success(           "تم التصدير بطبقات مستقلة مطابقة للتصميم؛ النصوص محفوظة بصريًا",         );         return;       }       if (editableOffice) {         if (format === "pptx")           await exportPptxEditable(selected, name, project.pages, project);         else await exportDocxEditable(selected, name, project.pages, project);         toast.success(           format === "pptx"             ? "تم تصدير عرض PowerPoint بنصوص وعناصر قابلة للتعديل"             : "تم تصدير مستند Word بنصوص وجداول قابلة للتعديل"         );         return;       }     } else if (format === "svg") {       if (!selected.length) {         toast.error("لا توجد صفحات للتصدير");         return;       }       const archive = new JSZip();       selected.forEach((page, i) => {         if (page.svg) {           archive.file(`${name}-${i + 1}.svg`, page.svg);         }       });       const archiveBlob = await archive.generateAsync({ type: "blob" });       if (notifyProjectAccessBlock(project, format)) return;       downloadBlob(archiveBlob, `${name}-svg.zip`);       toast.success("تم تصدير SVG للويب مع الخطوط والصور المضمنة");       return;     } else if (format === "html") {       if (!pages?.length) {         toast.error("تعذر التقاط الصفحات — أعد المحاولة");         return;       }       const html = await snapshotsHtml(selected);       if (notifyProjectAccessBlock(project, format)) return;       downloadBlob(html, `${name}.html`);       toast.success("تم تصدير المستند كصفحة ويب");       return;     } else if (format === "json") {       if (!pages?.length) {         toast.error("تعذر التقاط الصفحات — أعد المحاولة");         return;       }       const json = await exportJson(pages, name);       if (notifyProjectAccessBlock(project, format)) return;       downloadBlob(json, `${name}.json`);       toast.success("تم تصدير المستند كملف JSON");       return;     } else if (format === "nsq") {       if (!pages?.length) {         toast.error("تعذر التقاط الصفحات — أعد المحاولة");         return;       }       await exportNsq(pages, name);       if (notifyProjectAccessBlock(project, format)) return;       toast.success("تم تصدير المشروع كمشروع نَسَق");       return;     } else {       throw new Error(`صيغة غير مدعومة: ${format}`);     }
  } catch (err) {
    console.error(err);
    toast.error("فشل التصدير. جرّب جودة أقل أو قلّل عدد الصور.");
    throw err;
  }
}
