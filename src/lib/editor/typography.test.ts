import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { THEMES, type CanvasEl } from "./model.ts";
import {
  ARABIC_LINE_HEIGHT_FLOOR,
  TYPOGRAPHY_PRESETS,
  applyTypographyPreset,
  arabicSafeLineHeight,
  belowArabicFloor,
  fontLineHeightFloor,
  presetColor,
  presetStyle,
  typographyPreset,
} from "./typography.ts";

const theme = THEMES.official;

const el = (over: Partial<CanvasEl> = {}): CanvasEl => ({
  id: "t1",
  type: "text",
  name: "نص",
  x: 10,
  y: 10,
  w: 90,
  h: 18,
  rotation: 0,
  opacity: 1,
  z: 1,
  content: "",
  style: {},
  ...over,
});

describe("typography presets", () => {
  it("names every preset by the author's intent, not by a font size", () => {
    const ids = TYPOGRAPHY_PRESETS.map((p) => p.id);
    assert.deepEqual(ids, [
      "report-title",
      "subtitle",
      "official-body",
      "letter-ref",
      "signature",
    ]);
    for (const preset of TYPOGRAPHY_PRESETS) {
      assert.ok(preset.label.length > 1);
      assert.ok(preset.hint.length > 5);
      assert.ok(preset.sample.length > 1);
    }
  });

  it("keeps every preset at or above the Arabic line-height floor", () => {
    for (const preset of TYPOGRAPHY_PRESETS) {
      assert.ok(
        preset.style.lineHeight >= ARABIC_LINE_HEIGHT_FLOOR,
        `${preset.id} leading ${preset.style.lineHeight} is below the floor`,
      );
    }
  });

  it("sizes the hierarchy so a title outranks its subtitle and body", () => {
    const size = (id: string) => typographyPreset(id)!.style.fontSize;
    assert.ok(size("report-title") > size("subtitle"));
    assert.ok(size("subtitle") > size("official-body"));
    assert.ok(size("official-body") > size("letter-ref"));
  });

  it("turns kashida on only for the justification-heavy body preset", () => {
    for (const preset of TYPOGRAPHY_PRESETS) {
      assert.equal(
        Boolean(preset.style.kashida),
        preset.id === "official-body",
        `${preset.id} kashida`,
      );
    }
    assert.equal(
      typographyPreset("official-body")?.style.justifyLastLine,
      "start",
    );
  });
});

describe("theme-resolved colours", () => {
  it("resolves each role against the LIVE theme", () => {
    assert.equal(presetColor("primary", theme), theme.primary);
    assert.equal(presetColor("accent", theme), theme.accent);
    assert.equal(presetColor("muted", theme), theme.muted);
    assert.equal(presetColor("ink", theme), theme.ink);
    // Text on a filled brand surface is white in every theme.
    assert.equal(presetColor("onPrimary", THEMES.eid), "#ffffff");
  });

  it("builds a style patch from the theme, never from a hardcoded palette", () => {
    const style = presetStyle(
      typographyPreset("report-title")!,
      THEMES.ministry,
    );
    assert.equal(style.color, THEMES.ministry.primary);
    assert.equal(style.fontSize, 26);
    assert.equal(style.fontWeight, 800);
    assert.ok((style.lineHeight ?? 0) >= ARABIC_LINE_HEIGHT_FLOOR);
  });

  it("cannot be dragged below the floor even by editing a preset number", () => {
    const broken = {
      ...typographyPreset("official-body")!,
      style: { ...typographyPreset("official-body")!.style, lineHeight: 1.1 },
    };
    assert.equal(
      presetStyle(broken, theme).lineHeight,
      ARABIC_LINE_HEIGHT_FLOOR,
    );
  });
});

