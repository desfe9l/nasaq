/**
 * Server persistence for the owner control plane.
 *
 * The document lives in `site_settings` (key `service_control_plane.v1`).
 * It is not localStorage. A missing row means shipped defaults, not an outage.
 * Every read compares revisions, so a cached copy cannot outlive an owner save.
 */

import { deriveServiceHealth, type ControlActor } from "./decisions.ts";
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

export async function refreshControlPlane(): Promise<ControlPlaneDocument> {
  try {
    const stored = await store.read();
    const plane = stored ?? bootstrapControlPlane();
    publishControlPlane(plane, stored != null && stored.revision >= 1);
    return enforcementPlane();
  } catch {
    markControlPlaneUnconfirmed();
    noteProviderSignal("database", "down");
    return enforcementPlane();
  }
}

export async function saveControlPatch(
  actor: ControlActor,
  patch: ControlPatch,
): Promise<ControlWriteResult> {
  const result = await store.write(actor, patch);
  if (result.ok) publishControlPlane(result.doc, true);
  return result;
}

export interface ServiceControlView {
  plane: ControlPlaneDocument;
  health: ReturnType<typeof deriveServiceHealth>;
  usage: { storageBytes: number | null };
  /** True when the database itself could not be read. The rest of the view still renders. */
  databaseUnavailable: boolean;
}

export async function loadServiceControlView(): Promise<ServiceControlView> {
  let databaseUnavailable = false;
  let plane: ControlPlaneDocument;
  try {
    const stored = await store.read();
    plane = stored ?? bootstrapControlPlane();
    publishControlPlane(plane, stored != null && stored.revision >= 1);
  } catch {
    databaseUnavailable = true;
    markControlPlaneUnconfirmed();
    noteProviderSignal("database", "down");
    plane = enforcementPlane();
  }
  const probes = currentProviderProbes();
  if (databaseUnavailable) probes.database = "down";
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
