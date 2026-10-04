import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isLivePreviewHost,
  LIVE_PREVIEW_ALLOWED_HOSTS,
  LIVE_PREVIEW_TRUSTED_ORIGINS,
} from "./preview-host.ts";

test("recognizes the Arena port-prefixed live-preview host", () => {
  assert.equal(isLivePreviewHost("8080-sandbox-123.e2b.app"), true);
  assert.equal(isLivePreviewHost("5173-abc.e2b.app."), true);
});

test("keeps the previous Grok preview host compatible", () => {
  assert.equal(isLivePreviewHost("nasaq.grok-sandbox.com"), true);
});

test("does not treat the bare domain, local dev, or lookalikes as previews", () => {
  assert.equal(isLivePreviewHost("e2b.app"), false);
  assert.equal(isLivePreviewHost("localhost"), false);
  assert.equal(isLivePreviewHost("localhost:8080"), false);
  assert.equal(isLivePreviewHost("evil-e2b.app.example.com"), false);
  assert.equal(isLivePreviewHost("grok-sandbox.com"), false);
});

test("Better Auth trusts host and origin forms for both preview environments", () => {
  assert.deepEqual(LIVE_PREVIEW_ALLOWED_HOSTS, [
    "*.e2b.app",
    "*.grok-sandbox.com",
  ]);
  assert.deepEqual(LIVE_PREVIEW_TRUSTED_ORIGINS, [
    "*.e2b.app",
    "https://*.e2b.app",
    "http://*.e2b.app",
    "*.grok-sandbox.com",
    "https://*.grok-sandbox.com",
    "http://*.grok-sandbox.com",
  ]);
});
