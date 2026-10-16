/**
 * Leave-guard click classification.
 *
 * The regression these tests pin: an export download (a `blob:` URL with the
 * `download` attribute) is same-origin, so the guard treated it as an internal
 * link — it cancelled the download and navigated the tab to the raw file,
 * losing the editor without writing a file.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { leaveClickTarget } from "./leave-links.ts";

const CURRENT = "http://127.0.0.1:8080/editor/proj-1";

test("an export download is never a leave target", () => {
  // The exact shape `downloadBlob` clicks for PNG/PDF/NSQ/JSON exports.
  assert.equal(
    leaveClickTarget({
      href: "blob:http://127.0.0.1:8080/37eed960-39bc-4d76-813d-60a57584c44b",
      download: true,
      target: null,
      currentHref: CURRENT,
    }),
    null,
  );
});

test("blob:, data: and other file schemes are not routes", () => {
  for (const href of [
    "blob:http://127.0.0.1:8080/plate-4",
    "data:text/plain,hello",
    "filesystem:http://127.0.0.1:8080/temporary/x.png",
  ]) {
    assert.equal(
      leaveClickTarget({ href, download: false, target: null, currentHref: CURRENT }),
      null,
      `${href} must be left to the browser`,
    );
  }
});

test("external, fragment, mail and tel links are not leave targets", () => {
  assert.equal(
    leaveClickTarget({
      href: "https://example.com/page",
      download: false,
      target: null,
      currentHref: CURRENT,
    }),
    null,
  );
  for (const href of ["#section", "mailto:a@b.test", "tel:+96512345", ""]) {
    assert.equal(
      leaveClickTarget({ href, download: false, target: null, currentHref: CURRENT }),
      null,
      `${href || "(empty)"} is not in-app navigation`,
    );
  }
});

test("_blank links are left to the browser even on this origin", () => {
  assert.equal(
    leaveClickTarget({
      href: "/workspace",
      download: false,
      target: "_blank",
      currentHref: CURRENT,
    }),
    null,
  );
});

test("a link to the page already open is not leaving", () => {
  assert.equal(
    leaveClickTarget({
      href: "/editor/proj-1",
      download: false,
      target: null,
      currentHref: CURRENT,
    }),
    null,
  );
});

test("in-app route links stay intercepted for the unsaved-work prompt", () => {
  const workspace = leaveClickTarget({
    href: "/workspace",
    download: false,
    target: null,
    currentHref: CURRENT,
  });
  assert.equal(workspace?.href, "http://127.0.0.1:8080/workspace");

  const absolute = leaveClickTarget({
    href: "http://127.0.0.1:8080/templates/page-process/preview",
    download: false,
    target: null,
    currentHref: CURRENT,
  });
  assert.equal(
    absolute?.pathname,
    "/templates/page-process/preview",
    "same-origin absolute links are navigation",
  );
});
