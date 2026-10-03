/**
 * DOCX → editable NASAQ pages.
 *
 * Word is a flow document, not a layer tree. Paragraphs, headings, simple
 * tables and embedded images become real elements on a page of the file's
 * size and margins. Mixed run formatting is kept as the dominant run and
 * listed as partial. There is no claim of pixel-perfect Word compatibility.
 */

import type JSZip from "jszip";
import {
  type Box,
  ImportBuilder,
  decodeXml,
  emuToMm,
  round2,
  twipToMm,
  xmlAttr,
} from "./shared";
import {
  bodyBlocks,
  embeddedImage,
  readRels,
  readZip,
  resolveTarget,
  stripAlternateFallback,
  zipText,
} from "./ooxml";

interface StyleDef {
  size?: number;
  bold?: boolean;
  font?: string;
  color?: string;
  heading?: boolean;
}

interface Drawing {
  src: string | null;
  w: number;
  h: number;
  x?: number;
  y?: number;
  text: string;
  unsupported?: string;
}

interface Paragraph {
  text: string;
  size: number;
  bold: boolean;
  italic: boolean;
  color?: string;
  font?: string;
  align?: "left" | "center" | "right" | "justify";
  direction?: "rtl" | "ltr";
  beforeMm: number;
  afterMm: number;
  heading: boolean;
  mixed: boolean;
  pageBreak: boolean;
  drawings: Drawing[];
}

