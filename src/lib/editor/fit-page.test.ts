import test from "node:test";
import assert from "node:assert/strict";
import { fitBoxToPage } from "./fit-page.ts";

const A4 = { w: 210, h: 297 };

test("fill makes the box the page rectangle", () => {
  assert.deepEqual(fitBoxToPage({ w: 50, h: 20 }, A4, "fill"), {
    x: 0,
    y: 0,
    w: 210,
    h: 297,
  });
});

test("fit scales up to the page, keeps proportions and centres", () => {
  // A wide 2:1 box is limited by the page width.
  assert.deepEqual(fitBoxToPage({ w: 100, h: 50 }, A4, "fit"), {
    x: 0,
    y: 96,
    w: 210,
    h: 105,
  });
  // A tall box is limited by the page height.
  const tall = fitBoxToPage({ w: 10, h: 40 }, A4, "fit");
  assert.equal(tall.h, 297);
  assert.equal(tall.w, 74.25);
  assert.equal(tall.y, 0);
  assert.equal(tall.x, round2((210 - 74.25) / 2));
});

test("fit also shrinks a box larger than the page", () => {
  const r = fitBoxToPage({ w: 1000, h: 1000 }, A4, "fit");
  assert.equal(r.w, 210);
  assert.equal(r.h, 210);
  assert.equal(r.x, 0);
});

test("degenerate sizes never produce NaN", () => {
  const r = fitBoxToPage({ w: 0, h: 0 }, A4, "fit");
  assert.ok(Number.isFinite(r.w) && Number.isFinite(r.h));
  assert.ok(r.w > 0 && r.h > 0);
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
