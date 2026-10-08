/**
 * Server persistence for the owner control plane.
 *
 * The document lives in `site_settings` (key `service_control_plane.v1`).
 * It is not localStorage. A missing row means shipped defaults, not an outage.
 * Every read compares revisions, so a cached copy cannot outlive an owner save.
 */

import { classifyDatabaseFailure, deriveServiceHealth, type ControlActor, type DatabaseFailureKind } from "./decisions.ts";
import {
  bootstrapControlPlane,
  toPublicOperationalView,
  type ControlPatch,
  type ControlPlaneDocument,
  type PublicOperationalView,
  type ServiceId,
} from "./schema.ts";
import {
  currentProviderProbes,
  enforcementPlane,
  markControlPlaneUnconfirmed,
  noteProviderSignal,
  publishControlPlane,
  clearProviderSignal,
} from "./snapshot.ts";
import { createControlStore, type ControlWriteResult } from "./store.ts";

export const CONTROL_PLANE_KEY = "service_control_plane.v1";

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

const store = createControlStore({
  async read() {
    const db = await sql();
    const rows = await db.query<{ value: unknown }>(
      `SELECT value FROM site_settings WHERE key = $1 LIMIT 1`,
      [CONTROL_PLANE_KEY],
    );
    return rows.length ? rows[0].value : null;
  },
  async write(doc) {
    const db = await sql();
    await db.query(
      `INSERT INTO site_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [CONTROL_PLANE_KEY, JSON.stringify(doc)],
    );
  },
});

const FAILURE_BACKOFF_MS = 20_000;
let lastDatabaseFailureAt = 0;
let lastDatabaseFailure: DatabaseFailureKind | null = null;
let refreshInflight: Promise<ControlPlaneDocument> | null = null;

function providerProbe(kind: DatabaseFailureKind): "quota" | "down" | "timeout" {
  return kind;
}

function rememberDatabaseFailure(kind: DatabaseFailureKind): ControlPlaneDocument {
  lastDatabaseFailure = kind;
  lastDatabaseFailureAt = Date.now();
  markControlPlaneUnconfirmed();
  noteProviderSignal("database", providerProbe(kind));
  return enforcementPlane();
}

async function readPublishedPlane(): Promise<ControlPlaneDocument> {
  try {
    const stored = await store.read();
    const plane = stored ?? bootstrapControlPlane();
    publishControlPlane(plane, stored != null && stored.revision >= 1);
    lastDatabaseFailure = null;
    clearProviderSignal("database");
    return enforcementPlane();
  } catch (error) {
    return rememberDatabaseFailure(classifyDatabaseFailure(error));
  }
}

export function refreshControlPlane(): Promise<ControlPlaneDocument> {
  const now = Date.now();
  if (lastDatabaseFailure && now - lastDatabaseFailureAt < FAILURE_BACKOFF_MS) {
    markControlPlaneUnconfirmed();
    noteProviderSignal("database", providerProbe(lastDatabaseFailure));
    return Promise.resolve(enforcementPlane());
  }
  if (!refreshInflight) {
    refreshInflight = readPublishedPlane().finally(() => {
      refreshInflight = null;
    });
  }
  return refreshInflight;
}

export async function saveControlPatch(
  actor: ControlActor,
  patch: ControlPatch,
): Promise<ControlWriteResult> {
  try {
    const result = await store.write(actor, patch);
    if (result.ok) {
      publishControlPlane(result.doc, true);
      lastDatabaseFailure = null;
      clearProviderSignal("database");
    }
    return result;
  } catch (error) {
    rememberDatabaseFailure(classifyDatabaseFailure(error));
    throw error;
  }
}

export interface ServiceControlView {
  plane: ControlPlaneDocument;
  health: ReturnType<typeof deriveServiceHealth>;
  usage: { storageBytes: number | null };
  /** True when the database itself could not be read. The rest of the view still renders. */
  databaseUnavailable: boolean;
}

export async function loadServiceControlView(): Promise<ServiceControlView> {
  const plane = await refreshControlPlane();
  const probes = currentProviderProbes();
  const databaseUnavailable = probes.database === "down" || probes.database === "quota" || probes.database === "timeout";
  const health = deriveServiceHealth(plane, probes);
  let storageBytes: number | null = null;
  if (!databaseUnavailable) {
    try {
      const db = await sql();
      const rows = await db.query<{ bytes: string | number }>(
        `SELECT COALESCE(SUM(byte_size), 0) AS bytes FROM storage_assets`,
      );
      const parsed = Number(rows[0]?.bytes ?? 0);
      storageBytes = Number.isFinite(parsed) ? parsed : null;
    } catch {
      storageBytes = null;
    }
  }
  return { plane, health, usage: { storageBytes }, databaseUnavailable };
}

export async function loadPublicOperational(): Promise<PublicOperationalView> {
  const plane = await refreshControlPlane();
  return toPublicOperationalView(plane);
}

export function usageForService(
  id: ServiceId,
  usage: { storageBytes: number | null },
): number | null {
  if (id === "storage" || id === "uploads") return usage.storageBytes;
  return null;
}
