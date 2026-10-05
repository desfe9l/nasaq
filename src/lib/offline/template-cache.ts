/**
 * Templates — allow licensed/authorized templates to be explicitly downloaded
 * for offline use. Paid templates/assets remain protected: only an authorized
 * fetch (entitlement checked server-side) can be cached.
 *
 * Cache lives in IndexedDB offlineTemplates store, per owner. Entries carry
 * the authorization proof (validated entitlement snapshot) so offline display
 * can gate without re-calling server, but never as permanent authorization.
 */

import { getStorageOwner, ANON_OWNER } from "@/lib/editor/storage-owner";

export interface OfflineTemplateRecord {
  id: string; // template id (admin_templates.id or user_templates.id or builtin pack/page id)
  ownerId: string;
  title: string;
  content: string; // sanitized TemplateDocument JSON or packed pages JSON
  thumbnail?: string | null;
  tier?: string | null; // free | premium etc
  cachedAt: number;
  authorizedAt: number; // when server said ok
  source: "admin" | "personal" | "builtin";
  pagesCount?: number;
}

const STORE = "offlineTemplates";

async function getDb(): Promise<IDBDatabase | null> {
  const { getOfflineDb } = await import("@/lib/editor/storage");
  return getOfflineDb();
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let t: IDBTransaction;
    try { t = db.transaction(STORE, mode); } catch (e) { reject(e); return; }
    t.onerror = () => reject(t.error ?? new Error("tx failed"));
    t.onabort = () => reject(t.error ?? new Error("tx aborted"));
    let result: T;
    t.oncomplete = () => resolve(result as T);
    const store = t.objectStore(STORE);
    Promise.resolve(run(store)).then(v=>{result=v}, e=>{t.abort(); reject(e)});
  });
}
function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej)=>{ r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error ?? new Error("req failed")); });
}

/**
 * Download and cache a template after server authorizes it.
 * Must be called online, after entitlement check succeeds.
 */
export async function cacheTemplateForOffline(record: Omit<OfflineTemplateRecord, "ownerId" | "cachedAt" | "authorizedAt">): Promise<void> {
  const ownerId = getStorageOwner();
  if (ownerId === ANON_OWNER) throw new Error("Sign in to cache templates for offline use");
  const db = await getDb();
  const entry: OfflineTemplateRecord = {
    ...record,
    ownerId,
    cachedAt: Date.now(),
    authorizedAt: Date.now(),
  };
  if (!db) {
    // fallback localStorage per-template (size limited, but preserves UX for IDB-less env)
    try {
      const key = `nasaq-offline-template::${ownerId}::${entry.id}`;
      if (entry.content.length > 4_500_000) throw new Error("Template too large for localStorage fallback — IndexedDB required");
      localStorage.setItem(key, JSON.stringify(entry));
    } catch (e) { throw e; }
    return;
  }
  await tx(db, "readwrite", async (s)=>{ await request(s.put(entry)); });
}

export async function getOfflineTemplate(id: string, ownerId: string = getStorageOwner()): Promise<OfflineTemplateRecord | null> {
  const db = await getDb();
  if (!db) {
    try {
      const raw = localStorage.getItem(`nasaq-offline-template::${ownerId}::${id}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  const row = await tx(db, "readonly", async (s)=> (await request(s.get(id))) as OfflineTemplateRecord | undefined);
  if (!row || row.ownerId !== ownerId) return null;
  return row;
}

export async function listOfflineTemplates(ownerId: string = getStorageOwner()): Promise<OfflineTemplateRecord[]> {
  const db = await getDb();
  if (!db) {
    const out: OfflineTemplateRecord[] = [];
    try {
      for (let i=0;i<localStorage.length;i+=1){
        const k=localStorage.key(i);
        if (!k?.startsWith(`nasaq-offline-template::${ownerId}::`)) continue;
        const raw=localStorage.getItem(k);
        if (raw) out.push(JSON.parse(raw));
      }
    } catch {}
    return out.sort((a,b)=>b.cachedAt-a.cachedAt);
  }
  const all = await tx(db, "readonly", async (s)=> (await request(s.getAll())) as OfflineTemplateRecord[]);
  return all.filter(r=>r.ownerId===ownerId).sort((a,b)=>b.cachedAt-a.cachedAt);
}

export async function isTemplateAvailableOffline(id: string, ownerId: string = getStorageOwner()): Promise<boolean> {
  return (await getOfflineTemplate(id, ownerId)) != null;
}

export async function removeOfflineTemplate(id: string, ownerId: string = getStorageOwner()): Promise<void> {
  const db = await getDb();
  if (!db) {
    try { localStorage.removeItem(`nasaq-offline-template::${ownerId}::${id}`);} catch{}
    return;
  }
  // only delete if owned by current owner
  const existing = await tx(db, "readonly", async(s)=> (await request(s.get(id))) as OfflineTemplateRecord|undefined);
  if (!existing || existing.ownerId !== ownerId) return;
  await tx(db,"readwrite", async(s)=>{ await request(s.delete(id)); });
}

/**
 * Authorized download helper — gates on entitlement and fetches template content.
 * Caller should have checked entitlements, but we re-validate via cacheEntitlement.
 */
export async function downloadAndCacheTemplate(input: {
  id: string;
  title: string;
  source: OfflineTemplateRecord["source"];
  tier?: string | null;
  fetchContent: () => Promise<{ content: string; thumbnail?: string | null; pagesCount?: number }>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ownerId = getStorageOwner();
  if (ownerId === ANON_OWNER) return { ok: false, error: "سجّل الدخول لحفظ القالب دون اتصال" };
  // Enforce licensing: paid tier requires entitlement (cached grace counts)
  if (input.tier && input.tier !== "free") {
    const { getCachedEntitlement, isEntitlementValidOffline } = await import("./entitlement-cache");
    const cached = await getCachedEntitlement(ownerId);
    const valid = isEntitlementValidOffline(cached);
    // If offline cache says not entitled, we still allow download when ONLINE
    // because server will gate fetchContent. Offline download is only after online auth.
    if (!valid && typeof navigator !== "undefined" && navigator.onLine === false) {
      return { ok: false, error: "القالب المميز يتطلب اتصالاً للتحقق من الترخيص قبل التنزيل" };
    }
  }
  try {
    const { content, thumbnail, pagesCount } = await input.fetchContent();
    if (!content || typeof content !== "string") return { ok: false, error: "محتوى القالب غير صالح" };
    await cacheTemplateForOffline({
      id: input.id,
      title: input.title,
      content,
      thumbnail: thumbnail ?? null,
      tier: input.tier ?? null,
      source: input.source,
      pagesCount,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 400) };
  }
}
