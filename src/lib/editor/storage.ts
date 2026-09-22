import { clone, projectMeta, type Project, type ProjectMeta } from "./model";
import { uid } from "@/lib/utils";

/**
 * Project library persistence.
 *
 * Reports embed images as data URLs, so a single project can run into tens of
 * megabytes — far past the ~5 MB localStorage ceiling. IndexedDB is the primary
 * store; localStorage is kept as a small-metadata fallback for browsers where
 * IndexedDB is unavailable (private windows, hardened settings) so the app still
 * opens and warns instead of losing work silently.
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
const DB_VERSION = 3;
const PROJECTS = "projects";
const SETTINGS = "settings";
const ASSETS = "assets";
const LS_PROJECTS = "nasaq-projects-v1";
const LS_SETTINGS = "nasaq-settings-v1";
const LS_ASSETS = "nasaq-assets-v1";
/** Pre-rebrand localStorage mirror slots, read as a fallback on first run. */
const LEGACY_LS_PROJECTS = "diwan-projects-v1";
const LEGACY_LS_SETTINGS = "diwan-settings-v1";
const LEGACY_LS_ASSETS = "diwan-assets-v1";

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
}

export interface AssetFolder {
  id: string;
  name: string;
  createdAt: number;
}

export type SettingsKey =
  | "activeProjectId"
  | "dark"
  | "zoom"
  | "focusMode"
  | "leftOpen"
  | "rightOpen"
  | "leftCollapsed"
  | "rightCollapsed"
  | "assetFolders"
  /** SVG icons/dividers the author added to the smart library. */
  | "customLibrary";

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
        const keyPath = MIRRORED_STORES.find((s) => s.name === name)?.keyPath ?? "id";
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
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      // Resolve only after the copy settles, so the first read already sees the
      // migrated library rather than racing it.
      void migrateLegacyDb(db)
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
    t.onerror = () => reject(t.error ?? new Error("IndexedDB transaction failed"));
    t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted"));
    t.oncomplete = () => resolve(result as T);
    let result: T;
    Promise.resolve(run(t)).then((value) => {
      result = value;
    }, reject);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/** localStorage mirror used only when IndexedDB is unavailable. */
const fallback = {
  all(): Project[] {
    try {
      // Read through the pre-rebrand slot until the new one has been written,
      // so a private-window session keeps the projects it saved before.
      const raw =
        localStorage.getItem(LS_PROJECTS) ?? localStorage.getItem(LEGACY_LS_PROJECTS);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as Project[]) : [];
    } catch {
      return [];
    }
  },
  write(list: Project[]) {
    localStorage.setItem(LS_PROJECTS, JSON.stringify(list));
  },
  get(id: string) {
    return this.all().find((p) => p.id === id) || null;
  },
  put(project: Project) {
    const list = this.all().filter((p) => p.id !== project.id);
    list.push(project);
    this.write(list);
  },
  remove(id: string) {
    this.write(this.all().filter((p) => p.id !== id));
  },
};