function num(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function readStyles(xml: string | undefined): Map<string, StyleDef> {
  const map = new Map<string, StyleDef>();
  if (!xml) return map;
  for (const match of xml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = xmlAttr(match[1], "w:styleId");
    if (!id) continue;
    const body = match[2];
    const name = xmlAttr(/<w:name\b[^>]*\/?>/.exec(body)?.[0] || "", "w:val") || id;
    const rPr = /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(body)?.[1] || "";
    const heading = /heading|title|عنوان/i.test(`${name} ${id}`);
    map.set(id, {
      size: halfPoints(rPr),
      bold: /<w:b\b/.test(rPr) || heading,
      font: fontOf(rPr),
      color: colorOf(rPr),
      heading,
    });
  }
  return map;
}

function halfPoints(rPr: string): number | undefined {
  const raw = xmlAttr(/<w:szCs\b[^>]*\/?>/.exec(rPr)?.[0] || /<w:sz\b[^>]*\/?>/.exec(rPr)?.[0] || "", "w:val");
  const n = num(raw);
  return n > 0 ? n / 2 : undefined;
}

function fontOf(rPr: string): string | undefined {
  const tag = /<w:rFonts\b[^>]*\/?>/.exec(rPr)?.[0] || "";
  return xmlAttr(tag, "w:cs") || xmlAttr(tag, "w:ascii") || xmlAttr(tag, "w:hAnsi") || undefined;
}

function colorOf(rPr: string): string | undefined {
  const raw = xmlAttr(/<w:color\b[^>]*\/?>/.exec(rPr)?.[0] || "", "w:val");
  if (!raw || raw === "auto" || !/^[0-9a-fA-F]{6}$/.test(raw)) return undefined;
  return `#${raw}`;
}

function textsOf(xml: string): string {
  const parts: string[] = [];
  const stripped = xml.replace(/<w:drawing\b[\s\S]*?<\/w:drawing>/g, "").replace(/<w:pict\b[\s\S]*?<\/w:pict>/g, "");
  const re = /<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  for (const match of stripped.matchAll(re)) {
    if (match[0].startsWith("<w:tab")) parts.push(" ");
    else if (match[0].startsWith("<w:br") || match[0].startsWith("<w:cr")) parts.push("\n");
    else parts.push(decodeXml(match[1] || ""));
  }
  return parts.join("").replace(/\n{3,}/g, "\n\n");
}

async function drawingsOf(xml: string, zip: JSZip, rels: Map<string, string>, base: string): Promise<Drawing[]> {
  const out: Drawing[] = [];
  for (const match of xml.matchAll(/<w:drawing\b[\s\S]*?<\/w:drawing>|<w:pict\b[\s\S]*?<\/w:pict>/g)) {
    const chunk = match[0];
    const embed = /r:embed="([^"]+)"/.exec(chunk)?.[1] || /r:id="([^"]+)"/.exec(chunk)?.[1];
    const target = embed ? rels.get(embed) : undefined;
    const path = target ? resolveTarget(base, target) : "";
    const src = path ? await embeddedImage(zip, path) : null;
    const cx = num(/<wp:extent\b[^>]*\bcx="(\d+)"/.exec(chunk)?.[1] || /<a:ext\b[^>]*\bcx="(\d+)"/.exec(chunk)?.[1]);
    const cy = num(/<wp:extent\b[^>]*\bcy="(\d+)"/.exec(chunk)?.[1] || /<a:ext\b[^>]*\bcy="(\d+)"/.exec(chunk)?.[1]);
    const posH = /<wp:positionH\b[^>]*>([\s\S]*?)<\/wp:positionH>/.exec(chunk)?.[1] || "";
    const posV = /<wp:positionV\b[^>]*>([\s\S]*?)<\/wp:positionV>/.exec(chunk)?.[1] || "";
    const pageH = /relativeFrom="page"|relativeFrom="margin"/.test(/<wp:positionH\b[^>]*>/.exec(chunk)?.[0] || "");
    const pageV = /relativeFrom="page"|relativeFrom="margin"/.test(/<wp:positionV\b[^>]*>/.exec(chunk)?.[0] || "");
    const text = textsOf(/<w:txbxContent\b[^>]*>([\s\S]*?)<\/w:txbxContent>/.exec(chunk)?.[0] || "");
    const unsupported = !src && !text.trim() ? "صورة أو رسم لا يملك صيغة يعرضها المتصفح (مثل EMF)." : undefined;
    out.push({
      src,
      w: cx ? emuToMm(cx) : 40,
      h: cy ? emuToMm(cy) : 30,
      x: pageH ? emuToMm(num(/<wp:posOffset>(\d+)<\/wp:posOffset>/.exec(posH)?.[1])) : undefined,
      y: pageV ? emuToMm(num(/<wp:posOffset>(\d+)<\/wp:posOffset>/.exec(posV)?.[1])) : undefined,
      text,
      unsupported,
    });
  }
  return out;
}

function readParagraph(xml: string, styles: Map<string, StyleDef>, drawings: Drawing[]): Paragraph {
  const pPr = /<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/.exec(xml)?.[1] || "";
  const styleId = xmlAttr(/<w:pStyle\b[^>]*\/?>/.exec(pPr)?.[0] || "", "w:val");
  const style = styleId ? styles.get(styleId) : undefined;
  const runs = [...xml.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)].map((m) => m[1]);
  const rPrs = runs.map((run) => /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1] || "");
  const sizes = rPrs.map(halfPoints).filter((n): n is number => !!n);
  const colors = rPrs.map(colorOf).filter((c): c is string => !!c);
  const fonts = rPrs.map(fontOf).filter((f): f is string => !!f);
  const explicitRtl = /<w:bidi\b/.test(pPr) || /<w:rtl\b/.test(pPr) || rPrs.some((r) => /<w:rtl\b/.test(r));
  const explicitLtr = /<w:bidi\b[^>]*w:val="0"/.test(pPr);
  const jc = xmlAttr(/<w:jc\b[^>]*\/?>/.exec(pPr)?.[0] || "", "w:val");
  const align = jc === "center" ? "center" : jc === "left" || jc === "start" ? "left" : jc === "both" ? "justify" : jc === "right" || jc === "end" ? "right" : undefined;
  const before = twipToMm(num(xmlAttr(/<w:spacing\b[^>]*\/?>/.exec(pPr)?.[0] || "", "w:before")));
  const after = twipToMm(num(xmlAttr(/<w:spacing\b[^>]*\/?>/.exec(pPr)?.[0] || "", "w:after")));
  const size = sizes[0] || style?.size || (style?.heading ? 20 : 12);
  const mixed = new Set(sizes.map((n) => Math.round(n))).size > 1 || new Set(colors).size > 1;
  return {
    text: textsOf(xml),
    size,
    bold: rPrs.some((r) => /<w:b\b/.test(r) && !/w:val="0"/.test(/<w:b\b[^>]*\/?>/.exec(r)?.[0] || "")) || !!style?.bold,
    italic: rPrs.some((r) => /<w:i\b/.test(r)),
    color: colors[0] || style?.color,
    font: fonts[0] || style?.font,
    align,
    direction: explicitRtl && !explicitLtr ? "rtl" : explicitLtr ? "ltr" : undefined,
    beforeMm: before,
    afterMm: after,
    heading: !!style?.heading || /^Heading|^Title/i.test(styleId || ""),
    mixed,
    pageBreak: /<w:br\b[^>]*w:type="page"/.test(xml) || /<w:pageBreakBefore\b/.test(pPr),
    drawings,
  };
}

