import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { useEditor } from "./store";

describe("artboard store actions", () => {
  it("manages grid columns and clamping", () => {
    useEditor.getState().setArtboardGridCols(4);
    assert.equal(useEditor.getState().artboardGridCols, 4);

    useEditor.getState().setArtboardGridCols(10); // max is 8
    assert.equal(useEditor.getState().artboardGridCols, 8);

    useEditor.getState().setArtboardGridCols(0); // min is 1
    assert.equal(useEditor.getState().artboardGridCols, 1);
  });

  it("locks and unlocks artboard", () => {
    const pageId = useEditor.getState().pages[0].id;
    assert.equal(Boolean(useEditor.getState().pages[0].locked), false);

    useEditor.getState().toggleArtboardLock(pageId);
    assert.equal(useEditor.getState().pages[0].locked, true);

    useEditor.getState().toggleArtboardLock(pageId);
    assert.equal(useEditor.getState().pages[0].locked, false);
  });

  it("toggles hidden content on artboard", () => {
    const pageId = useEditor.getState().pages[0].id;
    assert.equal(Boolean(useEditor.getState().pages[0].hidden), false);

    useEditor.getState().toggleArtboardHidden(pageId);
    assert.equal(useEditor.getState().pages[0].hidden, true);

    useEditor.getState().toggleArtboardHidden(pageId);
    assert.equal(useEditor.getState().pages[0].hidden, false);
  });

  it("splits artboard in place", () => {
    // grant unlimited pages for testing
    useEditor.setState({
      entitlements: {
        ...useEditor.getState().entitlements,
        unlimited_pages: true,
      },
    });
    const initialCount = useEditor.getState().pages.length;
    const pageId = useEditor.getState().pages[0].id;
    useEditor.getState().splitArtboardPage(pageId, "horizontal");
    assert.equal(useEditor.getState().pages.length, initialCount + 1);
  });

  it("adds adjacent artboard", () => {
    useEditor.setState({
      entitlements: {
        ...useEditor.getState().entitlements,
        unlimited_pages: true,
      },
    });
    const countBefore = useEditor.getState().pages.length;
    const pageId = useEditor.getState().pages[0].id;
    useEditor.getState().addArtboardAdjacent(pageId, "right");
    assert.equal(useEditor.getState().pages.length, countBefore + 1);
  });
});
