import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  clampZoom,
  stepZoom,
  screenToDocument,
  visibleDocumentRect,
  insertionPosition,
} from "./document-space";
import {
  DEFAULT_GRADIENT,
  normalizeGradient,
  gradientCss,
  gradientVector,
  gradientSvgDefinition,
  stopRgba,
} from "./gradient";
import {
  imageLayout,
  cropFromLocalBox,
  croppedFrame,
  normalizeCrop,
  imageCropTransform,
  cropSceneTransform,
  cropLocalPoint,
  cropPagePoint,
} from "./image-crop";
import { applySnap, applyResizeSnap } from "./transform";
import { createElement } from "./model";
import { createProject } from "./templates";
import { shapeSvgMarkup } from "./shape-render";
import { useEditor } from "./store";
import { getStorageOwner } from "./storage-owner";

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

for (const zoom of [0.01, 0.2, 1, 4, 16])
  test(`document/drop coordinates invert zoom ${zoom} and pan without changing artwork`, () => {
    const rect = {
      left: -432,
      top: -725,
      width: ((210 * 96) / 25.4) * zoom,
      height: ((297 * 96) / 25.4) * zoom,
    };
    const point = screenToDocument(
      rect,
      { w: 210, h: 297 },
      rect.left + (rect.width * 32.5) / 210,
      rect.top + (rect.height * 74.2) / 297,
    );
    near(point.x, 32.5);
    near(point.y, 74.2);
    const position = insertionPosition({ w: 40, h: 20 }, point);
    near(position.x + 20, point.x);
    near(position.y + 10, point.y);
  });

test("visible insertion converts actual screen pixels to document mm", () => {
  const viewport = { left: 0, top: 0, width: 600, height: 400 };
  const page = { left: -200, top: -500, width: 1600, height: 2400 };
  const visible = visibleDocumentRect(page, viewport, { w: 200, h: 300 })!;
  assert.deepEqual(visible, { x: 25, y: 62.5, w: 75, h: 50 });
  assert.equal(
    visibleDocumentRect({ ...page, left: 1000 }, viewport, { w: 200, h: 300 }),
    null,
  );
});

test("all zoom routes share practical bounds and relative steps", () => {
  assert.equal(clampZoom(0), 0.01);
  assert.equal(clampZoom(100), 16);
  assert.equal(clampZoom(NaN), 1);
  assert.ok(stepZoom(2, 1) > 2);
  near(stepZoom(stepZoom(4, 1), -1), 4);
});

test("multi-stop paint preserves alpha and shares non-square vectors", () => {
  const gradient = normalizeGradient({
    ...DEFAULT_GRADIENT,
    angle: -45,
    stops: [
      { id: "a", offset: 0, color: "#f008", opacity: 0.5 },
      { id: "b", offset: 0.3, color: "#123456", opacity: 0 },
      { id: "c", offset: 1, color: "#fff", opacity: 1 },
    ],
  })!;
  assert.equal(gradient.angle, 315);
  assert.equal(gradient.stops.length, 3);
  assert.equal(stopRgba(gradient.stops[0]), "rgba(255, 0, 0, 0.2667)");
  assert.match(gradientCss(gradient)!, /315deg.*30%/);
  const v = gradientVector(45, { w: 200, h: 100 });
  near(((v.x2 - v.x1) * 200) / ((v.y1 - v.y2) * 100), 1);
  const svg = gradientSvgDefinition(gradient, 'safe" onload="bad', {
    w: 200,
    h: 100,
  });
  assert.match(svg, /gradientUnits="userSpaceOnUse"/);
  assert.doesNotMatch(svg, /onload=/);
  assert.equal((svg.match(/<stop /g) || []).length, 3);
});

test("serialized compound shapes share the same gradient definition", () => {
  const svg = shapeSvgMarkup("rect", {
    fill: "#fff",
    stroke: "none",
    strokeUnits: 0,
    box: { w: 80, h: 40 },
    gradient: DEFAULT_GRADIENT,
    gradientId: "paint-1",
  });
  assert.match(svg, /<defs><linearGradient/);
  assert.match(svg, /fill="url\(#paint-1\)"/);
});

test("contain and cover preserve source aspect; crop is independent of resize", () => {
  const frame = { w: 80, h: 60 },
    source = { w: 1600, h: 800 };
  const cover = imageLayout(frame, source);
  const contain = imageLayout(frame, source, undefined, "contain");
  near(cover.w / cover.h, 2);
  near(contain.w / contain.h, 2);
  assert.deepEqual(
    { x: contain.x, y: contain.y, w: contain.w, h: contain.h },
    { x: 0, y: 10, w: 80, h: 40 },
  );
  const crop = cropFromLocalBox({ x: 20, y: 10, w: 40, h: 30 }, cover);
  near(crop.x, 1600 / 3);
  near(crop.y, 400 / 3);
  near(crop.w, 1600 / 3);
  near(crop.h, 400);
  assert.equal(normalizeCrop({ ...crop, w: NaN }), undefined);
});

