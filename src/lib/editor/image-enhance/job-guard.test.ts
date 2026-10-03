import assert from "node:assert/strict";
import test from "node:test";
import { createEnhanceJobGuard } from "./job-guard.ts";

test("a job claims its element slot and releases it", () => {
  const guard = createEnhanceJobGuard();
  assert.equal(guard.begin("el1", "denoise"), true);
  assert.equal(guard.activeOp("el1"), "denoise");
  assert.equal(guard.anyActive(), true);
  guard.end("el1");
  assert.equal(guard.activeOp("el1"), undefined);
  assert.equal(guard.anyActive(), false);
});

test("double-run of the same element is rejected while busy", () => {
  const guard = createEnhanceJobGuard();
  assert.equal(guard.begin("el1", "background"), true);
  // Second press — same or different op — must not start a parallel job.
  assert.equal(guard.begin("el1", "background"), false);
  assert.equal(guard.begin("el1", "upscale"), false);
  assert.equal(guard.activeOp("el1"), "background");
});

test("different elements process independently", () => {
  const guard = createEnhanceJobGuard();
  assert.equal(guard.begin("el1", "denoise"), true);
  assert.equal(guard.begin("el2", "upscale"), true);
  assert.equal(guard.activeOp("el1"), "denoise");
  assert.equal(guard.activeOp("el2"), "upscale");
});

test("end is idempotent", () => {
  const guard = createEnhanceJobGuard();
  guard.end("never-started");
  assert.equal(guard.anyActive(), false);
  guard.begin("el1", "denoise");
  guard.end("el1");
  guard.end("el1");
  assert.equal(guard.anyActive(), false);
});

test("a released slot can be claimed again", () => {
  const guard = createEnhanceJobGuard();
  assert.equal(guard.begin("el1", "denoise"), true);
  guard.end("el1");
  assert.equal(guard.begin("el1", "upscale"), true);
  assert.equal(guard.activeOp("el1"), "upscale");
});
