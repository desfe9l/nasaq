import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getArtboardGridDimensions, splitArtboard } from "./artboard";
import type { Page } from "./model";

describe("artboard grid dimensions", () => {
  it("calculates 2 rows and 4 columns for 8 pages with cols=4", () => {
    const dim = getArtboardGridDimensions(8, 4);
    assert.equal(dim.rows, 2);
    assert.equal(dim.cols, 4);
  });

  it("handles empty or single page correctly", () => {
    assert.deepEqual(getArtboardGridDimensions(1, 3), { rows: 1, cols: 3 });
    assert.deepEqual(getArtboardGridDimensions(0, 2), { rows: 1, cols: 2 });
  });

  it("calculates ceiling for non-exact multiples", () => {
    const dim = getArtboardGridDimensions(5, 2);
    assert.equal(dim.rows, 3);
    assert.equal(dim.cols, 2);
  });
});

describe("splitArtboard", () => {
  const samplePage: Page = {
    id: "p-test-1",
    name: "صفحة التقرير 1",
    w: 200,
    h: 300,
    elements: [
      {
        id: "top-el",
        type: "text",
        name: "ترويسة",
        x: 10,
        y: 20,
        w: 100,
        h: 30,
        z: 1,
        rotation: 0,
        opacity: 1,
        style: {},
      },
      {
        id: "bottom-el",
        type: "box",
        name: "تذييل",
        x: 10,
        y: 200,
        w: 100,
        h: 40,
        z: 2,
        rotation: 0,
        opacity: 1,
        style: {},
      },
    ],
  };

  it("splits horizontally into two equal height pages and distributes elements", () => {
    const res = splitArtboard(samplePage, "horizontal");
    assert.equal(res.firstPage.w, 200);
    assert.equal(res.firstPage.h, 150);
    assert.equal(res.secondPage.w, 200);
    assert.equal(res.secondPage.h, 150);

    // Top element should be on first page
    assert.equal(res.firstPage.elements.length, 1);
    assert.equal(res.firstPage.elements[0].id, "top-el");
    assert.equal(res.firstPage.elements[0].y, 20);

    // Bottom element should be on second page with adjusted y
    assert.equal(res.secondPage.elements.length, 1);
    assert.equal(res.secondPage.elements[0].id, "bottom-el");
    // original y was 200, split line is 150 -> new y is 50
    assert.equal(res.secondPage.elements[0].y, 50);
  });

  it("splits vertically into two equal width pages and distributes elements", () => {
    const pageWithSides: Page = {
      id: "p-sides",
      name: "صفحة أفقية",
      w: 200,
      h: 100,
      elements: [
        {
          id: "left-el",
          type: "text",
          name: "يسار",
          x: 20,
          y: 10,
          w: 40,
          h: 20,
          z: 1,
          rotation: 0,
          opacity: 1,
          style: {},
        },
        {
          id: "right-el",
          type: "text",
          name: "يمين",
          x: 140,
          y: 10,
          w: 40,
          h: 20,
          z: 2,
          rotation: 0,
          opacity: 1,
          style: {},
        },
      ],
    };

    const res = splitArtboard(pageWithSides, "vertical");
    assert.equal(res.firstPage.w, 100);
    assert.equal(res.firstPage.h, 100);
    assert.equal(res.secondPage.w, 100);
    assert.equal(res.secondPage.h, 100);

    assert.equal(res.firstPage.elements.length, 1);
    assert.equal(res.firstPage.elements[0].id, "left-el");
    assert.equal(res.firstPage.elements[0].x, 20);

    assert.equal(res.secondPage.elements.length, 1);
    assert.equal(res.secondPage.elements[0].id, "right-el");
    // original x was 140, split line is 100 -> new x is 40
    assert.equal(res.secondPage.elements[0].x, 40);
  });
});
