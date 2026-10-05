/**
 * Workspace/dashboard cache — account-scoped projects, folders, recent files,
 * and workspace metadata. Survives offline, isolated per owner.
 *
 * Projects themselves are already in IDB per owner (storage.ts). This module
 * caches derived dashboard data (project metas, folder list, recent ids) so
 * the workspace shell can render without network even before hydrate finishes,
 * and to provide a fast shell while offline.
 */

import { getStorageOwner, ANON_OWNER } from "@/lib/editor/storage-owner";
import type { ProjectMeta } from "@/lib/editor/model";
import type { AssetFolder } from "@/lib/editor/storage";

export interface WorkspaceSnapshot {
  ownerId: string;
  projects: ProjectMeta[];
  folders: AssetFolder[];
  recentIds: string[]; // most recent project ids
  updatedAt: number;
  offlineReady: boolean;
}

const STORE = "workspaceCache";
const KEY_PREFIX = "workspace::";

function keyFor(ownerId: string): string {
  return `${KEY_PREFIX}${ownerId}`;
}

async function getDb(): Promise<IDBDatabase | null> {
  const { getOfflineDb } = await import("@/lib/editor/storage");
  return getOfflineDb();
}
function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore)=>Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject)=>{
    let t: IDBTransaction;
    try{ t=db.transaction(STORE, mode);} catch(e){ reject(e); return; }
    t.onerror=()=>reject(t.error ?? new Error("tx failed"));
    t.onabort=()=>reject(t.error ?? new Error("tx aborted"));
    let result:T;
    t.oncomplete=()=>resolve(result as T);
    const store=t.objectStore(STORE);
    Promise.resolve(run(store)).then(v=>{result=v}, e=>{t.abort(); reject(e)});
  });
}
function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej)=>{ r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error ?? new Error("req failed")); });
}

export async function saveWorkspaceSnapshot(snap: Omit<WorkspaceSnapshot,"updatedAt"|"offlineReady"> & Partial<Pick<WorkspaceSnapshot,"updatedAt">>): Promise<void> {
  const ownerId = snap.ownerId || getStorageOwner();
  if (ownerId === ANON_OWNER) return; // don't cache anonymous dashboard
  const db = await getDb();
  const payload: WorkspaceSnapshot = {
    ownerId,
    projects: snap.projects ?? [],
    folders: snap.folders ?? [],
    recentIds: snap.recentIds ?? [],
    updatedAt: snap.updatedAt ?? Date.now(),
    offlineReady: true,
  };
  if (!db) {
    try { localStorage.setItem(keyFor(ownerId), JSON.stringify({ key: keyFor(ownerId), value: payload })); } catch {}
    return;
  }
  await tx(db,"readwrite", async(s)=>{ await request(s.put({ key: keyFor(ownerId), value: payload })); });
}

export async function getWorkspaceSnapshot(ownerId: string = getStorageOwner()): Promise<WorkspaceSnapshot | null> {
  const key = keyFor(ownerId);
  const db = await getDb();
  if (!db) {
    try {
      const raw=localStorage.getItem(key);
      if (!raw) return null;
      const row=JSON.parse(raw);
      return (row?.value ?? row) as WorkspaceSnapshot;
    } catch { return null; }
  }
  const row = await tx(db,"readonly", async(s)=> (await request(s.get(key))) as { key:string; value:WorkspaceSnapshot }|undefined);
  if (!row?.value || row.value.ownerId !== ownerId) return null;
  return row.value;
}

/**
 * Update snapshot from current local state. Call after hydrate, after
 * project save/rename/delete, after folder changes. Keeps offline shell fresh.
 */
export async function refreshWorkspaceCache(): Promise<void> {
  const ownerId = getStorageOwner();
  if (ownerId === ANON_OWNER) return;
  try {
    const { listProjects, getSetting } = await import("@/lib/editor/storage");
    const { listAssets } = await import("@/lib/editor/storage"); // unused but ensure assets loaded
    void listAssets;
    const metas = await listProjects();
    const folders = (await getSetting<AssetFolder[]>("assetFolders")) ?? [];
    // recentIds = top 10 by updatedAt
    const recentIds = [...metas].sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,10).map(m=>m.id);
    await saveWorkspaceSnapshot({ ownerId, projects: metas, folders, recentIds, updatedAt: Date.now() });
  } catch {}
}

export async function clearWorkspaceCache(ownerId: string): Promise<void> {
  const key=keyFor(ownerId);
  const db=await getDb();
  if (!db) { try{ localStorage.removeItem(key);}catch{}; return; }
  await tx(db,"readwrite", async(s)=>{ await request(s.delete(key)); }).catch(()=>undefined);
}
