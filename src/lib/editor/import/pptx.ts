/**
 * PPTX → one editable NASAQ page per slide.
 *
 * Positions come from the slide's EMU transforms. Text stays text, pictures
 * stay images, and solid shapes stay shapes. Charts, SmartArt and transitions
 * are reported instead of being replaced with a screenshot of the slide.
 */

import type JSZip from "jszip";
import { type Box, ImportBuilder, decodeXml, emuToMm, round2 } from "./shared";
import { embeddedImage, readRels, readZip, resolveTarget, zipText } from "./ooxml";

interface Space {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
}

const ROOT: Space = { ox: 0, oy: 0, sx: 1, sy: 1 };

function attrNum(tag: string, name: string): number {
  const raw = new RegExp(`(?:^|[\\s])${name}="(-?\\d+(?:\\.\\d+)?)"`).exec(tag)?.[1];
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function xfrmOf(xml: string): { offX: number; offY: number; cx: number; cy: number; rot: number } | null {
  const xfrm = /<a:xfrm\b[^>]*>([\s\S]*?)<\/a:xfrm>/.exec(xml);
  if (!xfrm) return null;
  const off = /<a:off\b[^>]*\/?>/.exec(xfrm[1])?.[0] || "";
  const ext = /<a:ext\b[^>]*\/?>/.exec(xfrm[1])?.[0] || "";
  return {
    offX: attrNum(off, "x"),
    offY: attrNum(off, "y"),
    cx: attrNum(ext, "cx"),
    cy: attrNum(ext, "cy"),
    rot: attrNum(xfrm[0], "rot"),
  };
}

function childSpace(xml: string, parent: Space): Space {
  const xfrm = /<a:xfrm\b[^>]*>([\s\S]*?)<\/a:xfrm>/.exec(xml)?.[1] || "";
  const off = /<a:off\b[^>]*\/?>/.exec(xfrm)?.[0] || "";
  const ext = /<a:ext\b[^>]*\/?>/.exec(xfrm)?.[0] || "";
  const chOff = /<a:chOff\b[^>]*\/?>/.exec(xfrm)?.[0] || "";
  const chExt = /<a:chExt\b[^>]*\/?>/.exec(xfrm)?.[0] || "";
  const sx = attrNum(chExt, "cx") ? attrNum(ext, "cx") / attrNum(chExt, "cx") : 1;
  const sy = attrNum(chExt, "cy") ? attrNum(ext, "cy") / attrNum(chExt, "cy") : 1;
  return {
    ox: parent.ox + (attrNum(off, "x") - attrNum(chOff, "x") * sx) * parent.sx,
    oy: parent.oy + (attrNum(off, "y") - attrNum(chOff, "y") * sy) * parent.sy,
    sx: parent.sx * sx,
    sy: parent.sy * sy,
  };
}

function boxOf(xml: string, space: Space): Box | null {
  const frame = xfrmOf(xml);
  if (!frame || frame.cx <= 0 || frame.cy <= 0) return null;
  const x = space.ox + frame.offX * space.sx;
  const y = space.oy + frame.offY * space.sy;
  return {
    x: round2(emuToMm(x)),
    y: round2(emuToMm(y)),
    w: round2(Math.max(4, emuToMm(frame.cx * space.sx))),
    h: round2(Math.max(4, emuToMm(frame.cy * space.sy))),
  };
}

function rotationOf(xml: string): number {
  const rot = xfrmOf(xml)?.rot || 0;
  if (!rot) return 0;
  return round2(rot / 60000);
}

interface Run {
  text: string;
  size?: number;
  bold: boolean;
  italic: boolean;
  color?: string;
  font?: string;
  align?: "left" | "center" | "right" | "justify";
  direction?: "rtl" | "ltr";
}

function fillOf(xml: string): string | undefined {
  if (/<a:noFill\b/.test(xml)) return undefined;
  const raw = /<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/.exec(xml)?.[1];
  return raw ? `#${raw}` : undefined;
}

function runsOf(txBody: string): Run[] {
  const runs: Run[] = [];
  for (const para of txBody.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
    const pPr = /<a:pPr\b[^>]*\/?>/.exec(para[1])?.[0] || /<a:pPr\b[^>]*>/.exec(para[1])?.[0] || "";
    const algn = /algn="([^"]+)"/.exec(pPr)?.[1];
    const align = algn === "ctr" ? "center" : algn === "l" ? "left" : algn === "just" ? "justify" : algn === "r" ? "right" : undefined;
    const direction = /rtl="1"/.test(pPr) ? "rtl" : /rtl="0"/.test(pPr) ? "ltr" : undefined;
    const chunks: string[] = [];
    let size: number | undefined;
    let bold = false;
    let italic = false;
    let color: string | undefined;
    let font: string | undefined;
    for (const run of para[1].matchAll(/<a:r\b[^>]*>([\s\S]*?)<\/a:r>|<a:br\b[^>]*\/>|<a:fld\b[^>]*>([\s\S]*?)<\/a:fld>/g)) {
      if (run[0].startsWith("<a:br")) {
        chunks.push("\n");
        continue;
      }
      const body = run[1] || run[2] || "";
      const rPr = /<a:rPr\b[^>]*>/.exec(body)?.[0] || "";
      const sz = Number(/sz="(\d+)"/.exec(rPr)?.[1] || "");
      if (sz > 0 && !size) size = sz / 100;
      if (/\bb="1"/.test(rPr)) bold = true;
      if (/\bi="1"/.test(rPr)) italic = true;
      color = color || fillOf(body);
      const latin = /<a:latin\b[^>]*typeface="([^"]+)"/.exec(body)?.[1];
      const cs = /<a:cs\b[^>]*typeface="([^"]+)"/.exec(body)?.[1];
      font = font || cs || latin;
      chunks.push(decodeXml(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/.exec(body)?.[1] || ""));
    }
    const text = chunks.join("");
    if (text.trim()) runs.push({ text, size, bold, italic, color, font, align, direction });
  }
  return runs;
}

