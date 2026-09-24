import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_IMPORT_BYTES,
  assetLabel,
  extensionOf,
  folderSegments,
  importKindFor,
  planLibraryImportBlueprint,
  type ImportEntry,
} from "./library-import.ts";
import {
  HEADING_PRESETS,
  buildHeading,
  estimateTitleHeight,
  headingHeight,
  type HeadingPresetId,
} from "./heading-generator.ts";

const entry = (path: string, mime = "", size = 1024): ImportEntry => ({ path, mime, size });

describe("«أضف مكتبة» — folder → shelves", () => {
  it("classifies by name, not by a possibly empty MIME type", () => {
    assert.equal(importKindFor({ path: "logo.svg", mime: "" }), "svg");
    assert.equal(importKindFor({ path: "photo.PNG", mime: "" }), "image");
    assert.equal(importKindFor({ path: "nasaq-library-2024-01-01.json", mime: "" }), "library");
    assert.equal(importKindFor({ path: "report.docx", mime: "" }), "unsupported");
    // A browser that does report the type is believed too.
    assert.equal(importKindFor({ path: "noext", mime: "image/webp" }), "image");
  });

  it("reads extensions case-insensitively and keeps the path intact", () => {
    assert.equal(extensionOf("a/b/C.JPG"), "jpg");
    assert.equal(extensionOf("a/b/noext"), "");
    assert.equal(extensionOf("dir.d/file"), "");
  });

  it("drops the file name and noise segments from a relative path", () => {
    assert.deepEqual(folderSegments("brand/logos/main/a.png"), ["brand", "logos", "main"]);
    assert.deepEqual(folderSegments("brand/__MACOSX/a.png"), ["brand"]);
    assert.deepEqual(folderSegments("a.png"), []);
  });

  it("rebuilds a nested directory tree as nested shelves", () => {
    const plan = planLibraryImportBlueprint(
      [
        entry("brand/logos/primary/a.png"),
        entry("brand/logos/old/b.png"),
        entry("brand/icons/c.svg"),
        entry("brand/root.png"),
      ],
      "مكتبة مستوردة",
    );

    const byPath = new Map(plan.folders.map((f) => [f.path, f]));
    assert.ok(byPath.has("brand"));
    assert.ok(byPath.has("brand/logos"));
    assert.ok(byPath.has("brand/logos/primary"));
    assert.ok(byPath.has("brand/logos/old"));
    assert.ok(byPath.has("brand/icons"));

    // Parents are created before the children that point at them, so the store
    // can insert in order without resolving a dangling parentId.
    const indexOf = (path: string) => plan.folders.findIndex((f) => f.path === path);
    assert.ok(indexOf("brand/logos") < indexOf("brand/logos/primary"));
    assert.equal(byPath.get("brand/logos/primary")?.parentPath, "brand/logos");
    assert.equal(byPath.get("brand")?.parentPath, null);
  });

  it("puts a flat multi-select into one named shelf", () => {
    const plan = planLibraryImportBlueprint(
      [entry("a.png"), entry("b.jpg"), entry("c.svg")],
      "هوية الوزارة",
    );
    assert.equal(plan.folders.length, 1);
    assert.equal(plan.folders[0]?.name, "هوية الوزارة");
    assert.equal(plan.folders[0]?.parentPath, null);
    for (const item of plan.entries) {
      assert.equal(item.folderPath, "هوية الوزارة");
    }
  });

  it("reports unsupported and oversized files instead of failing the import", () => {
    const plan = planLibraryImportBlueprint(
      [
        entry("brand/a.png"),
        entry("brand/notes.txt"),
        entry("brand/huge.png", "image/png", MAX_IMPORT_BYTES + 1),
      ],
      "مكتبة",
    );
    assert.equal(plan.entries.length, 1);
    assert.equal(plan.unsupported.length, 1);
    assert.equal(plan.unsupported[0]?.path, "brand/notes.txt");
    assert.equal(plan.oversized.length, 1);
    assert.equal(plan.oversized[0]?.path, "brand/huge.png");
  });

  it("gives every asset a readable Arabic-safe label", () => {
    assert.equal(assetLabel("brand/my-logo_v2.png"), "my logo v2");
    assert.equal(assetLabel("a/b/شعار.png"), "شعار");
    assert.equal(assetLabel("noext"), "noext");
  });
});

describe("مولد عناوين الفقرات", () => {
  const input = {
    preset: "side-bar" as HeadingPresetId,
    width: 180,
    title: "الملخص التنفيذي",
    subtitle: "أبرز النتائج",
    index: "01",
  };

  it("offers several distinct designs", () => {
    assert.ok(HEADING_PRESETS.length >= 6);
    assert.equal(new Set(HEADING_PRESETS.map((p) => p.id)).size, HEADING_PRESETS.length);
  });

  it("emits ordinary editable parts (text + box), never a baked image", () => {
    for (const preset of HEADING_PRESETS) {
      const parts = buildHeading({ ...input, preset: preset.id });
      assert.ok(parts.length > 0, `${preset.id} produces parts`);
      for (const part of parts) {
        assert.ok(part.kind === "text" || part.kind === "box");
        // Everything is positioned relative to the heading box, so the caller
        // places the whole thing in one move.
        assert.ok(part.x >= -0.01 && part.y >= -0.01);
        assert.ok(part.w > 0 && part.h > 0);
      }
      const titles = parts.filter((p) => p.kind === "text" && p.role === "title");
      assert.equal(titles.length, 1, `${preset.id} has exactly one title`);
    }
  });

  it("keeps the title text editable (it stays a text element with content)", () => {
    const parts = buildHeading({ ...input, preset: "framed-card" });
    const title = parts.find((p) => p.kind === "text" && p.role === "title");
    assert.ok(title && title.kind === "text");
    assert.equal(title.text, "الملخص التنفيذي");
  });

  it("reserves enough height for a long title to wrap", () => {
    const short = headingHeight({ preset: "side-bar", width: 180, title: "مقدمة" });
    const long = headingHeight({
      preset: "side-bar",
      width: 180,
      title: "تقرير الأداء السنوي لبرنامج التحول المؤسسي والخدمات المشتركة",
    });
    assert.ok(long > short);
    assert.ok(estimateTitleHeight("عنوان", 180) >= 11);
  });

  it("fits every part inside the reserved height", () => {
    for (const preset of HEADING_PRESETS) {
      const height = headingHeight({ ...input, preset: preset.id });
      for (const part of buildHeading({ ...input, preset: preset.id })) {
        assert.ok(
          part.y + part.h <= height + 0.5,
          `${preset.id}: ${part.role} overflows (${part.y + part.h} > ${height})`,
        );
      }
    }
  });
});
