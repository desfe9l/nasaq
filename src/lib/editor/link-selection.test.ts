/**
 * Linked elements — «ربط».
 *
 * A link is the middle ground between independent objects and a group: the
 * elements stay separate layers (their own fills, text and stacking order) but
 * move together, and the layer list marks them. The MODEL and the canvas both
 * honour `linkId`; the toolbar had lost the two buttons that create and clear a
 * link, which left the marker visible on existing documents with no way to act
 * on it. These tests pin the workflow that the restored controls drive.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { useEditor } from "./store.ts";
import { createProject } from "./templates.ts";
import { createElement } from "./model.ts";
import { readNsq, writeNsq } from "../nsq/package.ts";

function seed(elements: Array<Record<string, unknown>>) {
  const project = createProject("blank", "official", "فحص الربط");
  const page = {
    ...project.pages[0],
    elements: elements.map((el) => createElement(el.type as never, el as never)),
  };
  useEditor.setState({
    hydrate: async () => {},
    hydrated: true,
    id: "link-check",
    name: project.name,
    pages: [{ ...page }],
    activePageId: page.id,
    selectedId: null,
    selectedIds: [],
    enteredGroupId: null,
    past: [],
    future: [],
  });
  return page;
}

const el = (id: string, x: number) => ({
  type: "shape",
  id,
  x,
  y: 40,
  w: 30,
  h: 30,
});

test("linking two elements gives them one shared id without grouping them", () => {
  const page = seed([el("a", 10), el("b", 60)]);
  useEditor.setState({ selectedIds: ["a", "b"], selectedId: "a" });

  useEditor.getState().linkSelected();

  const after = useEditor.getState().pages[0];
  const [a, b] = after.elements;
  assert.ok(a?.linkId, "the first element is linked");
  assert.equal(a.linkId, b.linkId, "both share one link id");
  assert.equal(
    after.elements.length,
    2,
    "linking never wraps the elements in a group — they stay independent layers",
  );
  assert.ok(
    after.elements.every((item) => item.type !== "group"),
    "no group was created",
  );
  assert.deepEqual(
    page.elements.map((item) => item.id),
    ["a", "b"],
    "the seed page itself is untouched (the store never mutates in place)",
  );
});

test("a single element cannot be linked, and unlinking touches only the selection", () => {
  seed([el("a", 10), el("b", 60), el("c", 110)]);

  /* A link is a relationship: one element alone has nothing to move with, so
   * the action refuses instead of storing an inert id. */
  useEditor.setState({ selectedIds: ["c"], selectedId: "c" });
  useEditor.getState().linkSelected();
  assert.equal(
    useEditor.getState().pages[0].elements[2].linkId,
    undefined,
    "a lone element is not linked",
  );

  useEditor.setState({ selectedIds: ["a", "b"], selectedId: "a" });
  useEditor.getState().linkSelected();
  const first = useEditor.getState().pages[0].elements[0].linkId;
  assert.ok(first);

  /* Re-linking part of the old pair moves those elements to the NEW link. */
  useEditor.setState({ selectedIds: ["b", "c"], selectedId: "b" });
  useEditor.getState().linkSelected();
  const after = useEditor.getState().pages[0];
  const second = after.elements[1].linkId!;
  assert.ok(second && second !== first, "a fresh link id is minted");
  assert.equal(after.elements[2].linkId, second);
  assert.equal(after.elements[0].linkId, first, "the untouched element keeps its own link");

  useEditor.setState({ selectedIds: ["b", "c"], selectedId: "b" });
  useEditor.getState().unlinkSelected();
  const final = useEditor.getState().pages[0];
  assert.equal(final.elements[1].linkId, undefined);
  assert.equal(final.elements[2].linkId, undefined);
  assert.equal(final.elements[0].linkId, first, "an unrelated link is left exactly as it was");
});

test("a link survives the .nsq round trip", async () => {
  const page = seed([el("a", 10), el("b", 60)]);
  useEditor.setState({ selectedIds: ["a", "b"], selectedId: "a" });
  useEditor.getState().linkSelected();
  const linked = useEditor.getState().pages[0].elements[0].linkId!;

  const project = {
    id: "link-check",
    name: "فحص الربط",
    theme: "official" as const,
    pages: useEditor.getState().pages,
  };
  const { blob } = await writeNsq({
    project: project as never,
    site: "https://nasaq.example",
  });
  const read = await readNsq(blob);
  assert.equal(
    read.project.pages?.[0]?.elements[0]?.linkId,
    linked,
    "the saved document still knows the two elements move together",
  );
  assert.equal(read.project.pages?.[0]?.elements[1]?.linkId, linked);
  assert.equal(page.elements.length, 2, "…and neither element was regrouped by saving");
});
