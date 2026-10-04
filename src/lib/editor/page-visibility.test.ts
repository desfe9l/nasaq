import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SHOW_OUTSIDE_PAGE_DEFAULT,
  normalizeShowOutsidePage,
  pageClipClass,
  pageClipsView,
} from "./page-visibility.ts";

test("out-of-page artwork is visible by default", () => {
  assert.equal(SHOW_OUTSIDE_PAGE_DEFAULT, true);
  assert.equal(pageClipsView({}, undefined), false);
  assert.equal(pageClipsView({ clipContent: false }, true), false);
  assert.equal(pageClipClass({}, undefined), "");
});

test("hiding is a view preference: the global switch clips every page", () => {
  assert.equal(pageClipsView({}, false), true);
  assert.equal(pageClipsView({ clipContent: false }, false), true);
  assert.equal(pageClipClass({}, false), "is-clip-view");
});

test("a per-page override still clips while the global preference shows", () => {
  assert.equal(pageClipsView({ clipContent: true }, true), true);
  assert.equal(pageClipClass({ clipContent: true }, true), "is-clip-view");
});

test("only an explicit false hides — a corrupt preference never swallows artwork", () => {
  assert.equal(normalizeShowOutsidePage(false), false);
  assert.equal(normalizeShowOutsidePage(true), true);
  assert.equal(normalizeShowOutsidePage(undefined), true);
  assert.equal(normalizeShowOutsidePage(null), true);
  assert.equal(normalizeShowOutsidePage("nope"), true);
  assert.equal(normalizeShowOutsidePage("off"), false);
  assert.equal(normalizeShowOutsidePage(0 as unknown as boolean), true);
  assert.equal(pageClipsView(null, undefined), false);
});
