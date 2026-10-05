import { clone, projectMeta, type Project, type ProjectMeta } from "./model";
import { uid } from "@/lib/utils";
import {
  ANON_OWNER,
  getStorageOwner,
  hasSignedInOwner,
  rowOwnership,
} from "./storage-owner";

/**
 * Project library persistence.
 *
 * Reports embed images as data URLs, so a single project can run into tens of
 * megabytes — far past the ~5 MB localStorage ceiling. IndexedDB is the primary
 * store; localStorage is kept as a small-metadata fallback for browsers where
 * IndexedDB is unavailable (private windows, hardened settings) so the app still
 * opens and warns instead of losing work silently.
 *
 * EVERY row is scoped to a storage owner (`./storage-owner`): the signed-in
 * account id, or the anonymous visitor tag. Reads only return rows the current
 * owner may see (`rowOwnership`), writes stamp the current owner, and a signed-in
 * account adopts pre-isolation (unstamped) rows once so libraries saved before
 * ownership tracking keep working. A signed-out visitor therefore can never read
 * an account's library, and a second account on the same browser only sees its
 * own rows — the boundary is enforced here, at the data layer, not in the UI.
 */

/**
 * IndexedDB database renamed with the NASAQ rebrand. Projects written before
 * the rename live in `LEGACY_DB_NAME`; `openDb` copies them across once so an
 * existing library keeps working instead of appearing empty. The old database
 * is left untouched as a safety net.
 */
const DB_NAME = "nasaq-reports";
const LEGACY_DB_NAME = "faisal-reports";
/**
 * Bump this whenever a new object store is added. IndexedDB only fires
 * `onupgradeneeded` when the requested version is higher than what the browser
 * already holds, so an unchanged version silently leaves existing installs
 * without the new store.
 */
const DB_VERSION = 5;
const PROJECTS = "projects";
const SETTINGS = "settings";
const ASSETS = "assets";
const CUSTOM_TEMPLATES = "customTemplates";
const SYNC_QUEUE = "syncQueue";
const OFFLINE_TEMPLATES = "offlineTemplates";
const WORKSPACE_CACHE = "workspaceCache";
const LS_PROJECTS = "nasaq-projects-v1";
const LS_SETTINGS = "nasaq-settings-v1";
const LS_ASSETS = "nasaq-assets-v1";
/** Pre-rebrand localStorage mirror slots, read as a fallback on first run. */
const LEGACY_LS_PROJECTS = "diwan-projects-v1";
const LEGACY_LS_SETTINGS = "diwan-settings-v1";
const LEGACY_LS_ASSETS = "diwan-assets-v1";

// ── Owner scoping ────────────────────────────────────────────────────────────
// Rows carry an `ownerId` stamp; reads are filtered through `rowOwnership`
// (see ./storage-owner). Pre-isolation rows (no stamp) are adopted ONCE by the
// first signed-in account that reads them — the stamp is written back so a
// later account, or a signed-out visitor, can never claim or see them.

/** A persisted row plus its owner stamp. */
type OwnedRow<T> = T & { ownerId?: string | null };

/** Stamp a row for writing under the CURRENT owner. */
function own<T extends object>(row: T): OwnedRow<T> {
  return { ...row, ownerId: getStorageOwner() };
}

/** Drop the storage stamp before a row re-enters app state or an export. */
function strip<T extends object>(row: OwnedRow<T>): T {
  const { ownerId: _ownerId, ...rest } = row;
  return rest as T;
}

/**
 * Partition stored rows for a read: what the current owner may see, and which
 * of those are unstamped/visitor rows a signed-in owner adopts. Adoption is
 * reported so callers can persist the stamps; foreign rows are simply absent.
 */
function partitionOwned<T extends object>(
  rows: OwnedRow<T>[],
): { visible: OwnedRow<T>[]; adopted: OwnedRow<T>[] } {
  const visible: OwnedRow<T>[] = [];
  const adopted: OwnedRow<T>[] = [];
  for (const row of rows) {
    const state = rowOwnership(row);
    if (state === "foreign") continue;
    if (state === "adoptable") {
      row.ownerId = getStorageOwner();
      adopted.push(row);
    }
    visible.push(row);
  }
  return { visible, adopted };
}

/** Whether one row (fetched by id) is readable by the current owner. */
function canRead<T extends object>(row: OwnedRow<T> | null | undefined): boolean {
  return rowOwnership(row) !== "foreign";
}

/**
 * A reusable uploaded image kept outside any one project.
 *
 * The author uploads a logo or a shape once and reaches for it again in later
 * reports; retyping the upload every time is the slow part of the workflow.
 * Assets live in their own store so deleting a project never removes them.
 */
