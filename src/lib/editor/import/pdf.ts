/**
 * PDF → editable NASAQ pages, where the file actually contains text or images.
 *
 * PDF has no layer tree. Extracted text becomes text elements and decoded
 * images become image elements. A scanned page with neither is kept at its
 * real size and reported — it is not replaced by a pretended reconstruction.
 */

import type { OPS as OpsNs } from "pdfjs-dist";
import { type Box, ImportBuilder, dataUrlFrom, ptToMm, round2 } from "./shared";
import { encodeRgbaPng } from "./png-encode";

interface PdfText {
  str: string;
  width: number;
  height: number;
  transform: number[];
  hasEOL?: boolean;
  dir?: string;
}

interface PdfImage {
  width: number;
  height: number;
  data?: Uint8Array | Uint8ClampedArray;
}

interface PdfPage {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  getTextContent: () => Promise<{ items: unknown[] }>;
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs: { get: (id: string, callback: (value: PdfImage) => void) => void };
}

interface PdfDoc {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => Promise<void> | void;
}

interface PdfjsApi {
  getDocument: (src: Record<string, unknown>) => { promise: Promise<PdfDoc> };
  GlobalWorkerOptions: { workerSrc: string };
  OPS: typeof OpsNs;
  VerbosityLevel: { ERRORS: number };
}

const paintCodes = { save: 10, restore: 11, transform: 12 };

function isText(item: unknown): item is PdfText {
  if (!item || typeof item !== "object") return false;
  const row = item as Partial<PdfText>;
  return typeof row.str === "string" && Array.isArray(row.transform);
}

async function loadPdfjs(): Promise<PdfjsApi> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsApi;
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    if (typeof window === "undefined") {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "../../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
        import.meta.url,
      ).href;
    } else {
      const mod = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")) as { default: string };
      pdfjs.GlobalWorkerOptions.workerSrc = mod.default;
    }
  }
  return pdfjs;
}

function mul(m: number[], n: number[]): number[] {
  const [a, b, c, d, e, f] = m;
  const [A, B, C, D, E, F] = n;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}

function imagesFromOps(ops: { fnArray: number[]; argsArray: unknown[][] }, paint: number, pageH: number): { box: Box; name: string }[] {
  const stack: number[][] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const found: { box: Box; name: string }[] = [];
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    const raw = ops.argsArray[i];
    const args = Array.isArray(raw) ? raw : [];
    if (fn === paintCodes.save) stack.push(ctm.slice());
    else if (fn === paintCodes.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === paintCodes.transform) {
      const row = Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
      if (row.length >= 6) ctm = mul(ctm, row.slice(0, 6).map((n) => Number(n)));
    } else if (fn === paint && typeof args[0] === "string") {
      const [a, , , d, e, f] = ctm;
      const w = Math.abs(a);
      const h = Math.abs(d);
      if (w < 1 || h < 1) continue;
      const bottom = d >= 0 ? f : f + d;
      found.push({
        name: args[0],
        box: {
          x: round2(ptToMm(e)),
          y: round2(ptToMm(pageH - (bottom + h))),
          w: round2(ptToMm(w)),
          h: round2(ptToMm(h)),
        },
      });
    }
  }
  return found;
}

async function imageSrc(image: PdfImage): Promise<string | null> {
  const w = image.width || 0;
  const h = image.height || 0;
  const data = image.data;
  if (!w || !h || !data || w * h > 6_000_000) return null;
  let rgba: Uint8Array;
  if (data.length === w * h * 4) rgba = data instanceof Uint8Array ? data : new Uint8Array(data);
  else if (data.length === w * h * 3) {
    rgba = new Uint8Array(w * h * 4);
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      rgba[j] = data[i];
      rgba[j + 1] = data[i + 1];
      rgba[j + 2] = data[i + 2];
      rgba[j + 3] = 255;
    }
  } else return null;
  const png = await encodeRgbaPng(w, h, rgba);
  return dataUrlFrom("image/png", png);
}

