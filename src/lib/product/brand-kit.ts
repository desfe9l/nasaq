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

/**
 * WCAG relative luminance / contrast — the identity's readability check.
 *
 * A palette is a design decision, but "can this text be read on this paper"
 * is arithmetic. Document Identity therefore audits its own colours and offers
 * the smallest correction (a darker text colour) instead of telling the author
 * that something "looks low contrast".
 */
function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return 0;
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(full.slice(0, 2), 16));
  const g = channel(parseInt(full.slice(2, 4), 16));
  const b = channel(parseInt(full.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

/** Darken a hex colour until it clears AA (4.5:1) on the given background. */
export function readableOn(hex: string, background: string): string {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#1f2937";
  let current = clean;
  for (let step = 0; step < 24 && contrastRatio(current, background) < 4.5; step += 1) {
    const r = Math.max(0, Math.round(parseInt(current.slice(1, 3), 16) * 0.88));
    const g = Math.max(0, Math.round(parseInt(current.slice(3, 5), 16) * 0.88));
    const b = Math.max(0, Math.round(parseInt(current.slice(5, 7), 16) * 0.88));
    current = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }
  return current;
}

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
