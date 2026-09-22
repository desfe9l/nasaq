import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyNumerals,
  bindUnits,
  estimateLines,
  fitFontSize,
  normalizeArabic,
  stripTashkeel,
  toArabicDigits,
  unwrapParagraphs,
  withParagraphSpacing,
} from "./arabic.ts";

describe("Arabic numerals", () => {
  it("maps western digits to Arabic-Indic", () => {
    assert.equal(toArabicDigits("2026"), "٢٠٢٦");
    assert.equal(toArabicDigits("عام 1445 هـ"), "عام ١٤٤٥ هـ");
  });

  it("leaves already-Arabic digits alone", () => {
    assert.equal(applyNumerals("٩٠٤ حالة", "arabic"), "٩٠٤ حالة");
  });

  it("passes text through untouched for the western style", () => {
    assert.equal(applyNumerals("904 حالة", "western"), "904 حالة");
  });
});

describe("Arabic clean-up", () => {
  it("strips tashkeel without touching base letters", () => {
    assert.equal(stripTashkeel("الْحَمْدُ لِلَّهِ"), "الحمد لله");
  });

  it("collapses soft wraps but keeps hard paragraph breaks", () => {
    assert.equal(unwrapParagraphs("سطر\nمتصل"), "سطر متصل");
    assert.equal(unwrapParagraphs("فقرة\n\nفقرة"), "فقرة\n\nفقرة");
  });

  it("binds a number to its unit with a non-breaking space", () => {
    assert.equal(bindUnits("75 %"), "75\u00a0%");
  });

  it("applies steps in a fixed order regardless of input order", () => {
    const a = normalizeArabic("٩٠٤\nحالات", {
      numerals: "western",
      unwrap: true,
    });
    assert.equal(a, "904 حالات");
  });
});

describe("estimateLines", () => {
  it("returns zero for blank content", () => {
    assert.equal(estimateLines("   ", 100, 12), 0);
  });

  it("counts hard line breaks as separate lines", () => {
    assert.equal(estimateLines("أ\nب\nج", 400, 6), 3);
  });

  it("grows the line count as the font gets larger", () => {
    const text =
      "نص تجريبي طويل يقيس عدد الأسطر المتوقعة داخل الإطار المخصص له".repeat(3);
    const small = estimateLines(text, 80, 8);
    const large = estimateLines(text, 80, 24);
    assert.ok(large > small, `expected ${large} > ${small}`);
  });
});

describe("withParagraphSpacing", () => {
  const two = "فقرة أولى\n\nفقرة ثانية";

  it("returns the text untouched at zero", () => {
    assert.equal(withParagraphSpacing(two, 0), two);
  });

  it("leaves a single newline alone — it is a soft break, not a paragraph gap", () => {
    assert.equal(withParagraphSpacing("سطر\nسطر", 2), "سطر\nسطر");
  });

  it("adds one extra blank line per step, on top of the break's own blank line", () => {
    assert.equal(withParagraphSpacing(two, 1), "فقرة أولى\n\n\nفقرة ثانية");
    assert.equal(withParagraphSpacing(two, 2), "فقرة أولى\n\n\n\nفقرة ثانية");
  });

  it("applies to every paragraph boundary", () => {
    const three = "أ\n\nب\n\nج";
    const out = withParagraphSpacing(three, 1);
    assert.equal((out.match(/\n{3}/g) || []).length, 2);
  });

  it("caps runaway spacing", () => {
    const out = withParagraphSpacing(two, 99);
    assert.ok((out.match(/\n+/)?.[0].length ?? 0) <= 6);
  });

  it("is reversible, because the stored content keeps the author's newlines", () => {
    const spaced = withParagraphSpacing(two, 2);
    assert.notEqual(spaced, two);
    assert.equal(withParagraphSpacing(two, 0), two);
  });
});

describe("fitFontSize with paragraph spacing", () => {
  const paras = "المقدمة\n\nالإحصائيات\n\nالمؤشرات\n\nالنتائج\n\nالتوصيات";
  const box = { w: 100, h: 30 };

  it("budgets less room as the paragraph gap grows", () => {
    const tight = fitFontSize(paras, box, 14, 1.45, "shrink", 0);
    const loose = fitFontSize(paras, box, 14, 1.45, "shrink", 2);
    assert.ok(loose <= tight, `expected ${loose} <= ${tight}`);
  });

  it("ignores paragraph spacing for a single paragraph", () => {
    const one = "فقرة واحدة بلا فواصل";
    assert.equal(
      fitFontSize(one, box, 14, 1.45, "shrink", 2),
      fitFontSize(one, box, 14, 1.45, "shrink", 0),
    );
  });

  it("still returns the base size in clip mode", () => {
    assert.equal(fitFontSize(paras, box, 14, 1.45, "clip", 2), 14);
  });
});

describe("fitFontSize", () => {
  const long =
    "تقرير مفصل عن مؤشرات الأداء الربع سنوي مع شرح لكل مؤشر ونتائجه".repeat(4);
  const box = { w: 60, h: 20 };

  it("returns the requested size in clip mode", () => {
    assert.equal(fitFontSize(long, box, 14, 1.45, "clip"), 14);
  });

  it("shrinks overflowing text and never below half the requested size", () => {
    const size = fitFontSize(long, box, 14, 1.45, "shrink");
    assert.ok(size <= 14, `expected <= 14, got ${size}`);
    assert.ok(size >= 7, `expected >= 7, got ${size}`);
  });

  it("leaves text that already fits at its requested size", () => {
    assert.equal(
      fitFontSize("عنوان", { w: 120, h: 40 }, 18, 1.45, "shrink"),
      18,
    );
  });

  it("caps growth for short text", () => {
    const size = fitFontSize("ع", { w: 200, h: 200 }, 10, 1.45, "grow");
    assert.ok(size <= 16, `expected <= 16 (1.6x cap), got ${size}`);
    assert.ok(size >= 10, `expected >= 10, got ${size}`);
  });

  it("returns the base size for empty text", () => {
    assert.equal(fitFontSize("", box, 12, 1.45, "shrink"), 12);
    assert.equal(fitFontSize("", box, 12, 1.45, "grow"), 12);
  });
});