export async function importPdfBytes(bytes: Uint8Array, fileName: string, ids?: () => string): Promise<ReturnType<ImportBuilder["finish"]>> {
  const pdfjs = await loadPdfjs();
  let doc: PdfDoc;
  try {
    doc = await pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      verbosity: pdfjs.VerbosityLevel?.ERRORS ?? 0,
    }).promise;
  } catch {
    throw new Error("تعذر قراءة ملف PDF. قد يكون تالفًا أو محميًا بكلمة مرور.");
  }
  const builder = new ImportBuilder("pdf", fileName, ids);
  builder.note(
    "PDF",
    "partial",
    "PDF بلا طبقات. النص والصور المستخرجة عناصر قابلة للتحرير. الرسومات المتجهة غير النصية لا تُعاد بناؤها كلقطة مزيفة.",
  );
  let colorNoted = false;
  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const view = page.getViewport({ scale: 1 });
      const pageH = view.height;
      const sheet = builder.addPage(`صفحة ${n}`, ptToMm(view.width), ptToMm(pageH));
      const content = await page.getTextContent();
      const items = content.items.filter(isText).filter((item) => item.str.trim() || item.hasEOL);
      let line: PdfText[] = [];
      const flush = () => {
        if (!line.length) return;
        const text = line.map((item) => item.str).join("");
        const first = line[0];
        const last = line[line.length - 1];
        const size = Math.max(first.height || 0, Math.hypot(first.transform[0] || 0, first.transform[1] || 0)) || 12;
        const x = Math.min(...line.map((item) => item.transform[4] || 0));
        const baseline = first.transform[5] || 0;
        const width = Math.max(size, (last.transform[4] || 0) + (last.width || 0) - x);
        const dir = first.dir === "rtl" ? "rtl" : first.dir === "ltr" ? "ltr" : undefined;
        builder.text(
          sheet,
          {
            x: ptToMm(x),
            y: ptToMm(pageH - baseline - size * 0.92),
            w: ptToMm(width + size * 0.2),
            h: ptToMm(size * 1.35),
          },
          text,
          { fontSize: round2(size), direction: dir, fontFamily: "Tajawal" },
          "نص",
        );
        line = [];
      };
      for (const item of items) {
        if (line.length) {
          const gap = (item.transform[4] || 0) - ((line[line.length - 1].transform[4] || 0) + (line[line.length - 1].width || 0));
          const same = Math.abs((item.transform[5] || 0) - (line[0].transform[5] || 0)) < 2.5;
          if (!same || gap > Math.max(8, (item.height || 12) * 1.4)) flush();
          else if (gap > (item.height || 12) * 0.25 && !item.str.startsWith(" ")) item.str = ` ${item.str}`;
        }
        line.push(item);
        if (item.hasEOL) flush();
      }
      flush();
      if (!colorNoted && builder.texts) {
        colorNoted = true;
        builder.note("لون النص", "partial", "ملفات PDF لا تحتفظ دائمًا بلون الخط كنص قابل للتحرير؛ استُخدم لون النص الافتراضي عند غيابه.");
      }
      try {
        const ops = await page.getOperatorList();
        const paint = pdfjs.OPS.paintImageXObject;
        const placed = imagesFromOps(ops, paint, pageH);
        let missed = 0;
        for (const row of placed) {
          const image = await new Promise<PdfImage>((resolve) => page.objs.get(row.name, resolve));
          const src = await imageSrc(image);
          if (!src) {
            missed += 1;
            continue;
          }
          builder.image(sheet, row.box, src, "صورة PDF", "موضع الصورة مأخوذ من مصفوفة الرسم وقد يختلف قليلًا عن الأصل.");
        }
        if (missed) {
          builder.note(`صفحة ${n}`, "partial", `${missed} صورة داخل PDF لم تُفك كعنصر مستقل. النص المستخرج بقي كما هو.`);
        }
      } catch {
        builder.note(`صفحة ${n}`, "partial", "تعذر قراءة عمليات الرسم. النص المستخرج بقي قابلًا للتحرير.");
      }
      if (!sheet.elements.length) {
        builder.note(`صفحة ${n}`, "skipped", "لا نص ولا صورة قابلة للاستخراج في هذه الصفحة. أُبقي مقاسها ولم تُصنع لقطة مزيفة.");
      }
    }
  } finally {
    await doc.destroy();
  }
  if (!builder.pages.length) throw new Error("ملف PDF لا يحتوي صفحات.");
  return builder.finish();
}
