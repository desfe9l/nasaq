import assert from "node:assert/strict";
import test from "node:test";
import {
  idsBeyondCap,
  normalizeMemoryInput,
  resolveMemory,
  type DesignMemoryView,
} from "./design-memory.ts";

test("rejected feedback without a reason is refused", () => {
  assert.equal(normalizeMemoryInput({ kind: "rejected", reason: " ", brief: "تقرير" }), null);
  const accepted = normalizeMemoryInput({
    kind: "rejected",
    reason: "التخطيط مزدحم",
    brief: "تقرير",
    recurring: false,
  });
  assert.equal(accepted?.recurring, false);
  assert.equal(accepted?.reason, "التخطيط مزدحم");
});

test("one-off approvals do not become automatic rules", () => {
  const rows: DesignMemoryView[] = [
    {
      id: "1",
      kind: "preference",
      category: "presentation",
      brief: "",
      reason: "لا تكدّس البطاقات",
      constitutionVersion: "2026.10.09",
      recurring: false,
      ruleKey: "density",
      ruleValue: "light",
      createdAt: "2026-10-01T00:00:00.000Z",
    },
    {
      id: "2",
      kind: "preference",
      category: "presentation",
      brief: "",
      reason: "كثافة خفيفة للعروض",
      constitutionVersion: "2026.10.09",
      recurring: true,
      ruleKey: "density",
      ruleValue: "light",
      createdAt: "2026-10-02T00:00:00.000Z",
    },
    {
      id: "3",
      kind: "preference",
      category: "presentation",
      brief: "",
      reason: "قديم",
      constitutionVersion: "2026.10.09",
      recurring: true,
      ruleKey: "density",
      ruleValue: "dense",
      createdAt: "2026-09-01T00:00:00.000Z",
    },
  ];
  const resolved = resolveMemory(rows);
  assert.equal(resolved.rules.density, "light");
  assert.match(resolved.notes, /لا تكدّس|كثافة خفيفة/);
  assert.doesNotMatch(resolved.notes, /قديم/);
});

test("memory cap keeps the newest ids", () => {
  assert.deepEqual(idsBeyondCap(["new", "mid", "old"], 2), ["old"]);
});
