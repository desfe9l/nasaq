import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_MAX_PAGES,
  exceedsProjectPageLimit,
  exceedsSavedProjectLimit,
  requiresPremiumPack,
  requiresLicensedTemplate,
  projectAccessBlock,
} from "./access-limits.ts";

const FREE = {
  premium_templates: false,
  unlimited_projects: false,
  unlimited_pages: false,
};
const LICENSED = {
  premium_templates: true,
  unlimited_projects: true,
  unlimited_pages: true,
};

test("page limits apply at the exact demo boundary and lift with entitlement", () => {
  assert.equal(DEMO_MAX_PAGES, 3);
  assert.equal(exceedsProjectPageLimit(3, FREE), false);
  assert.equal(exceedsProjectPageLimit(4, FREE), true);
  assert.equal(exceedsProjectPageLimit(40, LICENSED), false);
});

test("saved-project limits allow the first project and reject another", () => {
  assert.equal(exceedsSavedProjectLimit(0, FREE), false);
  assert.equal(exceedsSavedProjectLimit(1, FREE), true);
  assert.equal(exceedsSavedProjectLimit(50, LICENSED), false);
});

test("pack access is checked from the action layer, not only the catalog UI", () => {
  assert.equal(requiresPremiumPack("blank", FREE), false);
  assert.equal(requiresPremiumPack("official", FREE), true);
  assert.equal(requiresPremiumPack("official", LICENSED), false);
  assert.equal(requiresPremiumPack(undefined, FREE), false);
});


test("licensed Admin template provenance remains gated on project/file paths", () => {
  assert.equal(requiresLicensedTemplate("tpl-premium", FREE), true);
  assert.equal(requiresLicensedTemplate("tpl-premium", LICENSED), false);
  assert.equal(requiresLicensedTemplate(undefined, FREE), false);
});


test("project access combines premium lineage and page limits for file actions", () => {
  assert.equal(projectAccessBlock({ pages: [{}, {}, {}] }, FREE), null);
  assert.equal(projectAccessBlock({ pages: [{}, {}, {}, {}] }, FREE), "page-limit");
  assert.equal(
    projectAccessBlock({ licensedTemplateId: "tpl-premium", pages: [{}] }, FREE),
    "premium-template",
  );
  assert.equal(
    projectAccessBlock({ licensedTemplateId: "tpl-premium", pages: [{}] }, LICENSED),
    null,
  );
});
