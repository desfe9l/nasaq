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
  /*
   * Dismissal is one shared rule, not a per-surface listener: Escape and a press
   * that lands outside the card, decided by containment. A surface that adds its
   * own window listener is how the card started vanishing on any touch.
   */
  assert.match(header, /useAccountMenuDismiss\(\{ open, panelRef, triggerRef: buttonRef, onClose: closeMenu \}\)/);
  assert.match(panel, /installAccountMenuDismiss\(\{/, "one installer for both surfaces");
  const rule = read("src/lib/account-menu.ts");
  assert.match(rule, /event\.key === "Escape"/, "Escape leaves; nothing else in the card does");
  assert.match(rule, /events\.addEventListener\("pointerdown", press, \{ capture: true \}\)/);
  for (const [name, text] of [["site", header], ["editor", read("src/components/editor/EditorAccountMenu.tsx")]]) {
    assert.doesNotMatch(text, /addEventListener\("click", closeMenu\)/, `${name}: no blanket click-to-close`);
    assert.doesNotMatch(text, /addEventListener\("(scroll|resize)", closeMenu/, `${name}: a scroll or resize re-measures, never closes`);
    assert.doesNotMatch(text, /onPointerDown=\{closeMenu\}/, `${name}: no invisible sheet over the page`);
  }
});

test("the session identity is stable, so account effects run once per account", () => {
  /*
   * The account surfaces key their effects on `user`. `useCurrentUserState()`
   * therefore has to hand out the SAME object until the session store actually
   * publishes a different answer — a fresh literal on every render turns every
   * `useEffect([user])` into a per-render fetch, and the account page (load →
   * setData → render → load) visibly shakes. These assertions pin the memo and
   * the id-keyed reload, because the failure is invisible in a static render.
   */
  const hook = read("src/lib/auth/use-current-user.ts");
  assert.match(hook, /const user = useMemo<AppUser \| null>\(/);
  assert.match(hook, /\}, \[data\]\);/, "memoised on the store snapshot, not rebuilt per render");
  assert.match(hook, /const state = useMemo<CurrentUserState>\(/);
  assert.match(hook, /const DEV_USER_STATE: CurrentUserState = \{ user: DEV_USER, isPending: false \};/);
  assert.doesNotMatch(
    hook,
    /return \{\s*user: user\s*\?/,
    "no un-memoised object literal handed to 40 consumers",
  );

  const page = read("src/components/site/AccountPage.tsx");
  assert.match(page, /const accountId = user\?\.id \?\? null;/);
  assert.match(page, /\}, \[isPending, accountId, load\]\);/, "reload keys on the account, not the object");
  assert.doesNotMatch(page, /\[isPending, user, load\]/);
  assert.match(page, /<AccountSubscriptionCard user=\{user\} variant="page" \/>/);
  assert.match(page, /AccountOverviewSkeleton/, "the payment blocks load into a box of their own size");
});

test("the subscription section renders derived facts and no local arithmetic", () => {
  const card = read("src/components/site/AccountSubscriptionCard.tsx");
  // Dates, day counts and the meter come from the pure module — the component
  // cannot invent its own countdown, and cannot recompute one on a timer.
  assert.match(card, /from "@\/lib\/account\/subscription"/);
  assert.doesNotMatch(card, /new Date\(|Date\.now|86_400|getTime\(/);
  assert.doesNotMatch(card, /setInterval|setTimeout/, "a ticking countdown is a repaint loop with extra steps");
  assert.doesNotMatch(card, /animate-pulse/, "loading placeholders do not shimmer");
  // The account's standing must never be decided in the view: it is read.
  assert.doesNotMatch(card, /useState/, "the section holds no state of its own");
  assert.match(card, /role="progressbar"/);
});

test("every subscription class the section writes has a rule in the sheet", () => {
  const sources = [
    "src/components/site/AccountSubscriptionCard.tsx",
    "src/components/site/SiteChrome.tsx",
    "src/components/editor/EditorAccountMenu.tsx",
    "src/components/editor/EditorSettingsDialog.tsx",
  ];
  const sheet = read("src/styles.css");
  const written = new Set();
  for (const path of sources) {
    const src = read(path);
    for (const match of src.matchAll(/"((?:subscription|account-menu)-[a-z0-9-]+)"/g)) written.add(match[1]);
  }
  assert.ok(written.size >= 20, `expected the section's classes to be collected, saw ${written.size}`);
  const orphan = [...written].filter((name) => !sheet.includes(`.${name}`));
  // A class with no rule is a decoration that silently does nothing on screen.
  assert.deepEqual(orphan, [], `classes written but never styled: ${orphan.join(", ")}`);
});
