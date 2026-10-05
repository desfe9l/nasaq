import { getSetting, setSetting } from "../editor/storage";
import { getStorageOwner, hasSignedInOwner } from "../editor/storage-owner";
import { DEFAULT_BRAND_KIT, type BrandKit } from "./product";

/**
 * Brand Kit profiles ("هوية مستندك").
 *
 * v2 storage document holds several named profiles plus the active id:
 *   { version: 2, activeId, profiles: [{ id, name, updatedAt, kit }] }
 * Stored in owner-scoped IndexedDB settings, including logo/stamp binaries.
 * An unscoped legacy kit is migrated once on a signed-in owner’s first read.
 *
 * Export/import move the whole profile list as one JSON file
 * (`kind: nasaq-brand-kit`), merging on import under fresh ids.
 */
const STORAGE_KEY = "diwan-brand-kit-v1";

export const BRAND_KIT_FILE_KIND = "nasaq-brand-kit";

/**
 * WCAG relative luminance / contrast — the identity's readability check.
 *
 * A palette is a design decision, but "can this text be read on this paper"
 * is arithmetic. Document Identity therefore audits its own colours and offers
 * the smallest correction (a darker text colour) instead of telling the author
 * that something "looks low contrast".
 *
 * The arithmetic itself lives in `product/contrast.ts` — a storage-free module —
 * and is re-exported here so every existing caller keeps importing it from the
 * identity it belongs to.
 */
export { contrastRatio, readableOn } from "./contrast";

export interface BrandProfile {
  id: string;
  name: string;
  updatedAt: number;
  kit: BrandKit;
}

interface BrandProfilesDoc {
  version: 2;
  activeId: string;
  profiles: BrandProfile[];
}

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mergeKit(partial: Partial<BrandKit> | undefined | null): BrandKit {
  return { ...DEFAULT_BRAND_KIT, ...(partial || {}) };
}

/** Parse any stored value (v2 doc / legacy flat kit / garbage) into a doc. */
function parseDoc(raw: string | null): BrandProfilesDoc {
  try {
    const parsed = JSON.parse(raw || "null") as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") throw new Error("empty");
    // v2 document.
    if (Array.isArray(parsed.profiles) && parsed.profiles.length) {
      const profiles = (parsed.profiles as BrandProfile[])
        .filter((p) => p && typeof p === "object")
        .map((p) => ({
          id: typeof p.id === "string" && p.id ? p.id : uid("brand"),
          name: typeof p.name === "string" && p.name.trim() ? p.name : "هوية",
          updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : Date.now(),
          kit: mergeKit(p.kit),
        }));
      if (profiles.length) {
        const activeId =
          typeof parsed.activeId === "string" &&
          profiles.some((p) => p.id === parsed.activeId)
            ? parsed.activeId
            : profiles[0].id;
        return { version: 2, activeId, profiles };
      }
    }
    // Legacy flat kit → single profile.
    if ("organizationName" in parsed || "primaryColor" in parsed) {
      const kit = mergeKit(parsed as Partial<BrandKit>);
      return {
        version: 2,
        activeId: "brand-default",
        profiles: [
          {
            id: "brand-default",
            name: kit.organizationName?.trim() || "الهوية الأساسية",
            updatedAt: Date.now(),
            kit,
          },
        ],
      };
    }
    throw new Error("unrecognised");
  } catch {
    const kit = { ...DEFAULT_BRAND_KIT };
    return {
      version: 2,
      activeId: "brand-default",
      profiles: [
        { id: "brand-default", name: "الهوية الأساسية", updatedAt: Date.now(), kit },
      ],
    };
  }
}

