/**
 * Control-plane persistence with a revision-checked cache.
 *
 * The cache is an optimization. A newer revision in the backend always wins,
 * including a write this process did not make. Dropping the cache (process
 * restart) reloads the same document from the backend.
 */

import {
  authorizeControlMutation,
  type ControlActor,
} from "./decisions.ts";
import {
  applyControlPatch,
  bootstrapControlPlane,
  normalizeControlPlane,
  type ControlPatch,
  type ControlPlaneDocument,
  type PatchResult,
} from "./schema.ts";

export interface ControlBackend {
  read(): Promise<unknown | null>;
  write(doc: ControlPlaneDocument): Promise<void>;
}

export type ControlWriteResult =
  | { ok: true; doc: ControlPlaneDocument; rejected: string[] }
  | { ok: false; reason: "forbidden" };

export function createControlStore(backend: ControlBackend) {
  let cache: ControlPlaneDocument | null = null;

  async function read(): Promise<ControlPlaneDocument | null> {
    const stored = await backend.read();
    if (stored == null) {
      cache = null;
      return null;
    }
    const doc = normalizeControlPlane(stored);
    // Same revision: the cached document IS the stored one. A newer revision
    // replaces the cache — a stale copy cannot hide an owner change.
    if (cache && cache.revision === doc.revision) return cache;
    cache = doc;
    return doc;
  }

  async function write(actor: ControlActor, patch: ControlPatch, now?: string): Promise<ControlWriteResult> {
    const auth = authorizeControlMutation(actor);
    if (!auth.ok) return auth;
    const current = (await read()) ?? bootstrapControlPlane(now);
    const applied: PatchResult = applyControlPatch(current, patch, actor.userId, now);
    await backend.write(applied.doc);
    cache = applied.doc;
    return { ok: true, doc: applied.doc, rejected: applied.rejected };
  }

  function resetCache(): void {
    cache = null;
  }

  function cachedRevision(): number | null {
    return cache ? cache.revision : null;
  }

  return { read, write, resetCache, cachedRevision };
}