test("cropped frame keeps rotated/flipped artwork in its visual position", () => {
  const frame = { x: 10, y: 20, w: 80, h: 40, rotation: 90 };
  const crop = { x: 0, y: 0, w: 40, h: 40 };
  const normal = croppedFrame(frame, crop);
  const mirrored = croppedFrame(frame, crop, true);
  near(normal.x, 30);
  near(normal.y, 0);
  near(mirrored.x, 30);
  near(mirrored.y, 40);
});

test("raw pointer intent reaches a 297mm page edge even with a 5mm grid", () => {
  const moving = { x: 256.8, y: 30, w: 40, h: 20, rotation: 0 };
  const guides = applySnap(moving, [], { w: 297, h: 210 }, true, true, 4);
  near(moving.x + moving.w, 297);
  assert.ok(guides.v.includes(297));
  const resize = { x: 10, y: 30, w: 286.8, h: 20 };
  const resizedGuides = applyResizeSnap(
    resize,
    "e",
    [],
    { w: 297, h: 210 },
    true,
    true,
    4,
  );
  near(resize.x, 10);
  near(resize.x + resize.w, 297);
  assert.ok(resizedGuides.v.includes(297));
});

function resetEditor() {
  const page = createProject("official").pages[0];
  page.elements = [];
  useEditor.setState({
    pages: [page],
    activePageId: page.id,
    selectedIds: [],
    selectedId: null,
    enteredGroupId: null,
    past: [],
    future: [],
    snapGrid: true,
  });
  useEditor.getState().commit();
  return page;
}

test("exact insertion, numeric geometry, axis nudges and dimension/aspect locks share existing history", () => {
  const page = resetEditor();
  useEditor
    .getState()
    .addElementAt(
      "shape",
      { x: undefined, y: undefined, w: 40, h: 20 },
      { x: 77.3, y: 88.7 },
      page.id,
    );
  const id = useEditor.getState().selectedId!;
  const read = () =>
    useEditor.getState().pages[0].elements.find((el) => el.id === id)!;
  near(read().x + read().w / 2, 77.3);
  near(read().y + read().h / 2, 88.7);
  useEditor.getState().updateElement(id, { x: 12.3, y: 18.7 });
  near(read().x, 12.3);
  near(read().y, 18.7);
  useEditor.getState().nudgeSelection(1, 0);
  near(read().x, 13.3);
  useEditor.getState().nudgeSelection(0, -1);
  near(read().y, 17.7);
  useEditor.getState().updateStyle(id, { aspectLock: true });
  useEditor.getState().updateElement(id, { w: 80 });
  near(read().h, 40);
  useEditor.getState().updateElement(id, { widthLocked: true });
  useEditor.getState().updateElement(id, { w: 120 });
  near(read().w, 80);
  useEditor.getState().updateElement(id, { locked: true });
  useEditor.getState().updateStyle(id, { fill: "#ff0000" });
  assert.notEqual(read().style.fill, "#ff0000");
});

test("page background is metadata behind every object and undoes atomically", () => {
  const page = resetEditor();
  useEditor.getState().setPageBackground(page.id, {
    bg: "#123456",
    bgGradient: DEFAULT_GRADIENT,
  });
  assert.equal(useEditor.getState().pages[0].elements.length, 0);
  assert.equal(useEditor.getState().pages[0].bgGradient?.stops.length, 2);
  useEditor.getState().setPageBackground(page.id, { bgImageX: 24, bgImageY: 76 });
  assert.equal(useEditor.getState().pages[0].bgImageX, 24);
  assert.equal(useEditor.getState().pages[0].bgImageY, 76);
  useEditor.getState().undo();
  assert.equal(useEditor.getState().pages[0].bgImageX, undefined);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().pages[0].bg, "#123456");
  assert.equal(useEditor.getState().pages[0].bgImageY, 76);
});

test("new pages use an explicit size; inherit copies dimensions only and duplicate copies content", () => {
  const source = resetEditor();
  const owner = getStorageOwner();
  useEditor.setState({
    hydrated: true,
    sessionOwner: owner,
    entitlementsOwner: owner,
    entitlementsResolved: true,
    entitlements: {
      ...useEditor.getState().entitlements,
      unlimited_pages: true,
    },
  });
  source.w = 297;
  source.h = 210;
  source.elements = [
    createElement("shape", {
      id: "source-shape",
      x: 24,
      y: 30,
      w: 50,
      h: 24,
      z: 1,
    }),
  ];
  useEditor.setState({ pages: [source], activePageId: source.id });
  useEditor.getState().setPageBackground(source.id, {
    bg: "#e8f0e8",
    bgGradient: DEFAULT_GRADIENT,
  });

  useEditor.getState().addPage();
  const presetPage = useEditor.getState().pages[1];
  assert.deepEqual([presetPage.w, presetPage.h], [210, 297]);
  assert.notEqual(presetPage.bg, "#e8f0e8");
  assert.equal(presetPage.bgGradient, undefined);
  assert.deepEqual(presetPage.elements, []);

  useEditor.getState().setActivePage(source.id);
  useEditor.getState().addPage({ mode: "inherit" });
  const inherited = useEditor.getState().pages[1];
  assert.deepEqual([inherited.w, inherited.h], [297, 210]);
  assert.notEqual(inherited.bg, "#e8f0e8");
  assert.equal(inherited.bgGradient, undefined);
  assert.deepEqual(inherited.elements, []);

  useEditor.getState().duplicatePage(source.id);
  const duplicate = useEditor.getState().pages.find(
    (page) => page.id === useEditor.getState().activePageId,
  )!;
  assert.notEqual(duplicate.id, source.id);
  assert.deepEqual([duplicate.w, duplicate.h], [297, 210]);
  assert.equal(duplicate.bg, "#e8f0e8");
  assert.deepEqual(duplicate.bgGradient, DEFAULT_GRADIENT);
  assert.equal(duplicate.elements.length, 1);
  assert.notEqual(duplicate.elements[0].id, source.elements[0].id);
});

