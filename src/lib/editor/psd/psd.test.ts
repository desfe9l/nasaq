import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initializeCanvas, readPsd, writePsd } from "ag-psd";

import { applyAssetDecisions, importPsdBytes } from "./pipeline.ts";
import { assertPsdBytes, sanitizeLayerName } from "./security.ts";
import { resolvePsdFont } from "./fonts.ts";
import type { CanvasEl } from "../model.ts";

initializeCanvas(
  (() => {
    throw new Error("canvas is not used");
  }) as (width: number, height: number) => HTMLCanvasElement,
  ((width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: "srgb",
  })) as (width: number, height: number) => ImageData,
);

function solid(width: number, height: number, r: number, g: number, b: number, a = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width, height, data };
}

function checker(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const on = ((x >> 2) ^ (y >> 2)) & 1;
      data[i] = on ? 210 : 12;
      data[i + 1] = on ? 40 : 70;
      data[i + 2] = on ? 32 : 150;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function sampleFile() {
  return writePsd(
    {
      width: 800,
      height: 600,
      imageResources: {
        resolutionInfo: {
          horizontalResolution: 72,
          horizontalResolutionUnit: "PPI",
          widthUnit: "Inches",
          verticalResolution: 72,
          verticalResolutionUnit: "PPI",
          heightUnit: "Inches",
        },
      },
      children: [
        {
          name: "Backdrop",
          left: 0,
          top: 0,
          right: 800,
          bottom: 600,
          imageData: solid(800, 600, 7, 29, 61),
        },
        {
          name: "Group",
          children: [
            {
              name: "Photo",
              left: 40,
              top: 50,
              right: 200,
              bottom: 180,
              opacity: 0.4,
              blendMode: "multiply",
              clipping: true,
              imageData: checker(160, 130),
              effects: {
                dropShadow: [
                  {
                    enabled: true,
                    opacity: 0.5,
                    angle: 120,
                    distance: { units: "Pixels", value: 8 },
                    size: { units: "Pixels", value: 4 },
                    color: { r: 0, g: 0, b: 0 },
                  },
                ],
              },
            },
            {
              name: "Title",
              left: 40,
              top: 200,
              right: 420,
              bottom: 260,
              text: {
                text: "تقرير نَسَق",
                style: {
                  font: { name: "Tajawal-Bold" },
                  fontSize: 32,
                  fauxBold: true,
                  fillColor: { r: 198, g: 160, b: 90 },
                  tracking: 0,
                  leading: 40,
                },
                paragraphStyle: { justification: "right" },
              },
            },
            {
              name: "Badge",
              left: 300,
              top: 40,
              vectorFill: { type: "color", color: { r: 27, g: 77, b: 62 } },
              vectorOrigination: {
                keyDescriptorList: [
                  {
                    keyOriginType: 2,
                    keyOriginResolution: 72,
                    keyOriginShapeBoundingBox: {
                      top: { units: "Pixels", value: 40 },
                      left: { units: "Pixels", value: 300 },
                      bottom: { units: "Pixels", value: 120 },
                      right: { units: "Pixels", value: 380 },
                    },
                    keyOriginRRectRadii: {
                      topRight: { units: "Pixels", value: 8 },
                      topLeft: { units: "Pixels", value: 8 },
                      bottomLeft: { units: "Pixels", value: 8 },
                      bottomRight: { units: "Pixels", value: 8 },
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          name: "../etc/passwd",
          hidden: true,
          left: 10,
          top: 12,
          text: {
            text: "secret",
            style: {
              font: { name: "ComicSans" },
              fontSize: 14,
              fillColor: { r: 10, g: 20, b: 30 },
            },
          },
        },
        {
          name: "Levels",
          adjustment: { type: "brightness/contrast", brightness: 10, contrast: 5 },
        },
      ],
    },
    { noBackground: true },
  );
}

function flat(els: CanvasEl[], dx = 0, dy = 0): CanvasEl[] {
  const out: CanvasEl[] = [];
  for (const el of els) {
    const abs = { ...el, x: Math.round((el.x + dx) * 100) / 100, y: Math.round((el.y + dy) * 100) / 100 };
    out.push(abs);
    if (el.children) out.push(...flat(el.children, abs.x, abs.y));
  }
  return out;
}

describe("PSD → NASAQ", () => {
  it("rejects a file that is not a PSD and a hostile layer name", () => {
    assert.throws(() => assertPsdBytes(new Uint8Array([1, 2, 3, 4, 5, 6])), /PSD/);
    assert.equal(sanitizeLayerName("../etc/passwd", "طبقة"), "etc passwd");
    assert.equal(resolvePsdFont("ComicSans", false, false).status, "missing");
    assert.equal(resolvePsdFont("Tajawal-Bold", true, false).family, "Tajawal");
    assert.equal(resolvePsdFont("Arial", false, false).family, "Arial");
  });

  it("converts text, a photograph, a group and a solid into editable elements", async () => {
    const bytes = sampleFile();
    assert.equal(readPsd(bytes, { skipLayerImageData: true, skipCompositeImageData: true }).width, 800);
    const result = await importPsdBytes(bytes, "تقرير.psd");
    const page = result.project.pages[0]!;
    assert.equal(result.project.nativeFormat, 1);
    assert.equal(result.project.name, "تقرير");
    assert.ok(Math.abs((page.w || 0) - 282.22) < 0.05);
    assert.ok(Math.abs((page.h || 0) - 211.67) < 0.05);
    assert.equal(result.validation.ok, true, JSON.stringify(result.validation.issues));

    const elements = flat(page.elements);
    const backdrop = elements.find((el) => el.name === "Backdrop");
    const photo = elements.find((el) => el.name === "Photo");
    const title = elements.find((el) => el.name === "Title");
    const badge = elements.find((el) => el.name === "Badge");
    const hidden = elements.find((el) => el.source?.layerName.includes("passwd") || el.content === "secret");
    assert.equal(backdrop?.type, "shape");
    assert.equal(backdrop?.style.fill, "#071d3d");
    assert.equal(photo?.type, "image");
    assert.equal(photo?.opacity, 0.4);
    assert.equal(photo?.style.blendMode, "multiply");
    assert.match(photo?.src || "", /^data:image\/png;base64,/);
    assert.ok(photo?.style.shadow);
    assert.equal(title?.type, "text");
    assert.equal(title?.content, "تقرير نَسَق");
    assert.equal(title?.style.fontFamily, "Tajawal");
    assert.equal(title?.style.fontWeight, 700);
    assert.equal(title?.style.textAlign, "right");
    assert.equal(title?.style.direction, "rtl");
    assert.equal(title?.style.color, "#c6a05a");
    assert.equal(badge?.type, "shape");
    assert.equal(badge?.style.fill, "#1b4d3e");
    assert.equal(hidden?.hidden, true);
    assert.equal(hidden?.style.fontFamily, "ComicSans");
    assert.equal(hidden?.style.direction, "ltr");
    assert.ok(result.report.fallbacks.some((item) => item.layerName === "Levels"));
    assert.equal(result.report.fonts.find((font) => font.fontName === "ComicSans")?.status, "missing");
    assert.equal(result.report.fonts.find((font) => font.family === "Tajawal")?.status, "library");
    assert.equal(result.report.groupCount, 1);
    assert.equal(result.report.textCount, 2);
    assert.ok(result.report.imageCount >= 1);
    assert.ok(result.report.completion > 50);
    const group = page.elements.find((el) => el.type === "group");
    const rawPhoto = group?.children?.find((el) => el.name === "Photo");
    assert.ok(group?.children && group.children.length >= 2);
    assert.ok(rawPhoto);
    assert.ok(rawPhoto.x >= 0 && rawPhoto.x < (group?.w || 0));
    assert.ok(Math.abs((photo?.x || 0) - ((group?.x || 0) + rawPhoto.x)) < 0.05);
  });

  it("matches an extracted image to the library by hash and does not queue a duplicate", async () => {
    const bytes = sampleFile();
    const first = await importPsdBytes(bytes, "one.psd");
    const asset = first.report.assets[0];
    assert.ok(asset);
    const second = await importPsdBytes(bytes, "two.psd", [
      { hash: asset.hash, assetId: "asset-existing", name: "صورة محفوظة" },
    ]);
    assert.equal(second.report.assets[0]?.match?.assetId, "asset-existing");
    const applied = applyAssetDecisions(
      second.project,
      second.report.assets,
      [{ hash: asset.hash, disposition: "library" }],
      new Map([["asset-existing", "data:image/png;base64,QQ=="]]),
    );
    assert.equal(applied.saves.length, 0);
    const photo = flat(applied.project.pages[0]!.elements).find((el) => el.name === "Photo");
    assert.equal(photo?.src, "data:image/png;base64,QQ==");
    const fresh = applyAssetDecisions(
      first.project,
      first.report.assets,
      [{ hash: asset.hash, disposition: "library", folderId: "folder-psd" }],
      new Map(),
    );
    assert.equal(fresh.saves.length, 1);
    assert.equal(fresh.saves[0]?.folderId, "folder-psd");
    assert.equal(fresh.saves[0]?.hash, asset.hash);
  });

  it("keeps a multi-layer file ordered and reports a moved element", async () => {
    const children = [];
    for (let i = 0; i < 24; i++) {
      children.push({
        name: `طبقة ${i}`,
        left: 8 + i,
        top: 10 + i * 2,
        right: 40 + i,
        bottom: 30 + i * 2,
        imageData: solid(32, 20, i * 8, 40, 90),
      });
    }
    children.push({
      name: "سطر",
      left: 20,
      top: 40,
      right: 200,
      bottom: 80,
      text: {
        text: "Hello NASAQ",
        style: { font: { name: "Cairo" }, fontSize: 18, fillColor: { r: 0, g: 0, b: 0 } },
        paragraphStyle: { justification: "left" },
      },
    });
    const bytes = writePsd({ width: 400, height: 300, children: children as never }, { noBackground: true });
    const result = await importPsdBytes(bytes, "stack.psd");
    assert.equal(result.validation.ok, true, JSON.stringify(result.validation.issues.filter((i) => i.severity === "error")));
    const page = result.project.pages[0]!;
    const zs = page.elements.map((el) => el.z);
    const sorted = [...zs].sort((a, b) => a - b);
    assert.deepEqual(zs, sorted);
    assert.ok(result.report.layerCount >= 25);
    const moved = structuredClone(result.project);
    const target = moved.pages[0]!.elements.find((el) => el.type === "shape");
    assert.ok(target);
    target.x += 20;
    const { validateConversion } = await import("./validate.ts");
    const { parsePsd } = await import("./parse.ts");
    const again = validateConversion(await parsePsd(bytes, "stack.psd"), moved);
    assert.ok(again.issues.some((issue) => issue.code === "position"));
  });
});
