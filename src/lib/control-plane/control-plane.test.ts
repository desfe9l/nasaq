import assert from "node:assert/strict";
import test from "node:test";
import { resetRateLimits } from "@/lib/license/rate-limit";
import {
  authenticationRequired,
  authorizeControlMutation,
  classifyDatabaseFailure,
  commitControlChange,
  deriveServiceHealth,
  gateService,
  pageCountAllows,
  projectCreateAllows,
  quotaAllows,
} from "./decisions.ts";
import {
  applyControlPatch,
  bootstrapControlPlane,
  SHIPPED_PROJECT_LIMIT,
  type ControlPlaneDocument,
} from "./schema.ts";
import {
  currentProviderProbes,
  enforcementPlane,
  markControlPlaneUnconfirmed,
  noteProviderSignal,
  publishControlPlane,
  resetControlPlaneState,
} from "./snapshot.ts";
import { createControlStore } from "./store.ts";
import { checkOperationLimit } from "@/lib/policy/limits";

const owner = { role: "owner" as const, userId: "owner-1" };
const admin = { role: "admin" as const, userId: "admin-1" };
const user = { role: "user" as const, userId: "user-1" };

function memoryBackend() {
  let doc: unknown = null;
  return {
    backend: {
      read: async () => doc,
      write: async (next: ControlPlaneDocument) => {
        doc = next;
      },
    },
    peek: () => doc,
    plant: (next: unknown) => {
      doc = next;
    },
  };
}

test("owner can change a service limit and read it back", async () => {
  const mem = memoryBackend();
  const store = createControlStore(mem.backend);
  const saved = await store.write(owner, { operation: { id: "ai:report", userPerMinute: 11 } }, "2026-10-08T00:00:00.000Z");
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.doc.operations["ai:report"].userPerMinute, 11);
  store.resetCache();
  const loaded = await store.read();
  assert.equal(loaded?.operations["ai:report"].userPerMinute, 11);
  assert.equal(loaded?.revision, 1);
});

test("owner can disable a service and cannot disable authentication", async () => {
  const mem = memoryBackend();
  const store = createControlStore(mem.backend);
  const disabled = await store.write(owner, { service: { id: "templates", enabled: false } });
  assert.equal(disabled.ok, true);
  if (!disabled.ok) return;
  assert.equal(disabled.doc.services.templates.enabled, false);
  assert.equal(gateService(disabled.doc, "templates").allowed, false);
  const auth = await store.write(owner, { service: { id: "authentication", enabled: false } });
  assert.equal(auth.ok, true);
  if (!auth.ok) return;
  assert.equal(auth.doc.services.authentication.enabled, true);
  assert.ok(auth.rejected.includes("authentication.enabled"));
  assert.equal(authenticationRequired(auth.doc), true);
  assert.equal(gateService(auth.doc, "authentication").allowed, true);
});

test("a normal user cannot change service policy", async () => {
  const mem = memoryBackend();
  const store = createControlStore(mem.backend);
  const denied = await store.write(user, { projectLimit: 40 });
  assert.deepEqual(denied, { ok: false, reason: "forbidden" });
  assert.equal(mem.peek(), null);
  assert.equal(authorizeControlMutation({ role: "anonymous", userId: "" }).ok, false);
});

test("owner override is respected and user quotas do not block the owner", () => {
  const plane = bootstrapControlPlane("2026-10-08T00:00:00.000Z");
  assert.equal(quotaAllows({ privileged: false, used: plane.storageQuotaBytes, incoming: 1, quota: plane.storageQuotaBytes }), false);
  assert.equal(quotaAllows({ privileged: true, used: plane.storageQuotaBytes, incoming: 1, quota: plane.storageQuotaBytes }), true);
  assert.equal(projectCreateAllows({ privileged: false, unlimitedEntitlement: false, count: plane.projectLimit, limit: plane.projectLimit }), false);
  assert.equal(projectCreateAllows({ privileged: true, unlimitedEntitlement: false, count: 500, limit: plane.projectLimit }), true);
  assert.equal(pageCountAllows({ privileged: true, unlimitedEntitlement: false, count: 40, limit: plane.pageLimit }), true);
  resetRateLimits();
  const policyUser = plane.operations["ai:image"].userPerMinute;
  for (let i = 0; i < policyUser; i += 1) {
    checkOperationLimit("ai:image", "owner-1", "203.0.113.8");
  }
  const blocked = checkOperationLimit("ai:image", "owner-1", "203.0.113.8");
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) assert.equal(blocked.kind, "user_limit");
  const override = checkOperationLimit("ai:image", "owner-1", "203.0.113.8", { privileged: true });
  assert.equal(override.allowed, true);
});

test("a Gemini quota failure affects only AI", () => {
  const health = deriveServiceHealth(bootstrapControlPlane(), { ai: "quota" });
  assert.equal(health.ai.status, "provider_limited");
  assert.equal(health.image_processing.status, "provider_limited");
  for (const id of ["editor", "storage", "templates", "authentication", "admin", "documents", "database", "uploads"] as const) {
    assert.equal(health[id].status, "enabled", id);
  }
});

