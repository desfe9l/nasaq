/**
 * NASAQ — panel grouping model tests (windows sharing one window as tabs).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EDITOR_PANEL_IDS,
  defaultPanelGroups,
  defaultWorkspaceGroups,
  detachPanelTab,
  hostOf,
  isGrouped,
  movePanelTab,
  openPanelTab,
  parsePanelGroups,
} from "./panel-groups.ts";

/** Every panel appears exactly once across all groups. */
function assertPartition(state: ReturnType<typeof defaultPanelGroups>) {
  const seen: string[] = [];
  for (const host of EDITOR_PANEL_IDS)
    for (const member of state.groups[host] ?? []) seen.push(member);
  assert.equal(seen.length, EDITOR_PANEL_IDS.length);
  assert.equal(new Set(seen).size, EDITOR_PANEL_IDS.length);
  for (const host of EDITOR_PANEL_IDS)
    if (state.groups[host]) {
      assert.equal(state.groups[host][0], host, "host leads its group");
      assert.ok(state.groups[host].includes(state.tabs[host]));
    }
}

test("the default state is six independent windows", () => {
  const state = defaultPanelGroups();
  assertPartition(state);
  for (const id of EDITOR_PANEL_IDS) {
    assert.deepEqual(state.groups[id], [id]);
    assert.equal(hostOf(state, id), id);
    assert.equal(isGrouped(state, id), false);
  }
});

test("dropping a tab into another window groups them under the target host", () => {
  let state = defaultPanelGroups();
  state = movePanelTab(state, "properties", "report");
  assertPartition(state);
  assert.deepEqual(state.groups.report, ["report", "properties"]);
  assert.equal(state.groups.properties, undefined);
  assert.equal(hostOf(state, "properties"), "report");
  assert.equal(isGrouped(state, "report"), true);
  assert.equal(state.tabs.report, "properties", "the dropped tab shows");

  state = movePanelTab(state, "library", "report");
  assertPartition(state);
  assert.deepEqual(state.groups.report, ["report", "properties", "library"]);
});

test("moving a host out promotes its next member", () => {
  let state = defaultPanelGroups();
  state = movePanelTab(state, "properties", "report");
  state = movePanelTab(state, "layers", "report");
  assert.deepEqual(state.groups.report, ["report", "properties", "layers"]);
  // Drag the HOST tab into another window: the group survives behind it.
  state = movePanelTab(state, "report", "elements");
  assertPartition(state);
  assert.deepEqual(state.groups.elements, ["elements", "report"]);
  assert.deepEqual(state.groups.properties, ["properties", "layers"]);
  // The window left behind keeps showing the tab it was already on.
  assert.equal(state.tabs.properties, "layers");
});

test("reordering inside one window keeps the host first", () => {
  let state = defaultPanelGroups();
  state = movePanelTab(state, "properties", "report");
  state = movePanelTab(state, "layers", "report");
  state = movePanelTab(state, "layers", "report", 0);
  assert.deepEqual(state.groups.report, ["report", "layers", "properties"]);
  state = movePanelTab(state, "report", "report", 5); // host onto itself: no-op
  assert.equal(state.groups.report[0], "report");
});

test("detaching gives a tab its own window again", () => {
  let state = defaultPanelGroups();
  state = movePanelTab(state, "properties", "report");
  state = movePanelTab(state, "library", "report");
  state = detachPanelTab(state, "properties");
  assertPartition(state);
  assert.deepEqual(state.groups.properties, ["properties"]);
  assert.deepEqual(state.groups.report, ["report", "library"]);
  assert.equal(detachPanelTab(state, "tools"), state);
});

test("openPanelTab resolves the window that holds the tab", () => {
  let state = defaultPanelGroups();
  state = movePanelTab(state, "properties", "report");
  assert.deepEqual(openPanelTab(state, "properties"), {
    host: "report",
    tab: "properties",
  });
  assert.deepEqual(openPanelTab(state, "layers"), {
    host: "layers",
    tab: "layers",
  });
});

test("stored garbage normalises back to a valid partition", () => {
  assertPartition(parsePanelGroups(null));
  assertPartition(parsePanelGroups({ groups: "nope" }));
  const parsed = parsePanelGroups({
    groups: {
      report: ["report", "properties", "ghost", "report", "library"],
      properties: ["properties"],
    },
    tabs: { report: "library" },
  });
  assertPartition(parsed);
  // Unknown id dropped, duplicate dropped, missing panels restored.
  assert.deepEqual(parsed.groups.report, ["report", "properties", "library"]);
  for (const id of ["tools", "elements", "layers"] as const)
    assert.deepEqual(parsed.groups[id], [id]);
  assert.equal(parsed.tabs.report, "library", "a stored tab is honoured");
  // A panel that lost its window has no tab row of its own any more.
  assert.equal(parsed.tabs.properties, undefined);
});

test("the shipped layout is two windows: content on the right, inspector on the left", () => {
  const state = defaultWorkspaceGroups();
  assertPartition(state);
  assert.deepEqual(state.groups.elements, ["elements", "tools", "library"]);
  assert.deepEqual(state.groups.properties, ["properties", "layers", "report"]);
  assert.equal(Object.keys(state.groups).length, 2);
  assert.equal(state.tabs.elements, "elements");
  assert.equal(state.tabs.properties, "properties");
});
