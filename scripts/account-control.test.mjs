import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const source = read("src/components/site/AccountBadge.tsx");
let license;
const exports = {};
runInNewContext(ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports,
  require(id) {
    if (id === "@/lib/license/client") return { useLicense: () => license };
    if (id === "@/lib/utils") return { cn: (...args) => args.filter(Boolean).join(" ") };
    return require(id);
  },
});

test("account status preserves server-derived tiers without inventing activation", () => {
  for (const [state, expected] of [
    [{ isLoading: true }, "LOADING"],
    [{ isAdmin: true, hasLicense: true }, "ADMIN"],
    [{ hasLicense: true }, "LICENSED"],
    [{ isSuspended: true }, "SUSPENDED"],
    [{ hasLicense: false }, "FREE"],
  ]) {
    license = state;
    assert.deepEqual({ ...exports.useAccountTier({ id: "fixture" }) }, { tier: expected, isOwner: false });
    const html = renderToStaticMarkup(React.createElement(exports.AccountBadge, { tier: expected }));
    assert.equal(html.includes("مشترك"), ["ADMIN", "LICENSED"].includes(expected));
    assert.ok(!html.includes("مرخص"));
    assert.equal((html.match(/data-account-status=/g) || []).length, 1);
    assert.ok(html.includes("whitespace-nowrap"));
    assert.ok(html.includes("<svg"));
  }
});

test("owner refinement only relabels ADMIN and never widens another tier", () => {
  license = { isAdmin: true, hasLicense: true, isOwner: true };
  assert.deepEqual({ ...exports.useAccountTier({ id: "fixture" }) }, { tier: "ADMIN", isOwner: true });
  const ownerHtml = renderToStaticMarkup(
    React.createElement(exports.AccountBadge, { tier: "ADMIN", isOwner: true }),
  );
  assert.ok(ownerHtml.includes("المالك الرئيسي"));
  license = { hasLicense: false, isOwner: true };
  assert.equal(exports.useAccountTier({ id: "fixture" }).tier, "FREE");
  license = { hasLicense: true };
  assert.deepEqual({ ...exports.useAccountTier(null) }, { tier: "FREE", isOwner: false });
});

test("every licensing gate reads the tier field instead of comparing the hook result", () => {
  // Regression guard: useAccountTier returns { tier, isOwner }. A call site
  // that compares the raw result to a string silently locks licensed users out
  // (My Templates / personal template saves went dark this way).
  const consumers = [
    "src/components/site/AccountControlContent.tsx",
    "src/components/site/SiteChrome.tsx",
    "src/components/site/MyTemplatesPage.tsx",
    "src/components/editor/EditorAccountMenu.tsx",
    "src/components/editor/ProjectFileMenu.tsx",
  ];
  for (const path of consumers) {
    const text = read(path);
    const calls = (text.match(/useAccountTier\(/g) || []).length;
    assert.ok(calls >= 1, `${path} should call useAccountTier`);
    const destructured = (text.match(/const \{ tier[^}]*\} = useAccountTier\(/g) || []).length;
    assert.equal(destructured, calls, `${path} must destructure { tier } from useAccountTier`);
    assert.ok(!text.includes("useAccountTier(user) as any"), `${path} must not cast the tier hook`);
  }
});

test("site and editor share one contained identity/status composition", () => {
  const shared = read("src/components/site/AccountControlContent.tsx");
  assert.equal((shared.match(/<AccountBadge /g) || []).length, 1);
  assert.equal((shared.match(/useAccountTier\(user\)/g) || []).length, 1);
  for (const path of ["site/SiteChrome", "editor/EditorAccountMenu"]) {
    const text = read(`src/components/${path}.tsx`);
    assert.equal((text.match(/<AccountControlContent /g) || []).length, 1);
    assert.ok(!text.includes("<AccountBadge"));
    assert.match(text, /<button[\s\S]*?<AccountControlContent user=\{user\} \/>[\s\S]*?<\/button>/);
  }
});

test("opening account or mobile navigation cannot mount another status", () => {
  const panel = read("src/components/site/AccountMenuPanel.tsx");
  assert.doesNotMatch(panel, /AccountBadge|useAccountTier|MenuTierBadge/);
  const header = read("src/components/site/SiteChrome.tsx");
  assert.equal((header.match(/<HeaderAccount\s/g) || []).length, 1);
  assert.doesNotMatch(header, /HeaderAccount variant/);
  assert.match(header, /if \(open\) closeMenu\(\)/);
  assert.match(header, /event.key === "Escape"/);
});
