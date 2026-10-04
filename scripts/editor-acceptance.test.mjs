import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
const read = (path) => readFileSync(path, "utf8");

test("customer-facing subscription, success, landing and licensing copy hides providers", () => {
  const paths = [
    ...readdirSync("src/components/site")
      .filter((n) => n.endsWith(".tsx") && !/^(Admin|Owner)/.test(n))
      .map((n) => "src/components/site/" + n),
    "src/components/license/LicensePage.tsx",
    "src/routes/payment/success.tsx",
    "src/routes/payment/cancel.tsx",
    "src/lib/license/activation.server.ts",
    "src/lib/commercial/plan-cards.ts",
    "src/lib/commercial/plan-state.ts",
  ];
  for (const path of paths) {
    const source = ts.createSourceFile(
      path,
      read(path),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node) => {
      if (
        ts.isJsxText(node) ||
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)
      ) {
        // Identifiers, import paths and provider code remain internal. Arabic
        // strings and JSX text are the user-visible surface, not comments.
        if (/[\u0600-\u06ff]/.test(node.text))
          assert.doesNotMatch(
            node.text,
            /Gumroad|Keygen|الجهات الحكومية/,
            path,
          );
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
});

test("catalog resolves the auth owner before loading personal template data", () => {
  const catalogStore = read("src/components/site/useCatalog.ts");
  assert.match(catalogStore, /syncStorageOwner\(\)[\s\S]*?hydrateCustomTemplateStore\(\)/);
  assert.match(catalogStore, /subscribeStorageOwner\(load\)/);
});

test("Template Hub keeps the paid catalog title and neutral share header", () => {
  const catalog = read("src/components/site/PublishedTemplates.tsx");
  assert.match(catalog, /<h2[^>]*>قوالب مدفوعة<\/h2>/);
  assert.doesNotMatch(catalog, /قوالب منشورة من إدارة المنصة/);
  const share = read("src/components/site/PublicTemplatePage.tsx");
  assert.match(
    share,
    /<h3 className="text-\[13px\] font-bold text-ink">رابط القالب العام<\/h3>/,
  );
});

test("Pinterest label and destination match the authoritative brand config", () => {
  const brand = read("src/lib/brand.ts");
  const pinterest = brand.match(/\{\s*id: "pinterest",[\s\S]*?\n\s{2}\},/);
  assert.ok(pinterest, "Pinterest remains in the official social-account list");
  assert.match(pinterest[0], /handle: "@nasaq_ar"/);
  assert.match(pinterest[0], /href: "https:\/\/www\.pinterest\.com\/nasaqdocs"/);
});

test("selection and panel rendering have one owner", () => {
  const app = read("src/components/editor/EditorApp.tsx");
  // Docked and floating windows use the same renderer. Concrete panel content
  // is selected in one switch, not cloned for separate viewport variants.
  assert.equal((app.match(/<FloatingPanel\b/g) || []).length, 2);
  assert.equal((app.match(/const renderDockedWindow = /g) || []).length, 1);
  assert.equal((app.match(/const renderPanelContent = /g) || []).length, 1);
  assert.equal((app.match(/const renderPanelBody = /g) || []).length, 1);
  assert.equal((app.match(/<LeftPanel\b/g) || []).length, 1);
  assert.equal((app.match(/<PropertiesPanel\b/g) || []).length, 1);
  assert.equal((app.match(/<LayersPanel\b/g) || []).length, 1);
  assert.match(app, /dockedBySide\.left && renderDockedWindow\(dockedBySide\.left, "left"\)/);
  assert.match(app, /hosts\.filter\(\(id\) => !visibleDock\(id\)\)\.map/);
  assert.match(app, /open=\{panelOpen\[id\] && !cropActive && !focusMode\}/);
  const canvas = read("src/components/editor/CanvasStage.tsx");
  assert.doesNotMatch(canvas, /<SelectionActions/);
  assert.match(canvas, /const ROTATE_HANDLES = \["n"\]/);
  const css = read("src/styles.css");
  assert.doesNotMatch(css, /\.canvas-el\s*\{[^}]*min-(?:width|height): 3mm/);
  assert.doesNotMatch(css, /\.editor-shell\s*\{[^}]*--editor-header-h/);
});
