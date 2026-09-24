import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MACROS,
  macroIdOf,
  macroIdsIn,
  hasMacro,
  hijriFromDate,
  formatHijriDate,
  formatGregorianDate,
  macroValues,
  resolveMacros,
  unresolvedMacros,
} from "./macros.ts";

/** A fixed date so every assertion is timezone- and clock-independent. */
const AT = new Date("2026-09-22T12:00:00Z");

describe("macros", () => {
  it("exposes exactly the five tokens the editor offers", () => {
    assert.deepEqual(
      MACROS.map((m) => m.token),
      [
        "{التاريخ_الهجري}",
        "{التاريخ_الميلادي}",
        "{رقم_الصفحة_من_الكل}",
        "{اسم_الجهة}",
        "{رقم_المعاملة}",
      ],
    );
  });

  it("recognises a token regardless of spacing, tatweel or alef form", () => {
    assert.equal(macroIdOf("التاريخ_الهجري"), "hijri_date");
    assert.equal(macroIdOf(" التاريخ الهجري "), "hijri_date");
    assert.equal(macroIdOf("التاريخ الهجري"), "hijri_date");
    assert.equal(macroIdOf("التــاريخ_الهجرى"), "hijri_date");
    assert.equal(macroIdOf("اسم الجهة"), "org_name");
    assert.equal(macroIdOf("رقم_الصفحة_من_الكل"), "page_of_total");
    assert.equal(macroIdOf("زقزقة"), null);
  });

  it("detects macros and lists them once, in order", () => {
    const text = "{اسم_الجهة} — تقرير {التاريخ_الميلادي} — {اسم الجهة}";
    assert.equal(hasMacro(text), true);
    assert.deepEqual(macroIdsIn(text), ["org_name", "gregorian_date"]);
    assert.equal(hasMacro("نص بلا رموز"), false);
  });

  it("resolves a paragraph of mixed tokens", () => {
    const out = resolveMacros(
      "صادر عن {اسم_الجهة}\nبتاريخ {التاريخ_الهجري} الموافق {التاريخ_الميلادي}\n{رقم_الصفحة_من_الكل} · معاملة {رقم_المعاملة}",
      {
        now: AT,
        pageNumber: 3,
        pageCount: 7,
        orgName: "أمانة منطقة الحدود الشمالية",
        transactionNo: "4417/ب",
        numerals: "arabic",
      },
    );
    assert.match(out, /صادر عن أمانة منطقة الحدود الشمالية/);
    assert.match(out, /ربيع الآخر ١٤٤٨ هـ/);
    assert.match(out, /سبتمبر ٢٠٢٦/);
    assert.match(out, /صفحة ٣ من ٧/);
    assert.match(out, /٤٤١٧\/ب/);
    assert.equal(out.includes("{"), false);
  });

  it("follows the element's numeral style", () => {
    const arabic = resolveMacros("{التاريخ_الميلادي}", {
      now: AT,
      numerals: "arabic",
    });
    const western = resolveMacros("{التاريخ_الميلادي}", {
      now: AT,
      numerals: "western",
    });
    assert.equal(arabic, "٢٢ سبتمبر ٢٠٢٦");
    assert.equal(western, "22 سبتمبر 2026");
    assert.equal(
      resolveMacros("{رقم_الصفحة_من_الكل}", {
        pageNumber: 2,
        pageCount: 9,
        numerals: "western",
      }),
      "صفحة 2 من 9",
    );
  });

  it("leaves unknown braces exactly as the author typed them", () => {
    const text = "قيمة {غير_معروف} و { و } ونص";
    assert.equal(resolveMacros(text, { now: AT }), text);
    assert.deepEqual(unresolvedMacros(text), ["{غير_معروف}", "{ و }"]);
  });

  it("falls back to a placeholder rather than printing an empty entity", () => {
    assert.equal(macroValues({ now: AT }).org_name, "—");
    assert.equal(macroValues({ now: AT }).transaction_no, "……………");
    assert.equal(macroValues({ now: AT, orgName: "  " }).org_name, "—");
  });

  it("computes a Hijri date without Intl's calendar when asked", () => {
    // 22 September 2026 Gregorian ≈ 10 Rabi' al-Akhir 1448 Hijri.
    const h = hijriFromDate(new Date("2026-09-22T00:00:00Z"));
    assert.equal(h.y, 1448);
    assert.equal(h.m, 4);
    assert.ok(h.d >= 9 && h.d <= 11, `day was ${h.d}`);
    assert.equal(formatHijriDate(AT, "arabic"), "١١ ربيع الآخر ١٤٤٨ هـ");
    assert.equal(formatHijriDate(AT, "western"), "11 ربيع الآخر 1448 هـ");
    assert.match(formatGregorianDate(AT), /^22 سبتمبر 2026$/);
  });

  it("resolves page numbers defensively", () => {
    /* Unset numeral style = the editor's default = Western digits. */
    assert.equal(
      resolveMacros("{رقم_الصفحة_من_الكل}", { pageNumber: 0, pageCount: 0 }),
      "صفحة 1 من 1",
    );
    // A total below the current page still prints a coherent range.
    assert.equal(
      resolveMacros("{رقم_الصفحة_من_الكل}", { pageNumber: 5, pageCount: 2 }),
      "صفحة 5 من 5",
    );
    assert.equal(
      resolveMacros("{رقم_الصفحة_من_الكل}", {
        pageNumber: 5,
        pageCount: 2,
        numerals: "arabic",
      }),
      "صفحة ٥ من ٥",
    );
  });
});