function tableOf(xml: string): string[][] {
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)) {
    const cells: string[] = [];
    for (const cell of row[1].matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)) {
      cells.push(runsOf(cell[1]).map((run) => run.text).join(" ").replace(/\s+/g, " ").trim());
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

async function paint(
  xml: string,
  space: Space,
  builder: ImportBuilder,
  pageIndex: number,
  zip: JSZip,
  rels: Map<string, string>,
  base: string,
): Promise<void> {
  const page = builder.pages[pageIndex];
  const chunks: { tag: string; xml: string }[] = [];
  const tags = ["p:grpSp", "p:pic", "p:sp", "p:graphicFrame", "p:cxnSp"] as const;
  for (let i = 0; i < xml.length; i += 1) {
    if (xml[i] !== "<") continue;
    const tag = tags.find((name) => xml.startsWith(name, i + 1) && /[\s>/]/.test(xml[i + 1 + name.length] || ""));
    if (!tag) continue;
    const end = closeOf(xml, i, tag);
    chunks.push({ tag, xml: xml.slice(i, end) });
    i = end - 1;
  }
  for (const chunk of chunks) {
    if (chunk.tag === "p:grpSp") {
      const inner = chunk.xml.replace(/^<p:grpSp\b[^>]*>/, "").replace(/<\/p:grpSp>$/, "");
      await paint(inner, childSpace(chunk.xml, space), builder, pageIndex, zip, rels, base);
      continue;
    }
    const name = /<p:cNvPr\b[^>]*name="([^"]*)"/.exec(chunk.xml)?.[1] || (chunk.tag === "p:pic" ? "صورة" : "شكل");
    const box = boxOf(chunk.xml, space);
    if (chunk.tag === "p:graphicFrame") {
      const matrix = tableOf(chunk.xml);
      if (matrix.length && box) {
        builder.table(page, box, matrix, decodeXml(name));
      } else {
        builder.note(decodeXml(name), "skipped", "مخطط أو رسم SmartArt ليس له مقابل أصلي، ولم يُستبدل بلقطة للشريحة.");
      }
      continue;
    }
    if (chunk.tag === "p:pic") {
      const embed = /r:embed="([^"]+)"/.exec(chunk.xml)?.[1];
      const target = embed ? rels.get(embed) : undefined;
      const src = target ? await embeddedImage(zip, resolveTarget(base, target)) : null;
      if (src && box) builder.image(page, box, src, decodeXml(name));
      else builder.note(decodeXml(name), "skipped", src ? "بلا أبعاد" : "تعذر قراءة الصورة المضمّنة في الشريحة.");
      continue;
    }
    if (!box) {
      builder.note(decodeXml(name), "skipped", "شكل بلا إطار موضع يمكن تحويله.");
      continue;
    }
    const spPr = /<p:spPr\b[^>]*>([\s\S]*?)<\/p:spPr>/.exec(chunk.xml)?.[1] || "";
    const fill = fillOf(spPr);
    const preset = /prst="([^"]+)"/.exec(spPr)?.[1] || "rect";
    const shape = preset === "ellipse" ? "circle" : preset === "roundRect" ? "rounded" : "rect";
    if (fill && preset !== "line") builder.shape(page, box, fill, decodeXml(name), shape);
    const tx = /<p:txBody\b[^>]*>([\s\S]*?)<\/p:txBody>/.exec(chunk.xml)?.[1] || "";
    const runs = runsOf(tx);
    if (runs.length) {
      const sizes = new Set(runs.map((run) => run.size || 0));
      const text = runs.map((run) => run.text).join("\n");
      const first = runs[0];
      const el = builder.text(
        page,
        box,
        text,
        {
          fontSize: first.size || 16,
          fontWeight: runs.some((run) => run.bold) ? 700 : 400,
          fontStyle: runs.some((run) => run.italic) ? "italic" : "normal",
          color: first.color || "#172033",
          fontFamily: first.font,
          textAlign: first.align,
          direction: first.direction,
        },
        decodeXml(name),
        sizes.size > 1 ? "أحجام النص المختلفة داخل الشكل دُمجت في الحجم الأول" : undefined,
      );
      const rot = rotationOf(chunk.xml);
      if (el && rot) el.rotation = rot;
      if (sizes.size > 1) builder.note(decodeXml(name), "partial", "أكثر من حجم خط داخل الشكل نفسه؛ بقي النص كاملًا بنمط غالب.");
    } else if (!fill) {
      builder.note(decodeXml(name), "skipped", "شكل بلا تعبئة ولا نص.");
    }
  }
}

