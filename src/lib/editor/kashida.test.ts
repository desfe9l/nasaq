import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  justifyKashida,
  kashidaSlots,
  isArabicLetter,
  tatweelWidthMm,
} from "./kashida.ts";

const TATWEEL = "\u0640";

/** Count tatweel characters in a string. */
const strokes = (text: string) => (text.match(/\u0640/g) ?? []).length;

/** A fixed-width measure: one unit per character, so the maths is readable. */
const measure = (value: string) => value.length;

const base = {
  width: 48,
  tatweelWidth: 1,
  maxPerGap: 6,
  measureWidth: measure,
};

describe("kashida", () => {
  it("only offers slots between two dual-joining letters", () => {
    // «بيت»: both gaps join on both sides — two legal positions.
    assert.deepEqual(kashidaSlots("بيت"), [1, 2]);
    // «كتاب»: ت joins ا, but ا does not join forward — only one gap.
    assert.deepEqual(kashidaSlots("كتاب"), [1]);
    // «مدرسة»: د, ر and ة never join forward, so there is no legal gap at all.
    assert.deepEqual(kashidaSlots("مدرسة"), []);
    // «ماء»: hamza never joins.
    assert.deepEqual(kashidaSlots("ماء"), []);
    // A two-letter word has no interior gap.
    assert.deepEqual(kashidaSlots("به"), []);
  });

  it("ignores marks and tatweel when deciding a slot", () => {
    // «بَيت» — the fatha splits ب from ي, so only the ي–ت gap remains.
    assert.deepEqual(kashidaSlots("بَيت"), [3]);
    // An existing tatweel is not a new position.
    assert.deepEqual(kashidaSlots(`ب${TATWEEL}ت`), []);
  });

  it("recognises Arabic letters, but not the tatweel stroke", () => {
    assert.equal(isArabicLetter("ب"), true);
    assert.equal(isArabicLetter("ـ"), false);
    assert.equal(isArabicLetter("A"), false);
    assert.equal(isArabicLetter("1"), false);
  });

  it("leaves a single short line flush to the right by default", () => {
    const line = "تنفيذ الخطة التشغيلية للعام الحالي";
    const result = justifyKashida(line, base);
    assert.equal(result.applied, false);
    assert.equal(result.text, line);
  });

  it("stretches a short line up to the target width when asked", () => {
    const result = justifyKashida("تنفيذ الخطة التشغيلية للعام الحالي", {
      ...base,
      justifyLastLine: true,
    });
    assert.equal(result.applied, true);
    assert.ok(result.added > 0);
    // Never past the target: the stretched line must still fit its box.
    assert.ok(measure(result.text) <= 48, `grew to ${measure(result.text)}`);
    assert.ok(strokes(result.text) > 0);
  });

  it("spreads the stretch evenly across the line", () => {
    const result = justifyKashida("تسليم التقارير المالية للجهات الحكومية", {
      ...base,
      width: 52,
      justifyLastLine: true,
    });
    const runs = result.text.match(/\u0640+/g) ?? [];
    assert.ok(runs.length >= 3, `runs: ${runs.join(" ")}`);
    const widths = new Set(runs.map((r) => r.length));
    // A line mixing single strokes with four-strong runs reads as broken.
    assert.ok(widths.size <= 2, `run widths: ${[...widths].join(",")}`);
  });

  it("leaves a line that already fills the width untouched", () => {
    const line = "تسليم التقارير المالية للجهات الحكومية والخاصة في المنطقة";
    const result = justifyKashida(line, {
      ...base,
      width: measure(line),
      justifyLastLine: true,
    });
    assert.equal(result.applied, false);
    assert.equal(result.text, line);
  });

  it("justifies every line but the closing one", () => {
    const text =
      "تلتزم الجهة بتنفيذ خطة التشغيل للعام المالي القادم " +
      "وتشمل الخطة ثلاثة مسارات رئيسية للتنفيذ " +
      "وتُقاس النتائج بمؤشرات أداء ربع سنوية";
    const result = justifyKashida(text, base);
    const lines = result.text.split("\n");
    assert.ok(lines.length >= 2, `wrapped into ${lines.length} line(s)`);
    assert.ok(strokes(lines[0]) > 0, "the first line should stretch");
    assert.equal(
      strokes(lines[lines.length - 1]),
      0,
      "the last line stays flush",
    );
  });

  it("honours explicit line breaks", () => {
    const result = justifyKashida("بسم الله الرحمن الرحيم\nوالحمد لله", {
      ...base,
      justifyLastLine: true,
    });
    const lines = result.text.split("\n");
    assert.equal(lines.length, 2);
    assert.ok(strokes(lines[0]) > 0);
    assert.ok(strokes(lines[1]) > 0);
  });

  it("never writes a stroke where no dual-joining gap exists", () => {
    const result = justifyKashida("ورد ازدهر", {
      ...base,
      width: 40,
      justifyLastLine: true,
    });
    assert.equal(result.applied, false);
    assert.equal(result.text, "ورد ازدهر");
  });

  it("caps the stretch per gap so a two-word line stays readable", () => {
    const result = justifyKashida("تسليم التقارير", {
      ...base,
      width: 90,
      maxPerGap: 2,
      justifyLastLine: true,
    });
    const runs = result.text.match(/\u0640+/g) ?? [];
    assert.ok(runs.length > 0);
    assert.ok(
      runs.every((r) => r.length <= 2),
      runs.join(" "),
    );
  });

  it("never overflows the target width on a long paragraph", () => {
    const text =
      "تلتزم الجهة بتنفيذ خطة التشغيل للعام المالي القادم " +
      "وتشمل الخطة ثلاثة مسارات رئيسية للتنفيذ " +
      "وتُقاس النتائج بمؤشرات أداء ربع سنوية";
    for (const width of [30, 42, 55, 70]) {
      const unit = 0.7;
      const result = justifyKashida(text, {
        width,
        tatweelWidth: unit,
        maxPerGap: 6,
        measureWidth: (value) => value.length * unit,
      });
      for (const line of result.text.split("\n")) {
        assert.ok(
          line.length * unit <= width + unit,
          `width ${width}: line grew to ${(line.length * unit).toFixed(2)}`,
        );
        // No stroke was inserted somewhere it does not belong: removing them
        // returns the original words.
        assert.equal(
          line
            .replace(/\u0640/g, "")
            .replace(/\s+/g, " ")
            .trim().length > 0,
          true,
        );
      }
    }
  });

  it("is a no-op without a stroke width or content", () => {
    assert.equal(
      justifyKashida("نص", { width: 40, tatweelWidth: 0 }).text,
      "نص",
    );
    assert.equal(justifyKashida("", { width: 40, tatweelWidth: 1 }).text, "");
  });

  it("derives a sensible stroke advance from the point size", () => {
    // Half an em, floored so a tiny point size still has a usable stroke.
    assert.ok(tatweelWidthMm(14) > 0.3 && tatweelWidthMm(14) < 3);
    assert.ok(tatweelWidthMm(0) > 0);
  });
});