export function storageMode(): "indexeddb" | "localstorage" {
  return typeof indexedDB === "undefined" ? "localstorage" : "indexeddb";
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const db = await openDb();
  if (!db) return fallback.all().map(projectMeta).sort(byRecency);
  try {
    const rows = await tx(db, PROJECTS, "readonly", (t) => request(t.objectStore(PROJECTS).getAll()));
    return (rows as Project[]).map(projectMeta).sort(byRecency);
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
    const row = await tx(db, PROJECTS, "readonly", (t) => request(t.objectStore(PROJECTS).get(id)));
    return (row as Project | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveProject(project: Project): Promise<Project> {
  const stamped: Project = {
    ...project,
    id: project.id || uid("proj"),
    createdAt: project.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  const db = await openDb();
  if (!db) {
    fallback.put(stamped);
    return stamped;
  }
  await tx(db, PROJECTS, "readwrite", (t) => request(t.objectStore(PROJECTS).put(clone(stamped))));
  return stamped;
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    fallback.remove(id);
    return;
  }
  await tx(db, PROJECTS, "readwrite", (t) => request(t.objectStore(PROJECTS).delete(id)));
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
    pages: source.pages.map((p) => ({ ...clone(p), id: uid("page"), elements: p.elements.map((e) => ({ ...clone(e), id: uid("el") })) })),
  };
  return saveProject(copy);
}

export async function getSetting<T = unknown>(key: SettingsKey): Promise<T | null> {
  const db = await openDb();
  if (!db) {
    try {
      const raw = localStorage.getItem(LS_SETTINGS) ?? localStorage.getItem(LEGACY_LS_SETTINGS);
      const parsed = raw ? JSON.parse(raw) : {};
      return (parsed?.[key] ?? null) as T | null;
    } catch {
      return null;
    }
  }
  try {
    const row = await tx(db, SETTINGS, "readonly", (t) => request(t.objectStore(SETTINGS).get(key)));
    return ((row as { key: string; value: unknown } | undefined)?.value ?? null) as T | null;
  } catch {
    return null;
  }
}

export async function setSetting(key: SettingsKey, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(
        localStorage.getItem(LS_SETTINGS) ??
          localStorage.getItem(LEGACY_LS_SETTINGS) ??
          "{}",
      ) || {};
    } catch {
      parsed = {};
    }
    parsed[key] = value;
    localStorage.setItem(LS_SETTINGS, JSON.stringify(parsed));
    return;
  }
  try {
    await tx(db, SETTINGS, "readwrite", (t) =>
      request(t.objectStore(SETTINGS).put({ key, value })),
    );
  } catch {
    /* settings are best-effort; losing one must not break the editor */
  }
}

/**
 * One-time upgrade of the pre-upgrade single-project autosave slot into the
 * library. Returns the migrated project so the caller can open it directly.
 */
export async function migrateLegacyProject(raw: unknown): Promise<Project | null> {
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

export async function clearAllProjects(): Promise<void> {
  const db = await openDb();
  if (!db) {
    fallback.write([]);
    return;
  }
  await tx(db, PROJECTS, "readwrite", (t) => request(t.objectStore(PROJECTS).clear()));
}

/**
 * localStorage mirror for assets, used when IndexedDB is unavailable.
 *
 * Assets are data URLs like project images, so this path is a last resort that
 * can hit the ~5 MB ceiling — it exists so a private window still opens, not so
 * it can hold a real library.
 */
const assetFallback = {
  all(): Asset[] {
    try {
      const raw = localStorage.getItem(LS_ASSETS) ?? localStorage.getItem(LEGACY_LS_ASSETS);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as Asset[]) : [];
    } catch {
      return [];
    }
  },
  write(list: Asset[]) {
    localStorage.setItem(LS_ASSETS, JSON.stringify(list));
  },
};

export async function listAssets(): Promise<Asset[]> {
  const db = await openDb();
  if (!db) return assetFallback.all().sort((a, b) => b.addedAt - a.addedAt);
  try {
    const rows = await tx(db, ASSETS, "readonly", (t) => request(t.objectStore(ASSETS).getAll()));
    return (rows as Asset[]).sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

export async function saveAsset(asset: Omit<Asset, "id" | "addedAt"> & Partial<Asset>): Promise<Asset> {
  const stamped: Asset = {
    ...asset,
    id: asset.id || uid("asset"),
    addedAt: asset.addedAt || Date.now(),
  };
  const db = await openDb();
  if (!db) {
    assetFallback.write([stamped, ...assetFallback.all().filter((a) => a.id !== stamped.id)]);
    return stamped;
  }
  await tx(db, ASSETS, "readwrite", (t) => request(t.objectStore(ASSETS).put(stamped)));
  return stamped;
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    assetFallback.write(assetFallback.all().filter((a) => a.id !== id));
    return;
  }
  await tx(db, ASSETS, "readwrite", (t) => request(t.objectStore(ASSETS).delete(id)));
}

export async function renameAsset(id: string, name: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    assetFallback.write(assetFallback.all().map((a) => (a.id === id ? { ...a, name } : a)));
    return;
  }
  const row = (await tx(db, ASSETS, "readonly", (t) => request(t.objectStore(ASSETS).get(id)))) as
    | Asset
    | undefined;
  if (!row) return;
  await tx(db, ASSETS, "readwrite", (t) =>
    request(t.objectStore(ASSETS).put({ ...row, name })),
  );
}
