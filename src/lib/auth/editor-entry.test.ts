import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EDITOR_ENTRY_DEMO_LABEL,
  EDITOR_ENTRY_DIRECT_LABEL,
  editorEntryFor,
} from "./editor-entry.ts";

describe("editorEntryFor", () => {
  it("waits while the session resolves instead of guessing a door", () => {
    assert.deepEqual(editorEntryFor({ isPending: true, hasUser: false }), { ready: false });
    assert.deepEqual(editorEntryFor({ isPending: true, hasUser: true }), { ready: false });
  });

  it("sends a signed-in account straight to the editor — no «Try Editor» gate", () => {
    const entry = editorEntryFor({ isPending: false, hasUser: true });
    assert.deepEqual(entry, {
      ready: true,
      direct: true,
      href: "/editor",
      label: EDITOR_ENTRY_DIRECT_LABEL,
    });
  });

  it("routes a visitor with no session through the limited demo", () => {
    const entry = editorEntryFor({ isPending: false, hasUser: false });
    assert.deepEqual(entry, {
      ready: true,
      direct: false,
      href: "/demo",
      label: EDITOR_ENTRY_DEMO_LABEL,
    });
  });
});
