/**
 * NASAQ surface navigation — routes stay reachable without an edge menu.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { NAV_ITEMS } from "../brand.ts";
import {
  EDITOR_SURFACE_IDS,
  EDITOR_SURFACE_NAV,
  NAV_TOUCH_TARGET,
  SITE_SURFACE_NAV,
  coversRoutes,
} from "./surface-nav.ts";

test("the site strip still reaches every public route", () => {
  assert.equal(coversRoutes(SITE_SURFACE_NAV, NAV_ITEMS), true);
  assert.equal(SITE_SURFACE_NAV.length, NAV_ITEMS.length);
  for (const item of SITE_SURFACE_NAV) {
    assert.equal(item.href, item.id);
    assert.ok(item.label.length > 0);
    assert.ok(item.shortLabel.length > 0);
    assert.ok(item.shortLabel.length <= item.label.length);
  }
});

test("editor navigation names each surface explicitly", () => {
  for (const id of [
    "library",
    "elements",
    "tools",
    "pages",
    "properties",
    "layers",
    "report",
  ]) {
    assert.ok(EDITOR_SURFACE_IDS.includes(id), id);
  }
  assert.equal(new Set(EDITOR_SURFACE_IDS).size, EDITOR_SURFACE_NAV.length);
  for (const item of EDITOR_SURFACE_NAV) {
    assert.equal(item.href, undefined);
    assert.ok(item.shortLabel.length > 0);
  }
});

test("touch targets stay at the practical finger size", () => {
  assert.ok(NAV_TOUCH_TARGET >= 44);
});

test("all existing editor tabs have Arabic, direct navigation", async () => {
  const { EDITOR_ELEMENT_TAB_IDS, isEditorElementTab } =
    await import("./surface-nav.ts");
  for (const id of [
    ...EDITOR_ELEMENT_TAB_IDS,
    "library",
    "tools",
    "properties",
    "layers",
    "report",
  ])
    assert.ok(EDITOR_SURFACE_IDS.includes(id), id);
  for (const tab of EDITOR_SURFACE_NAV)
    assert.match(tab.shortLabel, /^[\u0600-\u06ff\s]+$/u);
  assert.equal(isEditorElementTab("fonts"), true);
  assert.equal(isEditorElementTab("library"), false);
  assert.equal(isEditorElementTab("unknown"), false);
});

test("child tabs do not highlight Elements or closed windows", async () => {
  const { editorSurfaceActive } = await import("./surface-nav.ts");
  assert.equal(editorSurfaceActive("pages", "pages", { elements: true }), true);
  assert.equal(
    editorSurfaceActive("elements", "pages", { elements: true }),
    false,
  );
  assert.equal(
    editorSurfaceActive("fonts", "fonts", { elements: false }),
    false,
  );
  assert.equal(
    editorSurfaceActive("elements", "library", { elements: true }),
    true,
  );
  assert.equal(editorSurfaceActive("report", "fonts", { report: true }), true);
});
