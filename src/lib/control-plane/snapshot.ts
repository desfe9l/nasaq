/**
 * In-process published policy. Synchronous readers (rate limits, page caps)
 * see whatever the server last confirmed. The client starts from the shipped
 * bootstrap and replaces it when the public operational view arrives.
 *
 * A confirmed owner document (revision >= 1) wins over env bootstrap.
 * If the database cannot be read, callers mark the snapshot unconfirmed and
 * numeric limits tighten to the shipped defaults.
 */

import {
  bootstrapControlPlane,
  shippedControlPlane,
  tightenForUnconfirmed,
  toPublicOperationalView,
  type ControlPlaneDocument,
  type PublicOperationalView,
  type ServiceId,
} from "./schema.ts";

let published: ControlPlaneDocument = bootstrapControlPlane();
let ownerConfirmed = false;
let unconfirmed = false;

const observations = new Map<ServiceId, { probe: "down" | "quota" | "billing" | "timeout"; at: number }>();
const OBSERVATION_MS = 60_000;

export function publishedControlPlane(): ControlPlaneDocument {
  return published;
}

/** What enforcement should use right now. */
export function enforcementPlane(): ControlPlaneDocument {
  if (!unconfirmed) return published;
  return tightenForUnconfirmed(published);
}

export function publishControlPlane(doc: ControlPlaneDocument, confirmed = doc.revision >= 1): void {
  published = doc;
  ownerConfirmed = confirmed;
  unconfirmed = false;
}

export function markControlPlaneUnconfirmed(): void {
  unconfirmed = true;
}

export function controlPlaneIsUnconfirmed(): boolean {
  return unconfirmed;
}

export function ownerPolicyConfirmed(): boolean {
  return ownerConfirmed;
}

/** Test and process-restart helper: back to env bootstrap, no observations. */
export function resetControlPlaneState(): void {
  published = bootstrapControlPlane();
  ownerConfirmed = false;
  unconfirmed = false;
  observations.clear();
}

export function noteProviderSignal(
  id: ServiceId,
  probe: "down" | "quota" | "billing" | "timeout",
  now = Date.now(),
): void {
  observations.set(id, { probe, at: now });
  if (id === "ai") observations.set("image_processing", { probe, at: now });
  if (id === "storage") observations.set("uploads", { probe, at: now });
}

export function clearProviderSignal(id: ServiceId): void {
  observations.delete(id);
}

export function currentProviderProbes(now = Date.now()): {
  database?: "down" | "quota" | "timeout";
  storage?: "down" | "quota";
  ai?: "down" | "quota" | "billing" | "timeout";
} {
  const fresh = (id: ServiceId) => {
    const row = observations.get(id);
    if (!row) return undefined;
    if (now - row.at > OBSERVATION_MS) return undefined;
    return row.probe;
  };
  const database = fresh("database");
  const storage = fresh("storage");
  const ai = fresh("ai");
  return {
    ...(database === "down" || database === "quota" || database === "timeout" ? { database } : {}),
    ...(storage === "down" || storage === "quota" ? { storage } : {}),
    ...(ai ? { ai } : {}),
  };
}

/** Merge a public (non-secret) view into the local snapshot. Revision only moves forward. */
export function applyPublicOperationalView(view: PublicOperationalView): void {
  if (!view || typeof view.revision !== "number") return;
  if (ownerConfirmed && view.revision < published.revision) return;
  const next = structuredClone(published.revision === 0 && !ownerConfirmed ? shippedControlPlane(published.updatedAt) : published);
  // Keep operation budgets already published when the view is newer; the public
  // view carries the scalar caps and the per-service switches.
  if (view.revision < published.revision && ownerConfirmed) return;
  next.revision = view.revision;
  next.projectLimit = view.projectLimit;
  next.pageLimit = view.pageLimit;
  next.pollingIntervalMs = view.pollingIntervalMs;
  next.storageQuotaBytes = view.storageQuotaBytes;
  next.maxUploadBytes = view.maxUploadBytes;
  next.aiDailyRequestBudget = view.aiDailyRequestBudget;
  for (const id of Object.keys(view.services) as ServiceId[]) {
    if (!next.services[id] || !view.services[id]) continue;
    next.services[id].enabled = view.services[id].enabled;
    next.services[id].maintenance = view.services[id].maintenance;
    next.services[id].availability = view.services[id].availability;
  }
  publishControlPlane(next, view.revision >= 1);
}

export function publicViewOfPublished(): PublicOperationalView {
  return toPublicOperationalView(enforcementPlane());
}
