import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSection } from "./types.ts";

describe("site image settings", () => {
  it("keeps legacy named slots and accepts an uncapped, safe preview gallery", () => {
    const gallery = Array.from({ length: 60 }, (_, index) => ({
      id: `preview-${index}`,
      src: `https://images.example.test/${index}.webp`,
      alt: `Preview ${index}`,
      enabled: index !== 1,
    }));
    gallery.push(
      {
        id: "unsafe",
        src: "javascript:alert(1)",
        alt: "unsafe",
        enabled: true,
      },
      {
        id: "preview-0",
        src: "https://images.example.test/duplicate.webp",
        alt: "duplicate",
        enabled: true,
      },
    );

    const images = normalizeSection("images", {
      workspace: "https://images.example.test/workspace.webp",
      gallery,
    });

    assert.equal(images.workspace, "https://images.example.test/workspace.webp");
    assert.equal(images.gallery.length, 60);
    assert.equal(images.gallery[1].enabled, false);
    assert.equal(images.gallery.some((item) => item.id === "unsafe"), false);
    assert.equal(images.gallery.filter((item) => item.id === "preview-0").length, 1);
  });

  it("normalizes pre-gallery settings to an empty gallery", () => {
    const images = normalizeSection("images", {
      workspace: "",
      document: "",
      pages: "",
      tools: "",
      mark: "",
    });

    assert.deepEqual(images.gallery, []);
  });
});