describe("applying a preset", () => {
  it("writes style only, and leaves the authored geometry alone", () => {
    const before = el({ w: 123, h: 45, x: 7, y: 9, content: "نص مكتوب" });
    const after = applyTypographyPreset(
      before,
      typographyPreset("official-body")!,
      "official",
    );
    assert.deepEqual(
      { x: after.x, y: after.y, w: after.w, h: after.h },
      { x: 7, y: 9, w: 123, h: 45 },
    );
    assert.equal(after.style.kashida, true);
    assert.equal(after.style.fontFamily, "Tajawal");
    assert.equal(after.content, "نص مكتوب");
    // The original object is untouched — presets never mutate in place.
    assert.equal(before.style.kashida, undefined);
  });

  it("fills an EMPTY element with the preset's sample text", () => {
    const after = applyTypographyPreset(
      el(),
      typographyPreset("report-title")!,
      "official",
    );
    assert.equal(after.content, typographyPreset("report-title")!.sample);
  });

  it("never overwrites text the author already wrote", () => {
    const after = applyTypographyPreset(
      el({ content: "خطاب إلى معالي الوزير" }),
      typographyPreset("report-title")!,
      "official",
    );
    assert.equal(after.content, "خطاب إلى معالي الوزير");
  });

  it("resizes the box only when asked (the new-element path)", () => {
    const after = applyTypographyPreset(
      el(),
      typographyPreset("signature")!,
      "official",
      {
        resizeBox: true,
      },
    );
    assert.equal(after.w, typographyPreset("signature")!.box.w);
    assert.equal(after.h, typographyPreset("signature")!.box.h);
  });
});

describe("the Arabic leading floor", () => {
  it("raises a legacy value and leaves a safe one exactly as it is", () => {
    assert.equal(arabicSafeLineHeight(1.2), ARABIC_LINE_HEIGHT_FLOOR);
    assert.equal(arabicSafeLineHeight(1.5), 1.5);
    assert.equal(arabicSafeLineHeight(2.4), 2.4);
    // A missing or nonsensical value falls back to the floor, not to 0.
    assert.equal(arabicSafeLineHeight(undefined), ARABIC_LINE_HEIGHT_FLOOR);
    assert.equal(arabicSafeLineHeight(0), ARABIC_LINE_HEIGHT_FLOOR);
    assert.equal(arabicSafeLineHeight(Number.NaN), ARABIC_LINE_HEIGHT_FLOOR);
  });

  it("reports only genuinely-below-floor values as legacy", () => {
    assert.equal(belowArabicFloor(1.25), true);
    assert.equal(belowArabicFloor(1.5), false);
    assert.equal(belowArabicFloor(2), false);
    assert.equal(belowArabicFloor(undefined), false);
  });
});

describe("per-family leading floors", () => {
  it("gives Naskh and Kufi faces more leading than the sans faces", () => {
    const amiri = fontLineHeightFloor("Amiri");
    const naskh = fontLineHeightFloor("Noto Naskh Arabic");
    const tajawal = fontLineHeightFloor("Tajawal");
    const cairo = fontLineHeightFloor("Cairo");
    assert.ok(amiri > tajawal, "Amiri needs more room than Tajawal");
    assert.ok(naskh >= amiri - 0.001, "Naskh faces are the roomiest");
    assert.ok(cairo > tajawal, "Cairo sits taller than Tajawal");
    for (const floor of [amiri, naskh, tajawal, cairo]) {
      assert.ok(floor >= ARABIC_LINE_HEIGHT_FLOOR);
    }
  });

  it("is tolerant of quoted/unknown families and falls back safely", () => {
    assert.equal(fontLineHeightFloor('"Amiri"'), fontLineHeightFloor("Amiri"));
    assert.equal(
      fontLineHeightFloor("خط الجهة المخصص"),
      ARABIC_LINE_HEIGHT_FLOOR,
    );
    assert.equal(fontLineHeightFloor(undefined), ARABIC_LINE_HEIGHT_FLOOR);
    assert.equal(
      arabicSafeLineHeight(1.4, "خط مخصص"),
      ARABIC_LINE_HEIGHT_FLOOR,
    );
  });

  it("raises only what the family actually needs", () => {
    // 1.55 is safe for Cairo but not for Amiri.
    assert.equal(arabicSafeLineHeight(1.55, "Cairo"), 1.55);
    assert.equal(
      arabicSafeLineHeight(1.55, "Amiri"),
      fontLineHeightFloor("Amiri"),
    );
    assert.equal(belowArabicFloor(1.55, "Amiri"), true);
    assert.equal(belowArabicFloor(1.55, "Cairo"), false);
  });
});