const documentOwners = new WeakMap<BrandProfilesDoc, string>();
async function readDoc(): Promise<BrandProfilesDoc> {
  const owner = getStorageOwner();
  const stored = await getSetting<BrandProfilesDoc>("brandProfiles");
  if (owner !== getStorageOwner()) throw new Error("تغير الحساب أثناء تحميل الهوية");
  let doc = parseDoc(stored ? JSON.stringify(stored) : null);
  documentOwners.set(doc, owner);
  // Only a signed-in account may claim an old, unscoped identity. Remove the
  // legacy binary blob after durable migration; a later user cannot adopt it.
  if (!stored && hasSignedInOwner() && typeof localStorage !== "undefined") {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      doc = parseDoc(raw); documentOwners.set(doc, owner);
      await writeDoc(doc);
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  return doc;
}

async function writeDoc(doc: BrandProfilesDoc): Promise<void> {
  if (documentOwners.get(doc) !== getStorageOwner()) throw new Error("تغير الحساب أثناء حفظ الهوية");
  await setSetting("brandProfiles", doc);
}

/** The active profile's kit (legacy single-kit callers keep working). */
export async function readBrandKit(): Promise<BrandKit> {
  const doc = await readDoc();
  return (
    doc.profiles.find((p) => p.id === doc.activeId)?.kit || doc.profiles[0].kit
  );
}

/** Persist the given kit into the active profile. */
export async function saveBrandKit(kit: BrandKit): Promise<void> {
  const doc = await readDoc();
  const profile = doc.profiles.find((p) => p.id === doc.activeId);
  if (profile) {
    profile.kit = { ...kit };
    profile.updatedAt = Date.now();
  }
  await writeDoc(doc);
}

/** Reset the active profile's kit back to defaults (profiles kept). */
export async function resetBrandKit(): Promise<BrandKit> {
  await saveBrandKit({ ...DEFAULT_BRAND_KIT });
  return { ...DEFAULT_BRAND_KIT };
}

// ── Multi-profile API ────────────────────────────────────────────────────────

export async function listBrandProfiles(): Promise<{
  profiles: Array<Pick<BrandProfile, "id" | "name" | "updatedAt">>;
  activeId: string;
}> {
  const doc = await readDoc();
  return {
    profiles: doc.profiles.map(({ id, name, updatedAt }) => ({
      id,
      name,
      updatedAt,
    })),
    activeId: doc.activeId,
  };
}

/** Create a fresh profile (defaults kit) and make it active. Returns its id. */
export async function createBrandProfile(name: string): Promise<string> {
  const doc = await readDoc();
  const trimmed = name.trim() || `هوية ${doc.profiles.length + 1}`;
  const profile: BrandProfile = {
    id: uid("brand"),
    name: trimmed.slice(0, 60),
    updatedAt: Date.now(),
    kit: { ...DEFAULT_BRAND_KIT },
  };
  doc.profiles.push(profile);
  doc.activeId = profile.id;
  await writeDoc(doc);
  return profile.id;
}

/** Switch the active profile and return its kit. */
export async function switchBrandProfile(id: string): Promise<BrandKit> {
  const doc = await readDoc();
  const profile = doc.profiles.find((p) => p.id === id);
  if (profile) {
    doc.activeId = profile.id;
    await writeDoc(doc);
    return profile.kit;
  }
  return readBrandKit();
}

export async function renameBrandProfile(id: string, name: string): Promise<void> {
  const doc = await readDoc();
  const profile = doc.profiles.find((p) => p.id === id);
  const trimmed = name.trim();
  if (profile && trimmed) {
    profile.name = trimmed.slice(0, 60);
    profile.updatedAt = Date.now();
    await writeDoc(doc);
  }
}

/** Delete a profile (never the last one — the kit needs a home). */
export async function deleteBrandProfile(id: string): Promise<boolean> {
  const doc = await readDoc();
  if (doc.profiles.length <= 1) return false;
  const next = doc.profiles.filter((p) => p.id !== id);
  if (next.length === doc.profiles.length) return false;
  doc.profiles = next;
  if (doc.activeId === id) doc.activeId = next[0].id;
  await writeDoc(doc);
  return true;
}

/** Serialise every profile into a downloadable .json file. Returns filename. */
export async function exportBrandProfiles(): Promise<string> {
  const doc = await readDoc();
  const file = {
    kind: BRAND_KIT_FILE_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: doc.profiles.map((p) => ({ name: p.name, kit: p.kit })),
  };
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const name = `nasaq-brand-kit-${new Date().toISOString().slice(0, 10)}.json`;
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return name;
}

/**
 * Import profiles from an exported .json — merges (fresh ids, same-name
 * profiles get a « (مستورد)» suffix) so nothing local is overwritten.
 * Returns how many profiles were added.
 */
export async function importBrandProfiles(raw: unknown): Promise<number> {
  const file = raw as { kind?: string; profiles?: Array<{ name?: string; kit?: Partial<BrandKit> }> } | null;
  if (!file || file.kind !== BRAND_KIT_FILE_KIND || !Array.isArray(file.profiles)) {
    throw new Error("الملف ليس ملف هوية صالح — اصدّره من صفحة «هوية مستندك».");
  }
  const doc = await readDoc();
  const existingNames = new Set(doc.profiles.map((p) => p.name));
  let added = 0;
  for (const entry of file.profiles) {
    if (!entry || typeof entry !== "object") continue;
    let name = (typeof entry.name === "string" && entry.name.trim()) || "هوية مستوردة";
    name = name.slice(0, 55);
    const baseName = name.slice(0, 40);
    let suffix = 1;
    while (existingNames.has(name)) name = `${baseName} (مستورد ${suffix++})`;
    existingNames.add(name);
    doc.profiles.push({
      id: uid("brand"),
      name,
      updatedAt: Date.now(),
      kit: mergeKit(entry.kit),
    });
    added += 1;
  }
  if (added) await writeDoc(doc);
  return added;
}
