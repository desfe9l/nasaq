import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CanvasEl, Page } from "./model.ts";
import { runPreflight, preflightSummary, issuesOf } from "./preflight.ts";
import { setTextContext } from "./text-render.ts";

const A4 = { w: 210, h: 297 };

const el = (over: Partial<CanvasEl> = {}): CanvasEl => ({
  id: over.id || "e1",
  type: "text",
  name: "عنصر",
  x: 20,
  y: 20,
  w: 80,
  h: 12,
  rotation: 0,
  opacity: 1,
  z: 1,
  content: "نص",
  style: {},
  ...over,
});

const page = (elements: CanvasEl[], over: Partial<Page> = {}): Page => ({
  id: over.id || "p1",
  name: over.name || "صفحة ١",
  w: A4.w,
  h: A4.h,
  elements,
  ...over,
});

const kinds = (pages: Page[], options = {}) =>
  runPreflight(pages, options).issues.map((i) => i.kind);

describe("pre-flight", () => {
  it("reports a clean document as clean", () => {
    const report = runPreflight([page([el({ content: "تقرير سنوي" })])]);
    assert.equal(report.clean, true);
    assert.equal(preflightSummary(report), "لا ملاحظات — المستند جاهز للتصدير");
  });

  it("reports only FIXED boxes whose text is cut off", () => {
    const long = "نص طويل جدًا ".repeat(40);
    const fixed = runPreflight([
      page([
        el({
          id: "fixed",
          content: long,
          h: 12,
          style: { textBoxMode: "fixed", fontSize: 14 },
        }),
      ]),
    ]);
    assert.deepEqual(
      kinds([
        page([
          el({
            id: "fixed",
            content: long,
            h: 12,
            style: { textBoxMode: "fixed", fontSize: 14 },
          }),
        ]),
      ]),
      ["text-overflow"],
    );
    assert.equal(fixed.issues[0].fix, "fit-text");
    // The same block in an auto-height box simply grows — no false alarm.
    assert.deepEqual(
      kinds([
        page([
          el({
            id: "auto",
            content: long,
            h: 12,
            style: { textBoxMode: "autoHeight" },
          }),
        ]),
      ]),
      [],
    );
  });

  it("flags content in the binding margin but keeps page-wide furniture out of it", () => {
    const report = runPreflight([
      page([
        el({
          id: "logo",
          x: A4.w - 11,
          y: 30,
          w: 8,
          h: 8,
          type: "logo",
          src: "l.png",
        }),
        el({
          id: "band",
          x: 0,
          y: 0,
          w: A4.w,
          h: 18,
          type: "box",
          content: "",
          style: { fill: "#eef" },
        }),
      ]),
    ]);
    const gutter = report.issues.find((i) => i.kind === "gutter");
    assert.ok(gutter);
    assert.deepEqual(gutter.elementIds, ["logo"]);
    assert.equal(gutter.fix, "move-inward");
  });

  it("measures the sheet edge against the trim, or the bleed when it is on", () => {
    const bled = page([el({ x: -2, y: 60, w: 40 })]);
    // Bleed off: the author's page edge IS the cut, so 2 mm outside is a loss.
    assert.deepEqual(kinds([bled]), ["off-page"]);
    // Bleed on: 2 mm is inside the 3 mm bleed, and prints correctly.
    assert.deepEqual(
      kinds([bled], { guides: { safe: true, gutter: true, bleed: true } }),
      [],
    );
    // 20 mm outside is artwork falling off the sheet either way.
    assert.deepEqual(
      kinds([page([el({ x: -20, y: 60, w: 40 })])], {
        guides: { safe: true, gutter: true, bleed: true },
      }),
      ["off-page"],
    );
  });

  it("grades image resolution: below 300 warns, below 150 is an error", () => {
    const image = el({ id: "pic", type: "image", src: "a.png", w: 100, h: 60 });
    const report = runPreflight([page([image])], {
      imageSize: () => ({ w: 600, h: 400 }),
    });
    const low = report.issues.find((i) => i.kind === "low-resolution");
    assert.ok(low);
    assert.equal(low.severity, "warning");
    const worse = runPreflight([page([image])], {
      imageSize: () => ({ w: 200, h: 150 }),
    });
    assert.equal(
      worse.issues.find((i) => i.kind === "low-resolution")?.severity,
      "error",
    );
    // Without a pixel source the check is skipped rather than guessed.
    assert.deepEqual(kinds([page([image])]), []);
  });

  it("reports blank pages and empty text boxes without crying wolf on frames", () => {
    assert.deepEqual(kinds([page([])]), ["empty-page"]);
    assert.deepEqual(kinds([page([el({ content: "" })])]), ["empty-page"]);
    // A filled card frame is decoration, not a forgotten caption.
    assert.deepEqual(
      kinds([
        page([
          el({ content: "", style: { fill: "#fff" } }),
          el({ id: "t2", content: "ب" }),
        ]),
      ]),
      [],
    );
    const mixed = runPreflight([
      page([el({ id: "t1", content: "نص" }), el({ id: "t2", content: "   " })]),
    ]);
    assert.equal(
      mixed.issues.find((i) => i.kind === "empty-text")?.elementIds[0],
      "t2",
    );
    // A deliberately blank verso can be excused.
    assert.deepEqual(kinds([page([])], { ignoreEmptyPages: true }), []);
  });

  it("names the braces that will never become a value", () => {
    const report = runPreflight([
      page([el({ content: "التقرير {غير_معروف} و{اسم_الجهة}" })]),
    ]);
    const stray = report.issues.find((i) => i.kind === "unresolved-token");
    assert.ok(stray);
    assert.match(stray.detail, /\{غير_معروف\}/);
    // A recognised macro is resolved at render and therefore not reported.
    assert.deepEqual(kinds([page([el({ content: "{اسم_الجهة}" })])]), []);
  });

  it("resolves page macros per page, so page 2 does not report page 1", () => {
    setTextContext({ orgName: "أمانة الحدود الشمالية" });
    const withMacro = (id: string) =>
      el({ id, content: "{رقم_الصفحة_من_الكل}", h: 10 });
    const pages = [
      page([withMacro("a")], { id: "p1", name: "الأولى" }),
      page([withMacro("b")], { id: "p2", name: "الثانية" }),
    ];
    const report = runPreflight(pages);
    assert.equal(report.clean, true);
    assert.equal(issuesOf(report, "error").length, 0);
  });

  it("summarises counts per severity", () => {
    const report = runPreflight([page([]), page([])]);
    assert.deepEqual(report.counts, { error: 0, warning: 0, info: 2 });
    assert.equal(preflightSummary(report), "2 ملاحظة");
  });
});
