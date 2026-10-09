import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error jsdom has no bundled types in devDependencies
import { JSDOM } from "jsdom";

/**
 * The training-center → editor handoff, driven through the REAL store.
 *
 * Regression suite for the production failure «تعذر فتحه في المحرر»: the
 * training center generated a design and asked the editor command bridge to
 * open it while the editor store was still COLD (never hydrated, entitlements
 * unresolved). The store's document command refuses while access is
 * unresolved, so the document was never created, never saved, and the
 * navigation never happened — the author saw an "unable to open in editor"
 * error for a project that did not exist.
 *
 * The fix is the same boot every other production entry performs (the
 * raw-to-document page, the AI studio): resolve the account entitlements and
 * hydrate the owner-scoped library BEFORE the document command. These tests
 * pin both halves: the cold-store refusal (so nobody accidentally makes the
 * gate permissive) and the booted handoff all the way to a persisted,
 * editable project that `/editor/<id>` can reopen.
 */

const dom = new JSDOM('<!doctype html><html dir="rtl"><body></body></html>', {
  url: "http://localhost/training",
  pretendToBeVisual: true,
});
const { window } = dom;

const define = (key: string, value: unknown) =>
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });

for (const key of [
  "document",
  "localStorage",
  "sessionStorage",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MutationObserver",
  "getComputedStyle",
  "location",
  "history",
  "CSS",
] as const) {
  const value = (window as unknown as Record<string, unknown>)[key];
  if (value !== undefined) define(key, value);
}
define("window", window);
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
define("matchMedia", window.matchMedia);
define("requestAnimationFrame", (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0),
);
define("cancelAnimationFrame", (id: number) => clearTimeout(id));
define("navigator", { onLine: true, language: "ar-SA", userAgent: "training-open-test" });
define("fetch", async () => ({ ok: true }));
define("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

const { useEditor } = await import("./store.ts");
const { getProject, getSetting, listProjects, setSetting } = await import("./storage.ts");
const { applyAIEditorOperations } = await import("../ai/editor-bridge.ts");
const { executeDesignTwin } = await import("../ai/design-twin.ts");
const { memoryRow, normalizeMemoryInput } = await import("../ai/design-memory.ts");
const { applicationPageLimit } = await import("../product/product.ts");
const { LICENSE_ENTITLEMENTS } = await import("../license/types.ts");

const PROMPT = "صمم موجزًا تنفيذيًا هادئًا مع مساحات بيضاء واضحة";

/** What the training center builds once the server side answers. */
const delivery = () =>
  executeDesignTwin({ prompt: PROMPT, maxPages: applicationPageLimit() });

test("a cold editor store refuses the generated design — nothing is created or saved", async () => {
  const cold = useEditor.getState();
  assert.equal(cold.hydrated, false, "the training page used to call the bridge on exactly this store");

  const results = await applyAIEditorOperations(cold, [
    { type: "generate_document", project: delivery().project },
  ]);

  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false, "the document command must refuse while access is unresolved");
  assert.equal(useEditor.getState().id, undefined, "no document may appear in memory");
  assert.equal((await listProjects()).length, 0, "no project may be persisted");
});

test("the fixed handoff: boot the store, generate, persist, verify", async () => {
  /* The boot every production entry performs before a document command. */
  const store = useEditor.getState();
  store.setEntitlements(LICENSE_ENTITLEMENTS.FREE);
  await store.hydrate();
  const booted = useEditor.getState();
  assert.equal(booted.hydrated, true);
  assert.equal(booted.entitlementsResolved, true);
  assert.equal(booted.sessionOwner, booted.entitlementsOwner, "one identity for the whole handoff");

  const results = await applyAIEditorOperations(useEditor.getState(), [
    { type: "generate_document", project: delivery().project },
  ]);
  assert.equal(results[0].ok, true, "the booted editor accepts the generated document");

  const projectId = useEditor.getState().id;
  assert.ok(projectId, "the new document has a real project id");

  /* The row the training page verifies BEFORE navigating. */
  const saved = await getProject(projectId!);
  assert.ok(saved, "the generated design is persisted, not just held in memory");
  assert.equal(saved!.id, projectId);
  assert.ok(saved!.pages.length >= 1, "persisted pages");
  assert.ok(
    saved!.pages.every((page) => page.elements.length > 0),
    "every persisted page carries editable elements",
  );

  /* The navigation preference the page writes for the next boot. */
  await setSetting("activeProjectId", saved!.id);
  assert.equal(await getSetting<string>("activeProjectId"), saved!.id);
});

test("the generated project is editable and survives the editor address", async () => {
  const projectId = useEditor.getState().id!;
  const page = useEditor.getState().pages[0];
  const target = page.elements[0];
  assert.ok(target, "the open document exposes its canvas elements");

  /* Edit an element and persist it — the author's first real change. */
  useEditor.getState().updateElement(target.id, { name: "عنصر معدّل من التدريب" });
  await useEditor.getState().saveNow();
  assert.equal(useEditor.getState().saveState, "saved");
  const edited = await getProject(projectId);
  assert.equal(edited!.pages[0].elements[0].name, "عنصر معدّل من التدريب");

  /*
   * `/editor/<projectId>` resolves the address exactly this way
   * (hydrate → openProject). Reopening by the REAL id must bring the same
   * document back — this is the refresh/reopen contract the training page
   * hands the author when it assigns `editorPathFor(saved.id)`.
   */
  const reopened = await useEditor.getState().openProject(projectId);
  assert.equal(reopened, true, "the editor opens the project by its real id");
  const live = useEditor.getState();
  assert.equal(live.documentPhase, "ready");
  assert.equal(live.id, projectId);
  assert.equal(live.pages[0].elements[0].name, "عنصر معدّل من التدريب", "the edit survived the reopen");
});

test("learned preferences demonstrably shape the next generation", () => {
  const learned = [
    memoryRow(normalizeMemoryInput({
      kind: "preference",
      category: "",
      brief: "مرجع تدريبي",
      reason: "أفضل العروض الواسعة",
      recurring: true,
      ruleKey: "format",
      ruleValue: "wide-slide",
    })!, "mem-format", "2026-10-09T00:00:00.000Z"),
    memoryRow(normalizeMemoryInput({
      kind: "preference",
      category: "",
      brief: "مرجع تدريبي",
      reason: "مساحات بيضاء أكثر",
      recurring: true,
      ruleKey: "density",
      ruleValue: "light",
    })!, "mem-density", "2026-10-09T00:00:01.000Z"),
  ];

  const baseline = executeDesignTwin({ prompt: PROMPT, maxPages: applicationPageLimit() });
  const shaped = executeDesignTwin({ prompt: PROMPT, maxPages: applicationPageLimit(), memory: learned });

  assert.notEqual(baseline.plan.format, "wide-slide", "without the rule the prompt stays an A4 brief");
  assert.equal(shaped.plan.format, "wide-slide", "the learned format rule changes the plan");
  assert.equal(shaped.plan.contentDensity, "light", "the learned density rule changes the plan");
  assert.deepEqual(
    shaped.metrics.valid,
    true,
    "a memory-shaped design still passes NASAQ validation",
  );
});
