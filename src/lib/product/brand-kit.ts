import { DEFAULT_BRAND_KIT, type BrandKit } from "./product";

/**
 * Brand Kit profiles ("هوية مستندك").
 *
 * v2 storage document holds several named profiles plus the active id:
 *   { version: 2, activeId, profiles: [{ id, name, updatedAt, kit }] }
 * A legacy flat kit (the original single-identity format) is migrated into
 * one profile on first read, so old local data keeps working untouched.
 *
 * Export/import move the whole profile list as one JSON file
 * (`kind: nasaq-brand-kit`), merging on import under fresh ids.
 */
const STORAGE_KEY = "diwan-brand-kit-v1";

export const BRAND_KIT_FILE_KIND = "nasaq-brand-kit";

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

function readDoc(): BrandProfilesDoc {
  if (typeof localStorage === "undefined") return parseDoc(null);
  return parseDoc(localStorage.getItem(STORAGE_KEY));
}

function writeDoc(doc: BrandProfilesDoc): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
}

/** The active profile's kit (legacy single-kit callers keep working). */
export function readBrandKit(): BrandKit {
  const doc = readDoc();
  return (
    doc.profiles.find((p) => p.id === doc.activeId)?.kit || doc.profiles[0].kit
  );
}

/** Persist the given kit into the active profile. */
export function saveBrandKit(kit: BrandKit): void {
  const doc = readDoc();
  const profile = doc.profiles.find((p) => p.id === doc.activeId);
  if (profile) {
    profile.kit = { ...kit };
    profile.updatedAt = Date.now();
  }
  writeDoc(doc);
}

/** Reset the active profile's kit back to defaults (profiles kept). */
export function resetBrandKit(): BrandKit {
  saveBrandKit({ ...DEFAULT_BRAND_KIT });
  return { ...DEFAULT_BRAND_KIT };
}

// ── Multi-profile API ────────────────────────────────────────────────────────

export function listBrandProfiles(): {
  profiles: Array<Pick<BrandProfile, "id" | "name" | "updatedAt">>;
  activeId: string;
} {
  const doc = readDoc();
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
export function createBrandProfile(name: string): string {
  const doc = readDoc();
  const trimmed = name.trim() || `هوية ${doc.profiles.length + 1}`;
  const profile: BrandProfile = {
    id: uid("brand"),
    name: trimmed.slice(0, 60),
    updatedAt: Date.now(),
    kit: { ...DEFAULT_BRAND_KIT },
  };
  doc.profiles.push(profile);
  doc.activeId = profile.id;
  writeDoc(doc);
  return profile.id;
}

/** Switch the active profile and return its kit. */
export function switchBrandProfile(id: string): BrandKit {
  const doc = readDoc();
  const profile = doc.profiles.find((p) => p.id === id);
  if (profile) {
    doc.activeId = profile.id;
    writeDoc(doc);
    return profile.kit;
  }
  return readBrandKit();
}

export function renameBrandProfile(id: string, name: string): void {
  const doc = readDoc();
  const profile = doc.profiles.find((p) => p.id === id);
  const trimmed = name.trim();
  if (profile && trimmed) {
    profile.name = trimmed.slice(0, 60);
    profile.updatedAt = Date.now();
    writeDoc(doc);
  }
}

/** Delete a profile (never the last one — the kit needs a home). */
export function deleteBrandProfile(id: string): boolean {
  const doc = readDoc();
  if (doc.profiles.length <= 1) return false;
  const next = doc.profiles.filter((p) => p.id !== id);
  if (next.length === doc.profiles.length) return false;
  doc.profiles = next;
  if (doc.activeId === id) doc.activeId = next[0].id;
  writeDoc(doc);
  return true;
}

/** Serialise every profile into a downloadable .json file. Returns filename. */
export function exportBrandProfiles(): string {
  const doc = readDoc();
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
export function importBrandProfiles(raw: unknown): number {
  const file = raw as { kind?: string; profiles?: Array<{ name?: string; kit?: Partial<BrandKit> }> } | null;
  if (!file || file.kind !== BRAND_KIT_FILE_KIND || !Array.isArray(file.profiles)) {
    throw new Error("الملف ليس ملف هوية صالح — اصدّره من صفحة «هوية مستندك».");
  }
  const doc = readDoc();
  const existingNames = new Set(doc.profiles.map((p) => p.name));
  let added = 0;
  for (const entry of file.profiles) {
    if (!entry || typeof entry !== "object") continue;
    let name = (typeof entry.name === "string" && entry.name.trim()) || "هوية مستوردة";
    name = name.slice(0, 55);
    while (existingNames.has(name)) name = `${name} (مستورد)`.slice(0, 60);
    existingNames.add(name);
    doc.profiles.push({
      id: uid("brand"),
      name,
      updatedAt: Date.now(),
      kit: mergeKit(entry.kit),
    });
    added += 1;
  }
  if (added) writeDoc(doc);
  return added;
}