test("90-degree smart snapping uses visible bounds, not the unrotated model box", () => {
  const element = { x: 50.2, y: 30, w: 40, h: 20 };
  const guides = applySnap(
    element,
    [],
    { w: 80, h: 210 },
    false,
    true,
    4,
    {},
    90,
  );
  near(element.x, 50);
  assert.ok(guides.v.includes(80));
});

test("crop follows rotated/flipped groups and preserves every cropped corner", () => {
  const child = createElement("image", {
    id: "photo",
    x: 20,
    y: 10,
    w: 40,
    h: 20,
    rotation: 30,
    style: { flipY: true },
  });
  const parent = createElement("group", {
    id: "folder",
    x: 10,
    y: 20,
    w: 100,
    h: 80,
    rotation: 90,
    style: { flipX: true },
    children: [child],
  });
  const matrix = imageCropTransform([parent], child.id)!;
  const centre = cropPagePoint(matrix, { x: 20, y: 10 });
  near(centre.x, 80);
  near(centre.y, 70);
  const source = { x: 3.4, y: 8.7 },
    roundTrip = cropLocalPoint(matrix, cropPagePoint(matrix, source));
  near(roundTrip.x, source.x);
  near(roundTrip.y, source.y);
  const box = { x: 10, y: 2, w: 20, h: 10 };
  const frame = croppedFrame(child, box, child.style.flipX, child.style.flipY);
  const after = imageCropTransform(
    [{ ...parent, children: [{ ...child, ...frame }] }],
    child.id,
  )!;
  for (const point of [
    { x: 0, y: 0 },
    { x: box.w, y: box.h },
  ]) {
    const expected = cropPagePoint(matrix, {
      x: point.x + box.x,
      y: point.y + box.y,
    });
    const actual = cropPagePoint(after, point);
    near(actual.x, expected.x);
    near(actual.y, expected.y);
  }
});

test("small artboards centre the final constrained frame at the explicit drop", () => {
  const page = resetEditor();
  useEditor.setState({ pages: [{ ...page, w: 12, h: 16 }] });
  const element = useEditor
    .getState()
    .addElementAt("shape", { w: 60, h: 40 }, { x: 6, y: 8 }, page.id)!;
  near(element.x + element.w / 2, 6);
  near(element.y + element.h / 2, 8);
});

test("multi-part library clicks rebase preset XY and create one undo step", () => {
  resetEditor();
  const before = useEditor.getState().past.length;
  const ids = useEditor.getState().insertLibraryElements({
    items: [
      { type: "shape", over: { x: 999, y: 999, w: 20, h: 20 } },
      {
        type: "shape",
        dx: 30,
        dy: 10,
        over: { x: -999, y: -999, w: 20, h: 20 },
      },
    ],
  });
  const [a, b] = useEditor.getState().pages[0].elements;
  near(a.x + a.w / 2, 105);
  near(a.y + a.h / 2, 148.5);
  near(b.x - a.x, 30);
  near(b.y - a.y, 10);
  assert.equal(ids.length, 2);
  assert.equal(useEditor.getState().past.length, before + 1);
  useEditor.getState().undo();
  assert.equal(useEditor.getState().pages[0].elements.length, 0);
});

test("crop respects the existing isolated group editing scene", () => {
  const child = createElement("image", {
    id: "photo",
    x: 20,
    y: 10,
    w: 40,
    h: 20,
    rotation: 30,
    style: { flipY: true },
  });
  const parent = createElement("group", {
    id: "folder",
    x: 10,
    y: 20,
    w: 100,
    h: 80,
    rotation: 90,
    style: { flipX: true },
    children: [child],
  });
  const matrix = cropSceneTransform([parent], child.id, parent.id)!;
  const centre = cropPagePoint(matrix, { x: 20, y: 10 });
  near(centre.x, 50);
  near(centre.y, 40);
  const point = { x: 4, y: 8 },
    roundTrip = cropLocalPoint(matrix, cropPagePoint(matrix, point));
  near(roundTrip.x, point.x);
  near(roundTrip.y, point.y);
});