function closeOf(xml: string, start: number, tag: string): number {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const gt = xml.indexOf(">", start);
  if (gt < 0) return xml.length;
  if (xml[gt - 1] === "/") return gt + 1;
  let depth = 1;
  let i = gt + 1;
  while (depth > 0 && i < xml.length) {
    const nextClose = xml.indexOf(close, i);
    if (nextClose < 0) return xml.length;
    let nextOpen = xml.indexOf(open, i);
    while (nextOpen >= 0 && nextOpen < nextClose && !/[\s>/]/.test(xml[nextOpen + open.length] || "")) {
      nextOpen = xml.indexOf(open, nextOpen + open.length);
    }
    if (nextOpen >= 0 && nextOpen < nextClose) {
      const end = xml.indexOf(">", nextOpen);
      if (end < 0) return xml.length;
      if (xml[end - 1] !== "/") depth += 1;
      i = end + 1;
    } else {
      depth -= 1;
      i = nextClose + close.length;
    }
  }
  return i;
}

function slideSize(xml: string | undefined): { w: number; h: number } {
  const tag = /<p:sldSz\b[^>]*\/?>/.exec(xml || "")?.[0] || "";
  const cx = attrNum(tag, "cx");
  const cy = attrNum(tag, "cy");
  return {
    w: cx ? round2(emuToMm(cx)) : 338.67,
    h: cy ? round2(emuToMm(cy)) : 190.5,
  };
}

function slideOrder(presentation: string, rels: Map<string, string>): string[] {
  const ids = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => m[1]);
  const paths = ids
    .map((id) => rels.get(id))
    .filter((target): target is string => !!target)
    .map((target) => resolveTarget("ppt/presentation.xml", target));
  return paths.length ? paths : ["ppt/slides/slide1.xml"];
}

function pageColor(xml: string): string | undefined {
  const bg = /<p:bg\b[^>]*>([\s\S]*?)<\/p:bg>/.exec(xml)?.[1] || "";
  return fillOf(bg);
}

export async function importPptxBytes(bytes: Uint8Array, fileName: string, ids?: () => string): Promise<ReturnType<ImportBuilder["finish"]>> {
  const zip = await readZip(bytes);
  const presentation = await zipText(zip, "ppt/presentation.xml");
  if (!presentation || !presentation.includes("<p:presentation")) {
    throw new Error("تعذر قراءة ملف PowerPoint. تأكد أنه PPTX غير تالف وليس PPT القديم.");
  }
  const rels = readRels(await zipText(zip, "ppt/_rels/presentation.xml.rels"));
  const size = slideSize(presentation);
  const slides = slideOrder(presentation, rels);
  const builder = new ImportBuilder("pptx", fileName, ids);
  builder.note("شرائح", "partial", "كل شريحة أصبحت صفحة قابلة للتحرير. الانتقالات والحركة لا تُستورد.");
  let index = 0;
  for (const path of slides) {
    index += 1;
    const xml = await zipText(zip, path);
    if (!xml) {
      builder.addPage(`شريحة ${index}`, size.w, size.h);
      builder.note(`شريحة ${index}`, "skipped", "تعذر قراءة XML الشريحة.");
      continue;
    }
    const page = builder.addPage(`شريحة ${index}`, size.w, size.h, pageColor(xml) || "#ffffff");
    const slideRels = readRels(await zipText(zip, path.replace(/slides\/([^/]+)$/, "slides/_rels/$1.rels")));
    const tree = /<p:spTree\b[^>]*>([\s\S]*?)<\/p:spTree>/.exec(xml)?.[1] || xml;
    await paint(tree, ROOT, builder, builder.pages.indexOf(page), zip, slideRels, path);
  }
  if (!builder.pages.length) throw new Error("ملف PowerPoint لا يحتوي شرائح قابلة للقراءة.");
  return builder.finish();
}