export interface Asset {
  id: string;
  name: string;
  /** `data:` URL — the same normalised form projects store. */
  src: string;
  w: number;
  h: number;
  addedAt: number;
  folderId?: string | null;
  /** Cloud storage asset id when mirrored to R2. */
  remoteId?: string;
  /** SHA-256 of the stored image bytes. Used to recognise the same PSD asset. */
  contentHash?: string;
}

export interface AssetFolder {
  id: string;
  name: string;
  createdAt: number;
  /** Parent folder for nested shelves; `null` = root. */
  parentId?: string | null;
}

export type SettingsKey =
  | "activeProjectId"
  | "templateDraft"
  | "activePageId"
  | "dark"
  | "zoom"
  | "focusMode"
  | "leftOpen"
  | "rightOpen"
  | "leftCollapsed"
  | "rightCollapsed"
  | "assetFolders"
  /** SVG icons/dividers the author added to the smart library. */
  | "customLibrary"
  /** Subscriber choice: keep library assets in R2 or local-only. */
  | "cloudStorageMode"
  | "brandProfiles"
  /** Documents saved by the /import service, newest first (service history). */
  | "importServiceHistory"
  /** Account-library deletions so a later sync does not restore them. */
  | "libraryRemovedAssets"
  | "libraryRemovedFolders";

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** Settings-row flag marking the one-time copy out of the pre-rebrand database. */
const LEGACY_DB_FLAG = "legacyDbMigrated";

/**
 * Open the pre-rebrand database read-only, without pinning a version, so
 * whatever the browser already holds is returned as-is. Returns null when the
 * database does not exist — `indexedDB.open()` would otherwise create it.
 */
async function openLegacyDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  if (typeof indexedDB.databases === "function") {
    try {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === LEGACY_DB_NAME)) return null;
    } catch {
      /* `databases()` can be blocked; fall through and try the open */
    }
  }
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(LEGACY_DB_NAME);
    } catch {
      resolve(null);
      return;
    }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/** Every store a legacy database can carry, paired with its key path. */
const MIRRORED_STORES = [
  { name: PROJECTS, keyPath: "id" },
  { name: SETTINGS, keyPath: "key" },
  { name: ASSETS, keyPath: "id" },
] as const;

/**
 * One-time copy of the pre-rebrand library into the current database.
 *
 * Rows already present in the new database win, so a user who began working
 * after the rename never has older rows overwrite newer ones. A flag row makes
 * this run once; the legacy database is deliberately left in place.
 */
async function migrateLegacyDb(db: IDBDatabase): Promise<void> {
  const flag = await tx(db, SETTINGS, "readonly", (t) =>
    request(t.objectStore(SETTINGS).get(LEGACY_DB_FLAG)),
  ).catch(() => undefined);
  if (flag) return;

  const legacy = await openLegacyDb();
  if (legacy) {
    for (const { name } of MIRRORED_STORES) {
      if (!legacy.objectStoreNames.contains(name)) continue;
      try {
        const rows = (await tx(legacy, name, "readonly", (t) =>
          request(t.objectStore(name).getAll()),
        )) as Record<string, unknown>[];
        if (!rows.length) continue;
        const existing = (await tx(db, name, "readonly", (t) =>
          request(t.objectStore(name).getAllKeys()),
        )) as IDBValidKey[];
        const seen = new Set(existing.map((k) => String(k)));
        const keyPath =
          MIRRORED_STORES.find((s) => s.name === name)?.keyPath ?? "id";
        const fresh = rows.filter((row) => !seen.has(String(row[keyPath])));
        if (fresh.length) {
          await tx(db, name, "readwrite", (t) => {
            for (const row of fresh) t.objectStore(name).put(row);
          });
        }
      } catch {
        /* a partially readable legacy DB must not block startup */
      }
    }
    legacy.close();
  }

  await tx(db, SETTINGS, "readwrite", (t) =>
    request(t.objectStore(SETTINGS).put({ key: LEGACY_DB_FLAG, value: true })),
  ).catch(() => undefined);
}

/** Recover old fallback libraries into the existing database, preserving ownership.
 * Remove a legacy binary blob only after its IDB transaction has committed. */
