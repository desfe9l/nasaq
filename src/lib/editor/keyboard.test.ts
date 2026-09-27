import { test } from "node:test";
import assert from "node:assert/strict";
import { shortcutKey, shortcutHint } from "./keyboard.ts";

test("existing selection/tool shortcuts keep physical bindings on Arabic keyboards", () => {
  for (const [key, code, expected] of [
    ["ش", "KeyA", "a"],
    ["ر", "KeyV", "v"],
    ["ف", "KeyT", "t"],
    ["ق", "KeyR", "r"],
    ["ن", "KeyK", "k"],
  ]) {
    assert.equal(shortcutKey({ key, code }), expected);
  }
});
test("Latin bindings, zoom symbols and navigation are not remapped", () => {
  for (const key of ["a", "A", "+", "-", "0", "Escape", "ArrowRight"]) {
    assert.equal(shortcutKey({ key, code: "" }), key.toLowerCase());
  }
});
test("shortcut hints use the host platform modifier", () => {
  assert.equal(shortcutHint("⌘ A", "Win32"), "Ctrl+A");
  assert.equal(shortcutHint("⌘ ⇧ G", "Linux"), "Ctrl+Shift+G");
  assert.equal(shortcutHint("⌘ A", "MacIntel"), "⌘ A");
});
