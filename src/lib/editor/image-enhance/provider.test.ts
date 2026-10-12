import assert from "node:assert/strict";
import test from "node:test";
import {
  listEnhanceProviders,
  localEnhanceProvider,
  pickProvider,
  registerEnhanceProvider,
  resetEnhanceProviders,
  resolveProvider,
} from "./provider.ts";
import type { EnhanceInput, EnhanceOp, EnhanceOutput, EnhanceProgressFn, EnhanceProvider } from "./types.ts";

function stubProvider(id: string, ops: EnhanceOp[]): EnhanceProvider {
  return {
    id,
    supports: (op) => ops.includes(op),
    run: async (
      _op: EnhanceOp,
      input: EnhanceInput,
      _onProgress: EnhanceProgressFn,
    ): Promise<EnhanceOutput> => ({
      blob: input.blob,
      width: input.width,
      height: input.height,
      mime: input.mime,
    }),
  };
}

test("the local provider covers the two shipped enhancement ops", () => {
  assert.ok(localEnhanceProvider.supports("background"));
  assert.ok(localEnhanceProvider.supports("denoise"));
});

test("resolveProvider returns the local provider by default", () => {
  resetEnhanceProviders();
  for (const op of ["background", "denoise"] as const) {
    const provider = resolveProvider(op);
    assert.ok(provider, op);
    assert.equal(provider.id, "local", op);
  }
});

test("a newly registered provider takes priority for the ops it supports", () => {
  resetEnhanceProviders();
  registerEnhanceProvider(stubProvider("server", ["denoise"]));
  assert.equal(resolveProvider("denoise")?.id, "server");
  // Ops the new provider does not support still fall through to local.
  assert.equal(resolveProvider("background")?.id, "local");
  resetEnhanceProviders();
});

test("pickProvider is pure and does not touch the global registry", () => {
  const a = stubProvider("a", ["denoise"]);
  const b = stubProvider("b", ["denoise", "background"]);
  assert.equal(pickProvider([a, b], "denoise")?.id, "a");
  assert.equal(pickProvider([a, b], "background")?.id, "b");
  assert.equal(pickProvider([a], "background"), undefined);
  assert.equal(pickProvider([], "denoise"), undefined);
});

test("resetEnhanceProviders restores the single local provider", () => {
  registerEnhanceProvider(stubProvider("x", ["background"]));
  assert.ok(listEnhanceProviders().length >= 2);
  resetEnhanceProviders();
  assert.equal(listEnhanceProviders().length, 1);
  assert.equal(listEnhanceProviders()[0].id, "local");
});

test("stub provider runs through the shared EnhanceInput/Output contract", async () => {
  const provider = stubProvider("echo", ["denoise"]);
  const blob = new Blob([new Uint8Array(4)], { type: "image/png" });
  const input: EnhanceInput = { blob, width: 2, height: 2, mime: "image/png" };
  const seen: string[] = [];
  const out = await provider.run("denoise", input, (p) => seen.push(p.stage));
  assert.equal(out.width, 2);
  assert.equal(out.height, 2);
  assert.equal(out.mime, "image/png");
});
