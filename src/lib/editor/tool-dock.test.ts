import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TOOL_DOCK_CONFIG,
  TOOL_DEFINITIONS,
  loadToolDockConfig,
} from "./tool-dock-config";

describe("tool dock config", () => {
  it("has valid default config matching all tool definitions", () => {
    assert.equal(DEFAULT_TOOL_DOCK_CONFIG.length, TOOL_DEFINITIONS.length);
    const defIds = TOOL_DEFINITIONS.map((d) => d.id);
    const cfgIds = DEFAULT_TOOL_DOCK_CONFIG.map((c) => c.id);
    assert.deepEqual(cfgIds, defIds);
  });

  it("assigns all tools as visible by default", () => {
    for (const item of DEFAULT_TOOL_DOCK_CONFIG) {
      assert.equal(item.visible, true);
    }
  });

  it("loads default config in test environment", () => {
    const loaded = loadToolDockConfig();
    assert.equal(loaded.length, TOOL_DEFINITIONS.length);
  });
});