async function migrateWebStorage(db: IDBDatabase): Promise<void> {
  if (typeof localStorage === "undefined") return;
  for (const [storeName, key] of [[PROJECTS, LS_PROJECTS], [PROJECTS, LEGACY_LS_PROJECTS], [ASSETS, LS_ASSETS], [ASSETS, LEGACY_LS_ASSETS]] as const) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    let rows: unknown;
    try { rows = JSON.parse(raw); } catch { continue; }
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== "string")) continue;
    await tx(db, storeName, "readwrite", async t => {
      const store = t.objectStore(storeName);
      const ids = new Set(await request(store.getAllKeys()));
      for (const row of rows) if (!ids.has(row.id)) await request(store.put(row));
    });
    localStorage.removeItem(key);
  }
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS)) {
        const store = db.createObjectStore(PROJECTS, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains(SETTINGS)) {
        db.createObjectStore(SETTINGS, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(ASSETS)) {
        const store = db.createObjectStore(ASSETS, { keyPath: "id" });
        store.createIndex("addedAt", "addedAt");
      }
      if (!db.objectStoreNames.contains(CUSTOM_TEMPLATES)) {
        const store = db.createObjectStore(CUSTOM_TEMPLATES, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains(SYNC_QUEUE)) {
        const store = db.createObjectStore(SYNC_QUEUE, { keyPath: "id" });
        store.createIndex("ownerId", "ownerId");
        store.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains(OFFLINE_TEMPLATES)) {
        const store = db.createObjectStore(OFFLINE_TEMPLATES, { keyPath: "id" });
        store.createIndex("ownerId", "ownerId");
        store.createIndex("cachedAt", "cachedAt");
      }
      if (!db.objectStoreNames.contains(WORKSPACE_CACHE)) {
        db.createObjectStore(WORKSPACE_CACHE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      // Resolve only after the copy settles, so the first read already sees the
      // migrated library rather than racing it.
      void migrateLegacyDb(db)
        .then(() => migrateWebStorage(db))
        .catch(() => undefined)
        .then(() => resolve(db));
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function tx<T>(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  run: (t: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let t: IDBTransaction;
    try {
      t = db.transaction(stores, mode);
    } catch (err) {
      reject(err);
      return;
    }
    t.onerror = () =>
      reject(t.error ?? new Error("IndexedDB transaction failed"));
    t.onabort = () =>
      reject(t.error ?? new Error("IndexedDB transaction aborted"));
    t.oncomplete = () => resolve(result as T);
    let result: T;
    try {
      Promise.resolve(run(t)).then((value) => { result = value; }, error => {
        t.abort(); reject(error);
      });
    } catch (error) { t.abort(); reject(error); }
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/** localStorage mirror used only when IndexedDB is unavailable. */
const fallback = {
  /** Raw stored rows — may belong to ANY owner; never render directly. */
  raw(): OwnedRow<Project>[] {
    try {
      // Read through the pre-rebrand slot until the new one has been written,
      // so a private-window session keeps the projects it saved before.
      const raw =
        localStorage.getItem(LS_PROJECTS) ??
        localStorage.getItem(LEGACY_LS_PROJECTS);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as OwnedRow<Project>[]) : [];
    } catch {
      return [];
    }
  },
  write(list: OwnedRow<Project>[]) {
    const serialized = JSON.stringify(list);
    if (/data:|blob:/i.test(serialized)) throw new Error("يتطلب حفظ الصور والملفات تفعيل تخزين المتصفح IndexedDB");
    localStorage.setItem(LS_PROJECTS, serialized);
  },
  /** The current owner's rows only, adopting unstamped rows on first read. */
  all(): Project[] {
    const rows = this.raw();
    const { visible, adopted } = partitionOwned(rows);
    // Persist adoption stamps — foreign rows stay in the blob, untouched.
    if (adopted.length) this.write(rows);
    return visible.map(strip);
  },
  get(id: string) {
    return this.all().find((p) => p.id === id) || null;
  },
  put(project: Project) {
    const stamped = own(project);
    const list = this.raw().filter((p) => p.id !== stamped.id);
    list.push(stamped);
    this.write(list);
  },
  remove(id: string) {
    // Callers guard ownership first (deleteProject); this only drops the row.
    this.write(this.raw().filter((p) => p.id !== id));
  },
};

export function storageMode(): "indexeddb" | "localstorage" {
  return typeof indexedDB === "undefined" ? "localstorage" : "indexeddb";
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const db = await openDb();
  if (!db) return fallback.all().map(projectMeta).sort(byRecency);
  try {
    const rows = (await tx(db, PROJECTS, "readonly", (t) =>
      request(t.objectStore(PROJECTS).getAll()),
    )) as OwnedRow<Project>[];
    const { visible, adopted } = partitionOwned(rows);
    // Persist adoption stamps so the claim is durable and exclusive.
    if (adopted.length) {
      await tx(db, PROJECTS, "readwrite", (t) => {
        for (const row of adopted) t.objectStore(PROJECTS).put(row);
      }).catch(() => undefined);
    }
    return visible.map((row) => projectMeta(strip(row))).sort(byRecency);
  } catch {
    return [];
  }
}

function byRecency(a: ProjectMeta, b: ProjectMeta) {
  return b.updatedAt - a.updatedAt;
}

export async function getProject(id: string): Promise<Project | null> {
  const db = await openDb();
  if (!db) return fallback.get(id);
  try {
    const row = (await tx(db, PROJECTS, "readonly", (t) =>
      request(t.objectStore(PROJECTS).get(id)),
    )) as OwnedRow<Project> | undefined;
    if (!row) return null;
    const state = rowOwnership(row);
    // Another owner's document does not exist as far as this session is
    // concerned — opening it by id must fail exactly like a missing one.
    if (state === "foreign") return null;
    if (state === "adoptable") {
      // Stamp BEFORE persisting, so the claim is durable and exclusive.
      row.ownerId = getStorageOwner();
      await tx(db, PROJECTS, "readwrite", (t) =>
        request(t.objectStore(PROJECTS).put(row)),
      ).catch(() => undefined);
    }
    return strip(row);
  } catch {
    return null;
  }
}

export async function saveProject(project: Project): Promise<Project> {
  const ownerId = getStorageOwner();
  const stamped: Project = {
    ...project,
    id: project.id || uid("proj"),
    createdAt: project.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  const db = await openDb();
  if (ownerId !== getStorageOwner())
    throw new Error("Storage owner changed during save");
  if (!db) {
    const existing = fallback.raw().find(row => row.id === stamped.id);
    if (existing && !canRead(existing)) throw new Error("لا يمكن استبدال مشروع تابع لحساب آخر");
    fallback.put(stamped);
    // Fire-and-forget: queue for cloud sync when IndexedDB unavailable (localStorage fallback)
    void import("@/lib/offline/sync-queue").then(m => {
      const isCreate = !existing;
      return m.enqueueSync((isCreate ? "project:create" : "project:update") as never, stamped as unknown as Record<string, unknown>, { dedupeKey: `${isCreate ? "project:create" : "project:update"}:${stamped.id}` });
    }).catch(() => {});
    return stamped;
  }
  let isCreate = false;
  await tx(db, PROJECTS, "readwrite", async (t) => {
    const store = t.objectStore(PROJECTS);
    const existing = await request(store.get(stamped.id!)) as OwnedRow<Project> | undefined;
    if (existing && !canRead(existing)) throw new Error("لا يمكن استبدال مشروع تابع لحساب آخر");
    if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during save");
    isCreate = !existing;
    await request(store.put({ ...clone(stamped), ownerId }));
  });
  // Keep workspace recent list warm and queue cloud sync (best-effort, never throw)
  void import("@/lib/offline/workspace-cache").then(m => m.refreshWorkspaceCache().catch(()=>{})).catch(()=>{});
  void import("@/lib/offline/sync-queue").then(m => {
    return m.enqueueSync((isCreate ? "project:create" : "project:update") as never, stamped as unknown as Record<string, unknown>, { dedupeKey: `${isCreate ? "project:create" : "project:update"}:${stamped.id}` });
  }).catch(() => {});
  return stamped;
}

export async function deleteProject(id: string): Promise<void> {
  const ownerId = getStorageOwner();
  const db = await openDb();
  if (!db) {
    if (fallback.get(id)) fallback.remove(id);
    void import("@/lib/offline/sync-queue").then(m => m.enqueueSync("project:delete" as never, { id } as unknown as Record<string, unknown>, { dedupeKey: `project:delete:${id}` })).catch(()=>{});
    void import("@/lib/offline/workspace-cache").then(m => m.refreshWorkspaceCache().catch(()=>{})).catch(()=>{});
    return;
  }
  const row = (await tx(db, PROJECTS, "readonly", (t) =>
    request(t.objectStore(PROJECTS).get(id)),
  )) as OwnedRow<Project> | undefined;
  if (row && !canRead(row)) return;
  await tx(db, PROJECTS, "readwrite", (t) =>
    request(t.objectStore(PROJECTS).delete(id)),
  );
  void import("@/lib/offline/sync-queue").then(m => m.enqueueSync("project:delete" as never, { id } as unknown as Record<string, unknown>, { dedupeKey: `project:delete:${id}` })).catch(()=>{});
  void import("@/lib/offline/workspace-cache").then(m => m.refreshWorkspaceCache().catch(()=>{})).catch(()=>{});
}

export async function duplicateProject(id: string): Promise<Project | null> {
  const source = await getProject(id);
  if (!source) return null;
  const copy: Project = {
    ...clone(source),
    id: uid("proj"),
    name: `${source.name} نسخة`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pages: source.pages.map((p) => ({
      ...clone(p),
      id: uid("page"),
      elements: p.elements.map((e) => ({ ...clone(e), id: uid("el") })),
    })),
  };
  return saveProject(copy);
}

// ── Settings ─────────────────────────────────────────────────────────────────
// Account-scoped settings (the open document, the asset shelves, the smart
// library's custom vectors) are stored under a per-owner row key so one
// account's state never loads into another's session. Device-level UI
// preferences (zoom, panels, focus) keep their plain shared keys.

const OWNER_SCOPED_SETTINGS = new Set<string>([
  "brandProfiles",
  "activeProjectId",
  "templateDraft",
  "activePageId",
  "assetFolders",
  "customLibrary",
  "cloudStorageMode",
]);

/** The row key `key` is stored under for the current owner. */
function scopedSettingKey(key: SettingsKey): string {
  return OWNER_SCOPED_SETTINGS.has(key) ? `${key}::${getStorageOwner()}` : key;
}

/**
 * Where a signed-in owner may adopt an account-scoped setting FROM when its
 * own row is missing: the pre-isolation plain key (REMOVED on adoption — the
 * first account to read it wins it, exclusively) and the visitor-scoped row
 * (kept — it remains the signed-out visitor's own). A signed-out visitor
 * adopts nothing.
 */
function adoptableSettingKeys(
  key: SettingsKey,
): { from: string; remove: boolean }[] {
  if (!OWNER_SCOPED_SETTINGS.has(key) || !hasSignedInOwner()) return [];
  // These stores have their own explicit migrations; never claim their
  // unscoped settings keys through the generic best-effort preference path.
  if (key === "brandProfiles" || key === "templateDraft") return [];
  return [
    { from: key, remove: true },
    { from: `${key}::${ANON_OWNER}`, remove: false },
  ];
}

type SettingRow = { key: string; value: unknown };

export async function getSetting<T = unknown>(
  key: SettingsKey,
): Promise<T | null> {
  const db = await openDb();
  if (!db) {
    if (key === "templateDraft") return null;
    try {
      const raw =
        localStorage.getItem(LS_SETTINGS) ??
        localStorage.getItem(LEGACY_LS_SETTINGS);
      const parsed: Record<string, unknown> = raw ? JSON.parse(raw) || {} : {};
      const scoped = scopedSettingKey(key);
      if (scoped in parsed) return (parsed[scoped] ?? null) as T | null;
      for (const { from, remove } of adoptableSettingKeys(key)) {
        if (!(from in parsed)) continue;
        const value = parsed[from] ?? null;
        parsed[scoped] = value;
        if (remove) delete parsed[from];
        try {
          localStorage.setItem(LS_SETTINGS, JSON.stringify(parsed));
        } catch {
          /* adoption write is best-effort */
        }
        return value as T | null;
      }
      return null;
    } catch {
      return null;
    }
  }
  try {
    const scoped = scopedSettingKey(key);
    const read = (rowKey: string) =>
      tx(db, SETTINGS, "readonly", (t) =>
        request(t.objectStore(SETTINGS).get(rowKey)),
      ) as Promise<SettingRow | undefined>;
    let row = await read(scoped);
    if (!row) {
      for (const { from, remove } of adoptableSettingKeys(key)) {
        const legacy = await read(from);
        if (!legacy) continue;
        row = { key: scoped, value: legacy.value };
        await tx(db, SETTINGS, "readwrite", (t) => {
          t.objectStore(SETTINGS).put(row as SettingRow);
          if (remove) t.objectStore(SETTINGS).delete(from);
        }).catch(() => undefined);
        break;
      }
    }
    return (row?.value ?? null) as T | null;
  } catch (error) {
    if (key === "templateDraft") throw error;
    return null;
  }
}

export async function setSetting(
  key: SettingsKey,
  value: unknown,
): Promise<void> {
  const rowKey = scopedSettingKey(key);
  const db = await openDb();
  if (rowKey !== scopedSettingKey(key)) throw new Error("Storage owner changed during save");
  if (!db && (key === "brandProfiles" || key === "templateDraft")) {
    throw new Error("يتطلب حفظ البيانات الشخصية تفعيل تخزين المتصفح IndexedDB");
  }
  if (!db) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed =
        JSON.parse(
          localStorage.getItem(LS_SETTINGS) ??
            localStorage.getItem(LEGACY_LS_SETTINGS) ??
            "{}",
        ) || {};
    } catch {
      parsed = {};
    }
    parsed[rowKey] = value;
    localStorage.setItem(LS_SETTINGS, JSON.stringify(parsed));
    return;
  }
  try {
    await tx(db, SETTINGS, "readwrite", (t) =>
      request(t.objectStore(SETTINGS).put({ key: rowKey, value })),
    );
  } catch (error) {
    if (key === "templateDraft") throw error;
    /* other settings are best-effort; losing one must not break the editor */
  }
}

/** Raised by the atomic custom-template write when the owner's limit is full. */
export class CustomTemplateRowLimitError extends Error {
  constructor() {
    super("Custom template limit reached");
    this.name = "CustomTemplateRowLimitError";
  }
}

const TEMPLATE_DRAFT_SETTING_KEY = "templateDraft";
const LEGACY_TEMPLATE_DATA_MIGRATION_KEY = "legacyCustomTemplateDataMigratedV1";

type OwnedTemplateRow<T> = T & { id: string; ownerId?: string | null };

function requireTemplateDatabase(db: IDBDatabase | null): IDBDatabase {
  if (!db) {
    throw new Error("IndexedDB is required for personal templates and template drafts");
  }
  return db;
}

/** Read only the current owner's templates from the shared editor database. */
export async function listCustomTemplateRows<T extends { id: string }>(): Promise<T[]> {
  const ownerId = getStorageOwner();
  const db = requireTemplateDatabase(await openDb());
  const rows = (await tx(db, CUSTOM_TEMPLATES, "readonly", (t) =>
    request(t.objectStore(CUSTOM_TEMPLATES).getAll()),
  )) as OwnedTemplateRow<T>[];
  if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during template read");
  const { visible, adopted } = partitionOwned(rows);
  if (adopted.length) {
    await tx(db, CUSTOM_TEMPLATES, "readwrite", async (t) => {
      const store = t.objectStore(CUSTOM_TEMPLATES);
      for (const row of adopted) {
        if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during template adoption");
        const current = (await request(store.get(row.id))) as OwnedTemplateRow<T> | undefined;
        if (!current || rowOwnership(current) === "foreign") continue;
        await request(store.put({ ...current, ownerId }));
      }
    });
  }
  if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during template read");
  return visible.map(strip);
}

/**
 * Save or replace one template. The limit check and ownership check share the
 * same IndexedDB transaction as the write, so racing tabs cannot exceed the
 * per-owner limit or overwrite another account's row.
 */
export async function saveCustomTemplateRow<T extends { id: string }>(
  row: T,
  maxItems: number,
): Promise<void> {
  if (!row.id) throw new Error("A custom template needs an id");
  const ownerId = getStorageOwner();
  const db = requireTemplateDatabase(await openDb());
  await tx(db, CUSTOM_TEMPLATES, "readwrite", async (t) => {
    const store = t.objectStore(CUSTOM_TEMPLATES);
    const rows = (await request(store.getAll())) as OwnedTemplateRow<T>[];
    if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during template save");
    const existing = rows.find((candidate) => candidate.id === row.id);
    if (existing && !canRead(existing)) {
      throw new Error("Cannot replace another owner's custom template");
    }
    const visibleCount = rows.filter((candidate) => rowOwnership(candidate) !== "foreign").length;
    if (!existing && visibleCount >= maxItems) throw new CustomTemplateRowLimitError();
    for (const candidate of rows) {
      if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during template save");
      if (rowOwnership(candidate) === "adoptable") {
        await request(store.put({ ...candidate, ownerId }));
      }
    }
    if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during template save");
    await request(store.put({ ...clone(row), ownerId }));
  });
  if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during template save");
}

/** Delete a template only when the current owner can read its row. */
export async function deleteCustomTemplateRow(id: string): Promise<boolean> {
  const ownerId = getStorageOwner();
  const db = requireTemplateDatabase(await openDb());
  return tx(db, CUSTOM_TEMPLATES, "readwrite", async (t) => {
    const store = t.objectStore(CUSTOM_TEMPLATES);
    const row = (await request(store.get(id))) as OwnedTemplateRow<{ id: string }> | undefined;
    if (!row || !canRead(row)) return false;
    if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during template delete");
    await request(store.delete(id));
    return true;
  });
}

/** Owner-scoped, IndexedDB-only access to the edit-draft setting. */
export async function getCustomTemplateDraft<T>(): Promise<T | null> {
  const ownerId = getStorageOwner();
  const db = requireTemplateDatabase(await openDb());
  const rowKey = `${TEMPLATE_DRAFT_SETTING_KEY}::${ownerId}`;
  const row = (await tx(db, SETTINGS, "readonly", (t) =>
    request(t.objectStore(SETTINGS).get(rowKey)),
  )) as SettingRow | undefined;
  if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during draft read");
  return (row?.value ?? null) as T | null;
}

export async function setCustomTemplateDraft(value: unknown): Promise<void> {
  const ownerId = getStorageOwner();
  const db = requireTemplateDatabase(await openDb());
  const rowKey = `${TEMPLATE_DRAFT_SETTING_KEY}::${ownerId}`;
  await tx(db, SETTINGS, "readwrite", (t) => {
    if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during draft save");
    return request(t.objectStore(SETTINGS).put({ key: rowKey, value: clone(value) }));
  });
  if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during draft save");
}

export async function deleteCustomTemplateDraft(): Promise<void> {
  const ownerId = getStorageOwner();
  const db = requireTemplateDatabase(await openDb());
  const rowKey = `${TEMPLATE_DRAFT_SETTING_KEY}::${ownerId}`;
  await tx(db, SETTINGS, "readwrite", (t) => {
    if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during draft delete");
    return request(t.objectStore(SETTINGS).delete(rowKey));
  });
  if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during draft delete");
}

/**
 * One-time, atomic migration of the old unscoped localStorage catalog and its
 * edit draft into this owner's existing IndexedDB database. The caller removes
 * the legacy keys only after this transaction commits.
 */
export async function migrateLegacyCustomTemplateData<
  T extends { id: string },
  D,
>(
  templates: T[],
  draft: D | null,
  sourceFingerprints: { templates: string | null; draft: string | null },
): Promise<{ complete: boolean; alreadyMigrated: boolean; imported: number }> {
  if (!hasSignedInOwner()) {
    return { complete: false, alreadyMigrated: false, imported: 0 };
  }
  if (sourceFingerprints.templates === null && sourceFingerprints.draft === null) {
    return { complete: false, alreadyMigrated: false, imported: 0 };
  }
  const ownerId = getStorageOwner();
  const db = requireTemplateDatabase(await openDb());
  return tx(db, [CUSTOM_TEMPLATES, SETTINGS], "readwrite", async (t) => {
    const settings = t.objectStore(SETTINGS);
    const marker = (await request(settings.get(LEGACY_TEMPLATE_DATA_MIGRATION_KEY))) as SettingRow | undefined;
    if (marker) {
      const previous = (marker.value as {
        sourceFingerprints?: { templates?: unknown; draft?: unknown };
      } | null)?.sourceFingerprints;
      const unchanged = previous &&
        (sourceFingerprints.templates === null || sourceFingerprints.templates === previous.templates) &&
        (sourceFingerprints.draft === null || sourceFingerprints.draft === previous.draft);
      if (!unchanged) {
        throw new Error("Legacy template data changed after its durable migration; source keys were retained");
      }
      return { complete: true, alreadyMigrated: true, imported: 0 };
    }
    if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during template migration");

    const store = t.objectStore(CUSTOM_TEMPLATES);
    const existingRows = (await request(store.getAll())) as OwnedTemplateRow<T>[];
    let imported = 0;
    for (const legacy of templates) {
      if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during template migration");
      if (!legacy?.id || typeof legacy.id !== "string") {
        throw new Error("Legacy template data is invalid; migration was not committed");
      }
      const existing = existingRows.find((row) => row.id === legacy.id);
      if (existing) {
        if (rowOwnership(existing) === "foreign") {
          throw new Error("Legacy template id conflicts with another owner's row");
        }
        throw new Error("Legacy template id conflicts with an existing owner's row; source keys were retained");
      }
      await request(store.put({ ...clone(legacy), ownerId }));
      imported += 1;
    }

    if (draft !== null) {
      if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during template migration");
      const draftKey = `${TEMPLATE_DRAFT_SETTING_KEY}::${ownerId}`;
      const existingDraft = await request(settings.get(draftKey));
      if (!existingDraft) await request(settings.put({ key: draftKey, value: clone(draft) }));
    }
    if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during template migration");
    await request(
      settings.put({
        key: LEGACY_TEMPLATE_DATA_MIGRATION_KEY,
        value: { ownerId, migratedAt: Date.now(), imported, draft: draft !== null, sourceFingerprints },
      }),
    );
    return { complete: true, alreadyMigrated: false, imported };
  });
}

/**
 * One-time upgrade of the pre-upgrade single-project autosave slot into the
 * library. Returns the migrated project so the caller can open it directly.
 */
export async function migrateLegacyProject(
  raw: unknown,
): Promise<Project | null> {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<Project> & { activePageId?: string };
  if (!Array.isArray(data.pages) || data.pages.length === 0) return null;
  const project: Project = {
    version: data.version || 2,
    name: data.name || "تقرير مستعاد",
    theme: data.theme || "official",
    orgName: data.orgName || "",
    defaultSize: data.defaultSize || "a4-portrait",
    id: uid("proj"),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pages: data.pages,
  };
  return saveProject(project);
}

/**
 * Delete every project the CURRENT owner may see. Other owners' rows are left
 * untouched — a clear inside one session can never wipe another account's
 * library sharing this browser.
 */
export async function clearAllProjects(): Promise<void> {
  const db = await openDb();
  if (!db) {
    const doomed = new Set(fallback.all().map((p) => p.id));
    fallback.write(fallback.raw().filter((row) => !doomed.has(row.id)));
    return;
  }
  const rows = (await tx(db, PROJECTS, "readonly", (t) =>
    request(t.objectStore(PROJECTS).getAll()),
  )) as OwnedRow<Project>[];
  const doomed = rows.filter((row) => canRead(row));
  if (!doomed.length) return;
  await tx(db, PROJECTS, "readwrite", (t) => {
    for (const row of doomed) {
      if (row.id) t.objectStore(PROJECTS).delete(row.id);
    }
  });
}

/**
 * localStorage mirror for assets, used when IndexedDB is unavailable.
 *
 * Assets are data URLs like project images, so this path is a last resort that
 * can hit the ~5 MB ceiling — it exists so a private window still opens, not so
 * it can hold a real library.
 */
const assetFallback = {
  /** Raw stored rows — may belong to ANY owner; never render directly. */
  raw(): OwnedRow<Asset>[] {
    try {
      const raw =
        localStorage.getItem(LS_ASSETS) ??
        localStorage.getItem(LEGACY_LS_ASSETS);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as OwnedRow<Asset>[]) : [];
    } catch {
      return [];
    }
  },
  write(list: OwnedRow<Asset>[]) {
    // Legacy rows can be read for recovery, but no binary writes go to Web Storage.
    if (list.length) throw new Error("يتطلب حفظ الوسائط تفعيل تخزين المتصفح IndexedDB");
    localStorage.removeItem(LS_ASSETS);
  },
  /** The current owner's rows only, adopting unstamped rows on first read. */
  all(): Asset[] {
    const rows = this.raw();
    // Unclaimed legacy binaries require IDB before ownership can be persisted.
    return rows.filter(row => rowOwnership(row) === "own").map(strip);
  },
};

export async function listAssets(): Promise<Asset[]> {
  const db = await openDb();
  if (!db) return assetFallback.all().sort((a, b) => b.addedAt - a.addedAt);
  try {
    const rows = (await tx(db, ASSETS, "readonly", (t) =>
      request(t.objectStore(ASSETS).getAll()),
    )) as OwnedRow<Asset>[];
    const { visible, adopted } = partitionOwned(rows);
    if (adopted.length) {
      await tx(db, ASSETS, "readwrite", (t) => {
        for (const row of adopted) t.objectStore(ASSETS).put(row);
      }).catch(() => undefined);
    }
    return visible
      .map((row) => strip(row))
      .sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

export async function saveAsset(
  asset: Omit<Asset, "id" | "addedAt"> & Partial<Asset>,
): Promise<Asset> {
  const ownerId = getStorageOwner();
  const stamped: Asset = {
    ...asset,
    id: asset.id || uid("asset"),
    addedAt: asset.addedAt || Date.now(),
  };
  const db = await openDb();
  if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during save");
  if (!db) throw new Error("يتطلب حفظ الوسائط تفعيل تخزين المتصفح IndexedDB");
  await tx(db, ASSETS, "readwrite", async (t) => {
    const store = t.objectStore(ASSETS);
    const existing = await request(store.get(stamped.id)) as OwnedRow<Asset> | undefined;
    if (existing && !canRead(existing)) throw new Error("لا يمكن استبدال ملف تابع لحساب آخر");
    if (ownerId !== getStorageOwner()) throw new Error("Storage owner changed during save");
    await request(store.put({ ...stamped, ownerId }));
  });
  return stamped;
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    // Only a row the current owner may read can be deleted.
    if (!assetFallback.all().some((a) => a.id === id)) return;
    assetFallback.write(assetFallback.raw().filter((a) => a.id !== id));
    return;
  }
  const row = (await tx(db, ASSETS, "readonly", (t) =>
    request(t.objectStore(ASSETS).get(id)),
  )) as OwnedRow<Asset> | undefined;
  if (row && !canRead(row)) return;
  await tx(db, ASSETS, "readwrite", (t) =>
    request(t.objectStore(ASSETS).delete(id)),
  );
}

export async function renameAsset(id: string, name: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    const visible = new Set(assetFallback.all().map((a) => a.id));
    if (!visible.has(id)) return;
    assetFallback.write(
      assetFallback
        .raw()
        .map((a) => (a.id === id ? { ...a, name } : a)),
    );
    return;
  }
  const row = (await tx(db, ASSETS, "readonly", (t) =>
    request(t.objectStore(ASSETS).get(id)),
  )) as OwnedRow<Asset> | undefined;
  if (!row || !canRead(row)) return;
  await tx(db, ASSETS, "readwrite", (t) =>
    request(t.objectStore(ASSETS).put({ ...row, name })),
  );
}

// ── Offline Extensions ───────────────────────────────────────────────────────
export const OFFLINE_STORES = { SYNC_QUEUE, OFFLINE_TEMPLATES, WORKSPACE_CACHE } as const;

/** Expose the underlying DB for offline modules that share the same versioned schema. */
export function getOfflineDb(): Promise<IDBDatabase | null> {
  return openDb();
}
export function offlineTx<T>(db: IDBDatabase, stores: string | string[], mode: IDBTransactionMode, run: (t: IDBTransaction)=>Promise<T>|T): Promise<T> {
  return tx(db, stores, mode, run);
}
export function offlineRequest<T>(req: IDBRequest<T>): Promise<T> { return request(req); }
export function resetDbForTests(): void { dbPromise = null; }
