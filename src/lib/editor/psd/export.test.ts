import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exportPsd } from "./export.ts";
import type { Project, CanvasEl } from "../model.ts";

function makeTextEl(content: string, textRuns?: any[]): CanvasEl {
  return {
    id: "text-1",
    type: "text",
    name: "Text",
    x: 10, y: 10, w: 50, h: 20,
    rotation: 0, opacity: 1, z: 1,
    content,
    style: {
      fontFamily: "Tajawal",
      fontSize: 16,
      color: "#000000",
      textAlign: "right" as const,
    },
    ...(textRuns ? { textRuns } : {}),
  };
}

function makeImageEl(): CanvasEl {
  return {
    id: "img-1",
    type: "image",
    name: "Image",
    x: 0, y: 0, w: 100, h: 100,
    rotation: 0, opacity: 1, z: 1,
    src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    style: {},
  };
}

function makeShapeEl(): CanvasEl {
  return {
    id: "shape-1",
    type: "shape",
    name: "Shape",
    x: 20, y: 20, w: 60, h: 40,
    rotation: 0, opacity: 1, z: 1,
    style: { fill: "#006c35", shape: "rect" as const },
  };
}

function makeProject(elements: CanvasEl[]): Project {
  return {
    version: 2,
    nativeFormat: 1,
    name: "Test",
    theme: "official" as const,
    orgName: "",
    transactionNo: "",
    pages: [{ id: "p1", name: "Page 1", w: 210, h: 297, elements }],
    createdAt: Date.now(),
  };
}

describe("PSD export", () => {
  it("exports a basic text element", async () => {
    const result = await exportPsd(makeProject([makeTextEl("مرحبا")]));
    assert.ok(result.buffer);
    assert.ok(result.buffer.length > 0);
    assert.equal(result.report.layersExported, 1);
  });

  it("exports an image element", async () => {
    const result = await exportPsd(makeProject([makeImageEl()]));
    assert.ok(result.buffer);
    assert.equal(result.report.layersExported, 1);
  });

  it("exports a shape element", async () => {
    const result = await exportPsd(makeProject([makeShapeEl()]));
    assert.ok(result.buffer);
    assert.equal(result.report.layersExported, 1);
  });

  it("exports a group with children", async () => {
    const result = await exportPsd(makeProject([
      {
        id: "g1",
        type: "group",
        name: "Group",
        x: 0, y: 0, w: 100, h: 100,
        rotation: 0, opacity: 1, z: 1,
        style: {},
        children: [makeTextEl(" nested ")],
      },
    ]));
    assert.ok(result.buffer);
    // Group is one top-level layer; children are nested inside it
    assert.equal(result.report.layersExported, 1);
  });

  it("handles empty project", async () => {
    const result = await exportPsd(makeProject([]));
    assert.ok(result.buffer);
    assert.equal(result.report.layersExported, 0);
  });
});