test("a storage failure affects only storage-dependent operations", () => {
  const health = deriveServiceHealth(bootstrapControlPlane(), { storage: "down" });
  assert.equal(health.storage.status, "unavailable");
  assert.equal(health.uploads.status, "unavailable");
  assert.equal(health.import_export.status, "degraded");
  for (const id of ["ai", "editor", "authentication", "admin", "templates", "documents", "database"] as const) {
    assert.equal(health[id].status, "enabled", id);
  }
});

test("a database failure is reported explicitly and does not shut the editor or AI down", () => {
  const health = deriveServiceHealth(bootstrapControlPlane(), { database: "down" });
  assert.equal(health.database.status, "unavailable");
  assert.equal(health.database.reason, "database");
  assert.equal(health.documents.status, "degraded");
  assert.equal(health.templates.status, "degraded");
  assert.equal(health.editor.status, "enabled");
  assert.equal(health.ai.status, "enabled");
  assert.equal(health.admin.status, "enabled");
  assert.notEqual(health.authentication.status, "disabled");
});

test("a Postgres quota is a provider limit and does not shut unrelated services", () => {
  assert.equal(
    classifyDatabaseFailure(
      Object.assign(
        new Error("Your account or project has exceeded the quota. Upgrade your plan to increase limits."),
        { code: "53000" },
      ),
    ),
    "quota",
  );
  assert.equal(classifyDatabaseFailure(new Error("connect ETIMEDOUT")), "timeout");
  assert.equal(classifyDatabaseFailure(new Error("connect ECONNREFUSED")), "down");
  resetControlPlaneState();
  noteProviderSignal("database", "quota");
  const probes = currentProviderProbes();
  assert.equal(probes.database, "quota");
  assert.equal(probes.ai, undefined);
  assert.equal(probes.storage, undefined);
  const health = deriveServiceHealth(bootstrapControlPlane(), probes);
  assert.equal(health.database.status, "provider_limited");
  assert.equal(health.database.reason, "postgres");
  assert.equal(health.documents.status, "degraded");
  assert.equal(health.templates.status, "degraded");
  assert.equal(health.users_teams.status, "degraded");
  assert.equal(health.authentication.status, "degraded");
  for (const id of ["editor", "ai", "storage", "uploads", "admin", "image_processing", "import_export", "background", "polling", "api"] as const) {
    assert.equal(health[id].status, "enabled", id);
  }
  assert.equal(gateService(bootstrapControlPlane(), "editor").allowed, true);
  assert.equal(gateService(bootstrapControlPlane(), "ai").allowed, true);
  resetControlPlaneState();
});

test("one failed provider does not shut down unrelated services", () => {
  const health = deriveServiceHealth(bootstrapControlPlane(), { ai: "billing", storage: "quota" });
  assert.equal(health.ai.status, "provider_limited");
  assert.equal(health.storage.status, "provider_limited");
  assert.equal(health.authentication.status, "enabled");
  assert.equal(health.editor.status, "enabled");
  assert.equal(health.admin.status, "enabled");
  assert.equal(health.database.status, "enabled");
});

test("policy survives a process restart", async () => {
  const mem = memoryBackend();
  const store = createControlStore(mem.backend);
  const saved = await store.write(admin, { projectLimit: 6, pollingIntervalMs: 20_000 });
  assert.equal(saved.ok, true);
  store.resetCache();
  const reloaded = await store.read();
  assert.equal(reloaded?.projectLimit, 6);
  assert.equal(reloaded?.pollingIntervalMs, 20_000);
  assert.equal(reloaded?.updatedBy, "admin-1");
});

test("a cached policy cannot override a newer owner policy", async () => {
  const mem = memoryBackend();
  const store = createControlStore(mem.backend);
  const first = await store.write(owner, { pageLimit: 4 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(store.cachedRevision(), first.doc.revision);
  mem.plant({ ...first.doc, revision: first.doc.revision + 5, pageLimit: 9 });
  const next = await store.read();
  assert.equal(next?.revision, first.doc.revision + 5);
  assert.equal(next?.pageLimit, 9);
  assert.notEqual(next?.pageLimit, 4);
});

test("an unauthorized request cannot modify the control plane", () => {
  const current = bootstrapControlPlane();
  const denied = commitControlChange(user, current, { storageQuotaBytes: 1024 });
  assert.deepEqual(denied, { ok: false, reason: "forbidden" });
  const direct = authorizeControlMutation(user);
  assert.equal(direct.ok, false);
  assert.equal(current.revision, 0);
});

test("an unconfirmed cache cannot widen limits past the shipped defaults", () => {
  resetControlPlaneState();
  const widened = applyControlPatch(bootstrapControlPlane(), { projectLimit: 50 }, "owner-1").doc;
  publishControlPlane(widened, true);
  assert.equal(enforcementPlane().projectLimit, 50);
  markControlPlaneUnconfirmed();
  assert.equal(enforcementPlane().projectLimit, SHIPPED_PROJECT_LIMIT);
  resetControlPlaneState();
});

test("retry policy cannot be made unbounded", () => {
  const patched = applyControlPatch(bootstrapControlPlane(), {
    service: { id: "ai", retry: { maxAttempts: 100, backoffMs: 999_999 } },
  }, "owner-1");
  assert.equal(patched.doc.services.ai.retry.maxAttempts, 3);
  assert.ok(patched.doc.services.ai.retry.backoffMs <= 5_000);
});
