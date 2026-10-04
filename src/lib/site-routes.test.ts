import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADMIN_ROUTES,
  ADMIN_SECTIONS,
  CREATE_ROUTE,
  EDITOR_ROUTE,
  LEGACY_ROUTE_REDIRECTS,
  TEMPLATES_ROUTE,
  createPathFor,
  editorPathFor,
  legacyRedirectFor,
  projectPathFor,
  templatePathFor,
  templatePreviewPathFor,
  templateSharePathFor,
  templateShortPathFor,
  sharedShortPathFor,
  sharedTemplatePathFor,
} from "./site-routes.ts";

test("homepage Templates actions target the canonical Templates path (no trailing-slash redirect)", () => {
  assert.equal(TEMPLATES_ROUTE, "/templates");
  assert.ok(!TEMPLATES_ROUTE.endsWith("/"));
});

test("every important destination is its own URL, and none of them is the editor", () => {
  const destinations = [
    CREATE_ROUTE,
    projectPathFor("p1"),
    templatePathFor("tpl"),
    templatePreviewPathFor("tpl"),
    templateSharePathFor("tpl"),
    ...Object.values(ADMIN_ROUTES),
  ];
  for (const path of destinations) {
    assert.ok(path.startsWith("/"), `${path} must be an absolute path`);
    assert.notEqual(path, EDITOR_ROUTE, `${path} must not fall back to the editor`);
  }
  // One address per section: two admin functions never share a URL.
  const adminPaths = Object.values(ADMIN_ROUTES);
  assert.equal(new Set(adminPaths).size, adminPaths.length);
});

test("the editor address always names the document it opens", () => {
  assert.equal(editorPathFor("abc"), "/editor/abc");
  assert.equal(projectPathFor("abc"), "/projects/abc");
  assert.notEqual(editorPathFor("abc"), projectPathFor("abc"));
  assert.ok(editorPathFor("مشروع 2026").startsWith("/editor/"));
  assert.ok(!editorPathFor("مشروع 2026").includes(" "));
});

test("a creation URL can carry the chosen format", () => {
  assert.equal(createPathFor(), "/create");
  assert.equal(createPathFor({ start: "template", template: "official" }), "/create?start=template&template=official");
});

test("every admin section in the navigation points at a registered admin route", () => {
  const registered = new Set<string>(Object.values(ADMIN_ROUTES));
  for (const section of ADMIN_SECTIONS) {
    assert.ok(registered.has(section.to), `${section.id} → ${section.to} must be a real route`);
    assert.equal(section.to, ADMIN_ROUTES[section.id]);
  }
  // Every registered route is navigable from the console, except the alias that
  // shares the dashboard address with its index route.
  const navigable = new Set(ADMIN_SECTIONS.map((section) => section.id));
  for (const id of Object.keys(ADMIN_ROUTES) as Array<keyof typeof ADMIN_ROUTES>) {
    assert.ok(navigable.has(id), `admin route «${id}» must appear in ADMIN_SECTIONS`);
  }
  assert.equal(new Set(ADMIN_SECTIONS.map((section) => section.to)).size, ADMIN_SECTIONS.length);
});

test("legacy addresses resolve to a canonical surface, never to the editor", () => {
  assert.equal(legacyRedirectFor("/home"), "/workspace");
  assert.equal(legacyRedirectFor("/brand-kit"), "/الهوية");
  assert.equal(legacyRedirectFor("/admin-dashboard"), ADMIN_ROUTES.templates);
  assert.equal(legacyRedirectFor("/admin-licenses"), ADMIN_ROUTES.licenses);
  assert.equal(legacyRedirectFor("/home/"), "/workspace");
  assert.equal(legacyRedirectFor("/nope"), null);
  for (const target of Object.values(LEGACY_ROUTE_REDIRECTS)) {
    assert.notEqual(target, EDITOR_ROUTE);
  }
});

test("short share links are real addresses, and the legacy shared path is not a 404", () => {
  assert.equal(templateShortPathFor("k7m2p9q"), "/t/k7m2p9q");
  assert.equal(sharedShortPathFor("k7m2p9q"), "/s/k7m2p9q");
  /* A code is never wrapped in a path that could escape it. */
  assert.equal(templateShortPathFor("../../admin"), null);
  assert.equal(sharedShortPathFor("k7m2p9q?x=1"), null);
  /* `/share/<token>` never existed as a route: the real one is under /templates. */
  assert.equal(sharedTemplatePathFor("abcdefghijklmnopqrstuv"), "/templates/share/abcdefghijklmnopqrstuv");
  assert.ok(!sharedTemplatePathFor("abcdefghijklmnopqrstuv").startsWith("/share/"));
});
