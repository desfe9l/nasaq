import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initializeCanvas, readPsd, writePsd } from "ag-psd";

import { applyAssetDecisions, importPsdBytes } from "./pipeline.ts";
import { importTemplateBytes } from "../import/run.ts";
import { placedFlip } from "./parse.ts";
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

  it("is reached through the one canonical import service", async () => {
    const bytes = sampleFile();
    const direct = await importPsdBytes(bytes, "تقرير.psd");
    const viaService = await importTemplateBytes(bytes, "تقرير.psd", { worker: false });
    assert.equal(viaService.format, "psd");
    assert.ok(viaService.psd, "the PSD report must survive the canonical path");
    assert.equal(viaService.project.pages.length, direct.project.pages.length);
    assert.equal(viaService.stats.pages, direct.project.pages.length);
    assert.equal(viaService.stats.texts, direct.report.textCount);
    assert.equal(viaService.psd!.validation.ok, true);
    assert.equal(
      viaService.previewDataUrl,
      direct.project.thumbnail || direct.compositeDataUrl || null,
    );
    assert.equal(viaService.notes.length, direct.report.fallbacks.length);
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

  it("applies raster masks and keeps editable Photoshop effects as native styles", async () => {
    const maskedData = solid(8, 4, 220, 40, 30);
    const maskData = solid(8, 4, 255, 255, 255);
    for (let i = 0; i < 4; i += 1) {
      maskData.data[i * 4] = 0;
      maskData.data[i * 4 + 1] = 0;
      maskData.data[i * 4 + 2] = 0;
    }
    const bytes = writePsd({
      width: 80,
      height: 40,
      children: [
        {
          name: "Masked photo",
          left: 0,
          top: 0,
          right: 8,
          bottom: 4,
          imageData: maskedData,
          mask: { left: 0, top: 0, right: 8, bottom: 4, defaultColor: 255, imageData: maskData },
        },
        {
          name: "Vector gradient",
          left: 58,
          top: 0,
          right: 78,
          bottom: 20,
          vectorFill: {
            type: "solid",
            name: "violet",
            style: "linear",
            angle: 90,
            colorStops: [
              { location: 0, midpoint: 0.5, color: { r: 25, g: 40, b: 120 } },
              { location: 4096, midpoint: 0.5, color: { r: 230, g: 180, b: 70 } },
            ],
            opacityStops: [
              { location: 0, midpoint: 0.5, opacity: 1 },
              { location: 4096, midpoint: 0.5, opacity: 1 },
            ],
          },
          vectorOrigination: {
            keyDescriptorList: [{
              keyOriginType: 1,
              keyOriginResolution: 72,
              keyOriginShapeBoundingBox: {
                top: { units: "Pixels", value: 0 },
                left: { units: "Pixels", value: 58 },
                bottom: { units: "Pixels", value: 20 },
                right: { units: "Pixels", value: 78 },
              },
            }],
          },
        },
        {
          name: "Bezier path",
          left: 20,
          top: 10,
          right: 40,
          bottom: 30,
          vectorFill: { type: "color", color: { r: 30, g: 90, b: 60 } },
          vectorMask: {
            paths: [{
              open: false,
              fillRule: "non-zero",
              operation: "combine",
              knots: [
                { linked: true, points: [20, 10, 20, 10, 20, 10] },
                { linked: true, points: [40, 10, 40, 10, 40, 10] },
                { linked: true, points: [30, 30, 30, 30, 30, 30] },
              ],
            }],
          },
        },
        {
          name: "Effects",
          left: 12,
          top: 0,
          right: 52,
          bottom: 30,
          imageData: checker(40, 30),
          effects: {
            innerShadow: [{ enabled: true, opacity: 0.4, angle: 90, distance: { units: "Pixels", value: 2 }, size: { units: "Pixels", value: 3 }, color: { r: 0, g: 0, b: 0 } }],
            outerGlow: { enabled: true, opacity: 0.6, size: { units: "Pixels", value: 5 }, color: { r: 255, g: 230, b: 170 } },
            innerGlow: { enabled: true, opacity: 0.25, size: { units: "Pixels", value: 2 }, color: { r: 255, g: 255, b: 255 } },
            bevel: { enabled: true, size: { units: "Pixels", value: 2 }, highlightColor: { r: 255, g: 255, b: 255 }, shadowColor: { r: 0, g: 0, b: 0 }, highlightOpacity: 0.5, shadowOpacity: 0.4 },
            stroke: [{ enabled: true, fillType: "color", size: { units: "Pixels", value: 2 }, color: { r: 198, g: 160, b: 90 } }],
            gradientOverlay: [{
              enabled: true,
              opacity: 0.7,
              type: "linear",
              angle: 45,
              blendMode: "screen",
              gradient: {
                type: "solid",
                name: "gold",
                colorStops: [
                  { location: 0, midpoint: 0.5, color: { r: 10, g: 20, b: 30 } },
                  { location: 4096, midpoint: 0.5, color: { r: 220, g: 180, b: 90 } },
                ],
                opacityStops: [
                  { location: 0, midpoint: 0.5, opacity: 1 },
                  { location: 4096, midpoint: 0.5, opacity: 1 },
                ],
              },
            }],
          },
        },
      ] as never,
    }, { noBackground: true });
    const imported = await importPsdBytes(bytes, "effects.psd");
    const elements = flat(imported.project.pages[0]!.elements);
    const masked = elements.find((el) => el.name === "Masked photo");
    const styled = elements.find((el) => el.name === "Effects");
    const vectorGradient = elements.find((el) => el.name === "Vector gradient");
    const bezier = elements.find((el) => el.name === "Bezier path");
    assert.equal(vectorGradient?.type, "shape");
    assert.ok(vectorGradient?.style.gradient?.stops.length === 2);
    assert.equal(vectorGradient?.style.gradient?.stops[1]?.offset, 1);
    assert.equal(bezier?.type, "svg");
    assert.match(bezier?.content || "", /<path[^>]+d="M20 10 C20 10 40 10 40 10/);
    assert.match(bezier?.content || "", /#1e5a3c/);
    assert.equal(masked?.type, "image");
    assert.match(masked?.src || "", /^data:image\/png;base64,/);
    assert.ok(masked?.source?.reason?.includes("قناع"));
    assert.equal(styled?.type, "image");
    assert.ok(styled?.style.shadow?.includes("inset"));
    assert.ok(styled?.style.shadow?.includes("rgba"));
    assert.ok(styled?.style.gradient?.stops.length === 2);
    assert.equal(styled?.style.gradientBlendMode, "screen");
    assert.equal(styled?.style.borderColor, "#c6a05a");
    assert.ok(imported.report.fallbacks.some((item) => item.layerName === "Masked photo" && /قناع/.test(item.reason)));
    assert.ok(imported.report.fallbacks.some((item) => item.layerName === "Effects" && /تقريبياً/.test(item.reason)));
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

  it("scales text by its matrix and does not rotate a smart object from its corners", async () => {
    assert.deepEqual(placedFlip([300, 40, 100, 40, 100, 140, 300, 140]), { flipX: true, flipY: false });
    assert.deepEqual(placedFlip([100, 140, 300, 140, 300, 40, 100, 40]), { flipX: false, flipY: true });
    assert.deepEqual(placedFlip([100, 40, 300, 40, 300, 140, 100, 140]), { flipX: false, flipY: false });

    const bytes = writePsd(
      {
        width: 800,
        height: 600,
        children: [
          {
            name: "Logo",
            left: 400,
            top: 300,
            right: 560,
            bottom: 380,
            imageData: checker(160, 80),
            placedLayer: {
              id: "20953ddb-9391-11ec-b4f1-c15674f50bc4",
              type: "raster",
              transform: [400, 300, 560, 300, 560, 380, 400, 380],
              width: 160,
              height: 80,
            },
          },
          {
            name: "Scaled",
            text: {
              text: "عنوان الخبر",
              transform: [2, 0, 0, 2, 180, 90],
              style: {
                font: { name: "Tajawal-Bold" },
                fontSize: 12,
                fillColor: { r: 12, g: 20, b: 30 },
              },
              paragraphStyle: { justification: "right" },
            },
          },
          {
            name: "Boxed",
            left: 40,
            top: 50,
            right: 240,
            bottom: 90,
            text: {
              text: "نَسَق",
              transform: [2, 0, 0, 2, 0, 0],
              style: {
                font: { name: "Tajawal" },
                fontSize: 11,
                fillColor: { r: 0, g: 0, b: 0 },
              },
              paragraphStyle: { justification: "right" },
            },
          },
        ],
      },
      { noBackground: true },
    );
    const result = await importPsdBytes(bytes, "fidelity.psd");
    const elements = flat(result.project.pages[0]!.elements);
    const logo = elements.find((el) => el.name === "Logo");
    const scaled = elements.find((el) => el.name === "Scaled");
    const boxed = elements.find((el) => el.name === "Boxed");
    assert.equal(logo?.type, "image");
    assert.equal(logo?.rotation || 0, 0);
    assert.equal(logo?.style.flipX, undefined);
    assert.ok(Math.abs((logo?.x || 0) - (400 * 25.4) / 72) < 0.2);
    assert.equal(scaled?.style.fontSize, 24);
    assert.equal(scaled?.style.direction, "rtl");
    assert.equal(scaled?.style.textAlign, "right");
    assert.ok((scaled?.x || 0) > 5, `scaled text piled at the origin: ${scaled?.x}`);
    assert.ok((scaled?.y || 0) > 5 && (scaled?.y || 0) < 40);
    assert.equal(boxed?.style.fontSize, 22);
    assert.ok(Math.abs((boxed?.x || 0) - (40 * 25.4) / 72) < 0.3);
    assert.equal(scaled?.style.overflowVisible, true);
    assert.equal(scaled?.style.textBoxMode, "fixed");
  });

  it("stamps the source geometry as the repair origin and repairs drift from it", async () => {
    const bytes = sampleFile();
    const result = await importPsdBytes(bytes, "repair.psd");
    const page = result.project.pages[0]!;

    // The report carries the source page size for the page-size check.
    assert.ok(Math.abs(result.report.pageSizesMm[0]!.w - 282.22) < 0.05);
    assert.ok(Math.abs(result.report.pageSizesMm[0]!.h - 211.67) < 0.05);

    const elements = flat(page.elements);
    const photo = elements.find((el) => el.name === "Photo");
    const backdrop = elements.find((el) => el.name === "Backdrop");
    const group = page.elements.find((el) => el.type === "group");
    // Every converted element knows where the file placed it — leaves in page
    // space, group members in group space, matching their own coordinates.
    assert.ok(photo?.source?.origin);
    assert.ok(photo.source?.px, "the raster layer's pixel size travels with it");
    assert.equal(photo.source!.px!.w, 160);
    assert.ok(group?.source?.origin);
    const rawPhoto = group?.children?.find((el) => el.name === "Photo");
    assert.ok(rawPhoto?.source?.origin);
    assert.ok(Math.abs(rawPhoto.source!.origin!.x - rawPhoto.x) < 0.02);
    assert.ok(Math.abs(rawPhoto.source!.origin!.y - rawPhoto.y) < 0.02);
    // A solid backdrop has an origin too even without pixels.
    assert.ok(backdrop?.source?.origin);

    // A clean import repairs to nothing…
    const { repairProject } = await import("../import/repair.ts");
    const clean = await repairProject(result.project, {
      pageSizes: result.report.pageSizesMm,
    });
    assert.equal(clean.fixes.length, 0);

    // …and a downstream geometry bug is detected and undone from the origin.
    const corrupted = structuredClone(result.project);
    const corruptedGroup = corrupted.pages[0]!.elements.find((el) => el.type === "group");
    const victim = corruptedGroup?.children?.find((el) => el.name === "Photo");
    assert.ok(victim);
    victim.x = 500;
    victim.y = -300;
    victim.w = 12;
    victim.h = 260;
    const repaired = await repairProject(corrupted, {
      pageSizes: result.report.pageSizesMm,
    });
    const fixedGroup = repaired.project.pages[0]!.elements.find((el) => el.type === "group");
    const fixed = fixedGroup?.children?.find((el) => el.name === "Photo");
    assert.ok(fixed);
    assert.ok(Math.abs(fixed.x - (victim.source?.origin?.x ?? -1)) < 0.02);
    assert.ok(Math.abs(fixed.w - (victim.source?.origin?.w ?? -1)) < 0.02);
    assert.ok(repaired.fixes.some((fix) => fix.kind === "position" || fix.kind === "bounds"));
    assert.ok(repaired.fixes.some((fix) => fix.kind === "image"));
    // The corrupted input is never mutated.
    assert.equal(victim.x, 500);
  });

  it("rescales a page whose conversion lost the document size", async () => {
    const bytes = sampleFile();
    const result = await importPsdBytes(bytes, "size.psd");
    const { repairProject } = await import("../import/repair.ts");

    // Page dimensions alone were lost: the content already sits at the right
    // absolute size, so only the page is corrected and elements stay put.
    const lost = structuredClone(result.project);
    lost.pages[0]!.w = 141.11;
    lost.pages[0]!.h = 105.84;
    const fixedPage = await repairProject(lost, { pageSizes: result.report.pageSizesMm });
    assert.ok(fixedPage.fixes.some((fix) => fix.kind === "page"));
    assert.ok(Math.abs((fixedPage.project.pages[0]!.w || 0) - 282.22) < 0.05);
    const backdropBefore = flat(lost.pages[0]!.elements).find((el) => el.name === "Backdrop");
    const backdropAfter = flat(fixedPage.project.pages[0]!.elements).find((el) => el.name === "Backdrop");
    assert.equal(backdropAfter?.w, backdropBefore?.w);
    const steady = await repairProject(fixedPage.project, { pageSizes: result.report.pageSizesMm });
    assert.equal(steady.fixes.length, 0);

    // The dpi mix-up: page AND content (and its stamped origins — the wrong
    // unit was applied consistently) were laid out for the wrong size, so
    // both rescale together and the composition survives.
    const dpiBug = structuredClone(result.project);
    const halve = (els: CanvasEl[]): void => {
      for (const el of els) {
        el.x = Math.round((el.x / 2) * 100) / 100;
        el.y = Math.round((el.y / 2) * 100) / 100;
        el.w = Math.round((el.w / 2) * 100) / 100;
        el.h = Math.round((el.h / 2) * 100) / 100;
        const origin = el.source?.origin;
        if (origin) {
          origin.x = Math.round((origin.x / 2) * 100) / 100;
          origin.y = Math.round((origin.y / 2) * 100) / 100;
          origin.w = Math.round((origin.w / 2) * 100) / 100;
          origin.h = Math.round((origin.h / 2) * 100) / 100;
        }
        if (el.children) halve(el.children);
      }
    };
    dpiBug.pages[0]!.w = 141.11;
    dpiBug.pages[0]!.h = 105.84;
    halve(dpiBug.pages[0]!.elements);
    const rescaled = await repairProject(dpiBug, { pageSizes: result.report.pageSizesMm });
    assert.ok(rescaled.fixes.some((fix) => fix.kind === "page"));
    assert.ok(Math.abs((rescaled.project.pages[0]!.w || 0) - 282.22) < 0.05);
    const restoredBackdrop = flat(rescaled.project.pages[0]!.elements).find((el) => el.name === "Backdrop");
    const originalBackdrop = flat(result.project.pages[0]!.elements).find((el) => el.name === "Backdrop");
    assert.ok(Math.abs((restoredBackdrop?.w || 0) - (originalBackdrop?.w || 0)) < 0.15);
    const settled = await repairProject(rescaled.project, { pageSizes: result.report.pageSizesMm });
    assert.equal(settled.fixes.length, 0);
  });
});