interface Section {
  w: number;
  h: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function readSection(xml: string | undefined): Section {
  const tag = /<w:pgSz\b[^>]*\/?>/.exec(xml || "")?.[0] || "";
  const mar = /<w:pgMar\b[^>]*\/?>/.exec(xml || "")?.[0] || "";
  let w = twipToMm(num(xmlAttr(tag, "w:w"))) || 210;
  let h = twipToMm(num(xmlAttr(tag, "w:h"))) || 297;
  if (xmlAttr(tag, "w:orient") === "landscape" && h > w) [w, h] = [h, w];
  return {
    w: round2(w),
    h: round2(h),
    top: twipToMm(num(xmlAttr(mar, "w:top"))) || 18,
    right: twipToMm(num(xmlAttr(mar, "w:right"))) || 18,
    bottom: twipToMm(num(xmlAttr(mar, "w:bottom"))) || 18,
    left: twipToMm(num(xmlAttr(mar, "w:left"))) || 18,
  };
}

function tableMatrix(xml: string): string[][] {
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
    const cells: string[] = [];
    for (const cell of row[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) {
      const nested = cell[1].replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, " ");
      cells.push(textsOf(nested).replace(/\s+/g, " ").trim());
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function placeFlowText(
  builder: ImportBuilder,
  pageBox: { pageW: number; pageH: number; left: number; right: number; top: number; bottom: number },
  state: { pageIndex: number; y: number },
  para: Paragraph,
): void {
  const width = Math.max(20, pageBox.pageW - pageBox.left - pageBox.right);
  const usable = Math.max(20, pageBox.pageH - pageBox.top - pageBox.bottom);
  const ensure = () => {
    while (builder.pages.length <= state.pageIndex) {
      builder.addPage(`صفحة ${builder.pages.length + 1}`, pageBox.pageW, pageBox.pageH);
    }
    return builder.pages[state.pageIndex];
  };
  state.y += para.beforeMm;
  if (para.pageBreak && state.y > pageBox.top + 1) {
    state.pageIndex += 1;
    state.y = pageBox.top;
  }
  const lineMm = Math.max(4, para.size * 0.3528 * 1.45);
  const chars = Math.max(8, Math.floor(width / Math.max(1.6, para.size * 0.16)));
  const lines: string[] = [];
  for (const piece of (para.text || "").split("\n")) {
    if (!piece) {
      lines.push("");
      continue;
    }
    for (let i = 0; i < piece.length; i += chars) lines.push(piece.slice(i, i + chars));
  }
  if (!lines.length && !para.drawings.length) {
    state.y += para.afterMm;
    return;
  }
  let bucket: string[] = [];
  const flush = () => {
    if (!bucket.length) return;
    const text = bucket.join("\n");
    const h = Math.max(lineMm, bucket.length * lineMm);
    if (state.y + h > pageBox.top + usable && state.y > pageBox.top + 1) {
      state.pageIndex += 1;
      state.y = pageBox.top;
    }
    const page = ensure();
    const box: Box = { x: pageBox.left, y: state.y, w: width, h };
    builder.text(
      page,
      box,
      text,
      {
        fontSize: para.heading ? Math.max(para.size, 16) : para.size,
        fontWeight: para.bold || para.heading ? 700 : 400,
        fontStyle: para.italic ? "italic" : "normal",
        color: para.color,
        fontFamily: para.font,
        textAlign: para.align,
        direction: para.direction,
      },
      para.heading ? "عنوان" : "فقرة",
      para.mixed ? "تنسيق الأسطر المختلط دُمج في نمط الفقرة الغالب" : undefined,
    );
    if (para.mixed) builder.note("فقرة", "partial", "تنسيق مختلط داخل الفقرة دُمج في النمط الغالب دون إسقاط النص.");
    state.y += h;
    bucket = [];
  };
  for (const line of lines) {
    const nextH = (bucket.length + 1) * lineMm;
    if (bucket.length && state.y + nextH > pageBox.top + usable) flush();
    bucket.push(line);
  }
  flush();
  for (const drawing of para.drawings) {
    const page = ensure();
    if (drawing.unsupported && !drawing.text.trim()) {
      builder.note(drawing.unsupported, "skipped", "أُبقي النص المحيط، ولم تُخفَ الصورة غير المدعومة.");
      continue;
    }
    const box: Box = {
      x: drawing.x ?? pageBox.left,
      y: drawing.y ?? state.y,
      w: drawing.w,
      h: drawing.h,
    };
    if (drawing.src) {
      builder.image(page, box, drawing.src, "صورة");
      if (drawing.y == null) state.y += drawing.h + 2;
    }
    if (drawing.text.trim()) {
      builder.text(page, box, drawing.text, { fontSize: 12, direction: para.direction }, "مربع نص", "موضع مربع النص تقريبي عندما لا يحدد الملف إحداثيات الصفحة.");
      if (drawing.y == null && !drawing.src) state.y += Math.max(8, drawing.h);
    }
  }
  state.y += para.afterMm || 1.5;
}

export async function importDocxBytes(bytes: Uint8Array, fileName: string, ids?: () => string): Promise<ReturnType<ImportBuilder["finish"]>> {
  const zip = await readZip(bytes);
  const documentXml = stripAlternateFallback(await zipText(zip, "word/document.xml") || "");
  if (!documentXml.includes("<w:document")) {
    throw new Error("تعذر قراءة ملف Word. تأكد أنه DOCX غير تالف وليس DOC القديم.");
  }
  const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(documentXml)?.[1];
  if (!body) throw new Error("ملف Word لا يحتوي متنًا قابلًا للقراءة.");
  const rels = readRels(await zipText(zip, "word/_rels/document.xml.rels"));
  const styles = readStyles(await zipText(zip, "word/styles.xml"));
  const blocks = bodyBlocks(body);
  const section = readSection([...blocks].reverse().find((block) => block.tag === "w:sectPr")?.xml || body);
  const builder = new ImportBuilder("docx", fileName, ids);
  builder.note(
    "تخطيط Word",
    "partial",
    "المستند تدفّق لا طبقات. وُضعت الفقرات والجداول داخل الهوامش ومقاس الصفحة، دون ادعاء مطابقة سطرًا بسطر.",
  );
  builder.addPage("صفحة 1", section.w, section.h);
  const state = { pageIndex: 0, y: section.top };
  const pageBox = {
    pageW: section.w,
    pageH: section.h,
    left: section.left,
    right: section.right,
    top: section.top,
    bottom: section.bottom,
  };
  let nestedTable = false;
  let listNoted = false;
  for (const block of blocks) {
    if (block.tag === "w:sectPr") continue;
    if (/<w:numPr\b/.test(block.xml) && !listNoted) {
      listNoted = true;
      builder.note("قائمة", "partial", "عناصر القائمة تُستورد كنص. رموز الترقيم الأصلية لا تُعاد رسمها.");
    }
    if (block.tag === "w:tbl") {
      if (/<w:tbl\b[\s\S]*<w:tbl\b/.test(block.xml)) nestedTable = true;
      const matrix = tableMatrix(block.xml);
      const width = Math.max(20, section.w - section.left - section.right);
      const height = Math.max(12, matrix.length * 8);
      if (state.y + height > section.h - section.bottom && state.y > section.top + 1) {
        state.pageIndex += 1;
        state.y = section.top;
        builder.addPage(`صفحة ${state.pageIndex + 1}`, section.w, section.h);
      }
      const page = builder.pages[state.pageIndex];
      builder.table(page, { x: section.left, y: state.y, w: width, h: height }, matrix, "جدول");
      state.y += height + 3;
      continue;
    }
    const drawings = await drawingsOf(block.xml, zip, rels, "word/document.xml");
    const para = readParagraph(block.xml, styles, drawings);
    placeFlowText(builder, pageBox, state, para);
  }
  if (nestedTable) {
    builder.note("جدول متداخل", "partial", "الجداول المتداخلة فُردت كنص داخل خلايا الجدول الخارجي حتى لا يضيع محتواها.");
  }
  const headerTargets = [...rels.entries()].filter(([, target]) => /header/i.test(target));
  for (const [, target] of headerTargets) {
    const xml = await zipText(zip, resolveTarget("word/document.xml", target));
    const text = xml ? textsOf(stripAlternateFallback(xml)).trim() : "";
    if (!text) continue;
    for (const page of builder.pages) {
      builder.text(page, { x: section.left, y: 6, w: section.w - section.left - section.right, h: 8 }, text, { fontSize: 9, direction: "rtl" }, "ترويسة");
    }
    builder.note("ترويسة", "partial", "ترويسة Word وُضعت أعلى كل صفحة. موضعها تقريبي بالنسبة لهامش المتن.");
    break;
  }
  if (!builder.texts && !builder.tables && !builder.images) {
    builder.note("متن فارغ", "skipped", "لم يُعثر على فقرات أو جداول أو صور. الصفحة أُنشئت بالمقاس الصحيح فقط.");
  }
  return builder.finish();
}
