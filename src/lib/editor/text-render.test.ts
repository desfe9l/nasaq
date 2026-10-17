import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CanvasEl } from "./model.ts";
import { prepareText, setTextContext } from "./text-render.ts";
import { ARABIC_LINE_HEIGHT_FLOOR } from "./typography.ts";
import { faceAdvanceMm, measureTextWidth } from "./arabic.ts";

const el = (over: Partial<CanvasEl> = {}): CanvasEl => ({
  id: "t1",
  type: "text",
  name: "نص",
  x: 10,
  y: 10,
  w: 120,
  h: 20,
  rotation: 0,
  opacity: 1,
  z: 1,
  content: "",
  style: { fontFamily: "Tajawal", fontSize: 12, lineHeight: 1.45 },
  ...over,
});

const TATWEEL = "\u0640";

describe("prepareText — the shared render pipeline", () => {
  it("resolves macros from the document context", () => {
    setTextContext({
      orgName: "أمانة منطقة الحدود الشمالية",
      transactionNo: "4417",
    });
    const out = prepareText(el({ content: "{اسم_الجهة} — {رقم_المعاملة}" }));
    assert.equal(out.text, "أمانة منطقة الحدود الشمالية — 4417");
  });

  it("numbers each page separately when a page context is passed", () => {
    const page = el({ content: "{رقم_الصفحة_من_الكل}" });
    /* No numeral style set → the editor's default (Western digits). */
    assert.equal(
      prepareText(page, { number: 3, count: 7 }).text,
      "صفحة 3 من 7",
    );
    assert.equal(
      prepareText(page, { number: 7, count: 7 }).text,
      "صفحة 7 من 7",
    );
    // The element's own numeral style still wins over that default.
    const arabic = el({
      content: "{رقم_الصفحة_من_الكل}",
      style: { numerals: "arabic" },
    });
    assert.equal(
      prepareText(arabic, { number: 3, count: 7 }).text,
      "صفحة ٣ من ٧",
    );
  });

  it("leaves an unknown brace exactly as the author typed it", () => {
    const out = prepareText(el({ content: "بند {غير_معروف}" }));
    assert.equal(out.text, "بند {غير_معروف}");
  });

  it("applies the Arabic leading floor to multi-line text only", () => {
    const tight = el({
      w: 60,
      h: 40,
      content:
        "تلتزم الجهة بتنفيذ خطتها التشغيلية وفق المؤشرات المعتمدة والمواعيد المحددة لها.",
      style: { fontSize: 12, lineHeight: 1.2 },
    });
    assert.equal(prepareText(tight).lineHeight, ARABIC_LINE_HEIGHT_FLOOR);

    // A short single-line title keeps the author's tight leading: nothing is cut.
    const title = el({
      w: 160,
      content: "التقرير السنوي",
      style: { fontSize: 26, lineHeight: 1.2 },
    });
    assert.equal(prepareText(title).lineHeight, 1.2);

    // Latin text is not governed by the Arabic floor.
    const latin = el({
      w: 40,
      content:
        "Annual report of the northern region authority for the fiscal year",
      style: { fontSize: 11, lineHeight: 1.2, fontFamily: "Cairo" },
    });
    assert.equal(prepareText(latin).lineHeight, 1.2);
  });

  it("stretches only when kashida is opted in per element", () => {
    const content = "تلتزم الجهة بتنفيذ خطتها التشغيلية وفق المؤشرات المعتمدة";
    const plain = prepareText(el({ w: 90, content }));
    assert.equal(plain.text.includes(TATWEEL), false);

    const stretched = prepareText(
      el({ w: 90, content, style: { fontSize: 12, kashida: true } }),
    );
    assert.ok(stretched.text.includes(TATWEEL));
    /*
     * Kashida only ever INSERTs tatweel (and line breaks where the paragraph
     * wraps): strip both and the readable text is character-for-character the
     * text the author wrote — no word is ever split or reordered.
     */
    const readable = (value: string) =>
      value
        .replace(/\u0640/g, "")
        .replace(/\s+/g, " ")
        .trim();
    assert.equal(readable(stretched.text), readable(plain.text));
  });

  it("measures kashida stretch per face (browser ink), never a flat 0.5em", () => {
    const content =
      "تسليم التقارير المالية للجهات الحكومية والخاصة في المنطقة";
    const fontSize = 12;
    const widthMm = 56;

    const wide = prepareText(
      el({ w: widthMm, content, style: { fontSize, kashida: true, fontFamily: "Amiri" } }),
    );
    const narrow = prepareText(
      el({ w: widthMm, content, style: { fontSize, kashida: true, fontFamily: "Tajawal" } }),
    );

    const wideAdvance = faceAdvanceMm(fontSize, "Amiri");
    const narrowAdvance = faceAdvanceMm(fontSize, "Tajawal");
    assert.ok(wideAdvance > narrowAdvance, "faces must advance differently");

    // A flat 0.5em model ignores the face, so both faces would justify
    // identically. Face-aware (measured browser-ink) measurement differs.
    assert.notEqual(
      wide.text,
      narrow.text,
      "justification must differ per face",
    );

    // Each justified line must fit its box under its own face-aware measurement.
    assert.ok(
      measureTextWidth(wide.text, fontSize, 400, "Amiri") <= widthMm + wideAdvance,
      `Amiri justified line overruns its box`,
    );
    assert.ok(
      measureTextWidth(narrow.text, fontSize, 400, "Tajawal") <= widthMm + narrowAdvance,
      `Tajawal justified line overruns its box`,
    );

    // The obsolete flat 0.5em model under-measures Amiri and must not be used.
    const flat = fontSize * 0.3528 * 0.5;
    assert.ok(wideAdvance > flat, "Amiri exceeds the flat 0.5em advance");
  });

  it("resolves macros before measuring, so a macro never inflates the box", () => {
    setTextContext({ orgName: "جهة" });
    const withMacro = prepareText(el({ content: "{اسم_الجهة}", w: 200 }));
    const literal = prepareText(el({ content: "جهة", w: 200 }));
    assert.equal(withMacro.neededHeight, literal.neededHeight);
  });

  it("applies text-transform formatting to content", () => {
    const uppercase = prepareText(
      el({ content: "report summary", style: { textTransform: "uppercase" } }),
    );
    assert.equal(uppercase.text, "REPORT SUMMARY");

    const capitalize = prepareText(
      el({ content: "annual financial statement", style: { textTransform: "capitalize" } }),
    );
    assert.equal(capitalize.text, "Annual Financial Statement");

    const lowercase = prepareText(
      el({ content: "EXECUTIVE SUMMARY", style: { textTransform: "lowercase" } }),
    );
    assert.equal(lowercase.text, "executive summary");
  });
});
