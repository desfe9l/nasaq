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

/** One project the author explicitly prepared: pages plus local asset bytes. */
export interface OfflinePreparedProject {
  id: string;
  preparedAt: number;
  /** Project `updatedAt` at the moment it was prepared. */
  updatedAt: number;
  pages: number;
  assetsCached: number;
}

interface PreparedBook {
  ownerId: string;
  projects: Record<string, OfflinePreparedProject>;
}

const PREPARED_PREFIX = "prepared::";

function preparedKey(ownerId: string): string {
  return `${PREPARED_PREFIX}${ownerId}`;
}

async function readPreparedBook(ownerId: string): Promise<PreparedBook> {
  const key = preparedKey(ownerId);
  const empty: PreparedBook = { ownerId, projects: {} };
  const db = await getDb();
  if (!db) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return empty;
      const row = JSON.parse(raw) as { value?: PreparedBook };
      const value = row?.value ?? (row as unknown as PreparedBook);
      if (!value || value.ownerId !== ownerId) return empty;
      return { ownerId, projects: value.projects ?? {} };
    } catch {
      return empty;
    }
  }
  const row = await tx(db, "readonly", async (s) =>
    (await request(s.get(key))) as { key: string; value: PreparedBook } | undefined,
  ).catch(() => undefined);
  if (!row?.value || row.value.ownerId !== ownerId) return empty;
  return { ownerId, projects: row.value.projects ?? {} };
}

async function writePreparedBook(book: PreparedBook): Promise<void> {
  const key = preparedKey(book.ownerId);
  const db = await getDb();
  if (!db) {
    try {
      localStorage.setItem(key, JSON.stringify({ key, value: book }));
    } catch { /* quota */ }
    return;
  }
  await tx(db, "readwrite", async (s) => {
    await request(s.put({ key, value: book }));
  });
}

export async function getPreparedProject(
  projectId: string,
  ownerId: string = getStorageOwner(),
): Promise<OfflinePreparedProject | null> {
  const book = await readPreparedBook(ownerId);
  return book.projects[projectId] ?? null;
}

/** True only after «حفظ للعمل دون اتصال» and while the document is still local. */
export async function isProjectPreparedOffline(
  projectId: string,
  ownerId: string = getStorageOwner(),
): Promise<boolean> {
  const mark = await getPreparedProject(projectId, ownerId);
  if (!mark) return false;
  const { getProject } = await import("@/lib/editor/storage");
  const project = await getProject(projectId);
  return Boolean(project?.pages?.length);
}

/**
 * Pull the project, its pages and every remote asset into local storage,
 * then mark it ready. Uses the existing project store, asset cache and
 * workspace snapshot — not a second database.
 */
export async function prepareProjectForOffline(
  projectId: string,
): Promise<
  | { ok: true; pages: number; assetsCached: number; updatedAt: number }
  | { ok: false; error: string }
> {
  const ownerId = getStorageOwner();
  if (!projectId) return { ok: false, error: "المشروع غير محدد" };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, error: "يلزم الاتصال لتحضير المشروع للعمل دون اتصال" };
  }
  const { getProject, saveProject } = await import("@/lib/editor/storage");
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "المشروع غير موجود على هذا الجهاز" };

  const { materializeProjectForOffline, cacheProjectFonts } = await import("./asset-cache");
  const materialized = await materializeProjectForOffline(project);
  if (materialized.failed > 0) {
    return { ok: false, error: "تعذر حفظ بعض أصول المشروع. تحقق من الاتصال ثم أعد المحاولة." };
  }
  await cacheProjectFonts(materialized.project).catch(() => undefined);

  const changed = JSON.stringify(materialized.project) !== JSON.stringify(project);
  const saved = changed ? await saveProject(materialized.project) : project;

  const mark: OfflinePreparedProject = {
    id: saved.id || projectId,
    preparedAt: Date.now(),
    updatedAt: saved.updatedAt || Date.now(),
    pages: saved.pages?.length ?? 0,
    assetsCached: materialized.cached,
  };
  const book = await readPreparedBook(ownerId);
  book.projects[mark.id] = mark;
  await writePreparedBook(book);
  await refreshWorkspaceCache();

  try {
    const { warmAppShell } = await import("./register-sw");
    await warmAppShell([
      "/",
      "/workspace",
      "/projects",
      "/templates",
      "/editor",
      `/editor/${mark.id}`,
    ]);
  } catch { /* shell warm is best-effort; the document itself is already local */ }

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("nasaq:project-prepared", { detail: { id: mark.id } }));
  }
  return { ok: true, pages: mark.pages, assetsCached: mark.assetsCached, updatedAt: mark.updatedAt };
}
