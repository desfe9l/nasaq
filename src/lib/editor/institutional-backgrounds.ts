/**
 * Owner-controlled institutional page backgrounds.
 *
 * This is a catalog, not a decorative folder. The owner publishes image
 * backgrounds; entitled sessions read the published rows and apply them as
 * `page.bgImage` (cover/contain + position), never as a foreground element.
 */

export const INSTITUTIONAL_FOLDER_ID = "folder-institutional-backgrounds";
export const INSTITUTIONAL_FOLDER_NAME = "خلفيات مؤسسية";
export const INSTITUTIONAL_CHANGED = "nasaq:institutional-backgrounds";
export const INSTITUTIONAL_MAX_SRC = 2_400_000;

export interface InstitutionalBackground {
  id: string;
  name: string;
  src: string;
  w: number;
  h: number;
  sortOrder: number;
  published: boolean;
  updatedAt: number;
}

export interface InstitutionalCatalog {
  updatedAt: number;
  items: InstitutionalBackground[];
}

const IMAGE_SRC = /^data:image\/(?:png|jpeg|jpg|webp|svg\+xml)(?:;charset=utf-8)?;base64,[A-Za-z0-9+/=\s]+$/;

export function emptyInstitutionalCatalog(): InstitutionalCatalog {
  return { updatedAt: 0, items: [] };
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeInstitutionalCatalog(raw: unknown): InstitutionalCatalog {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rows = Array.isArray(source.items) ? source.items : [];
  const items: InstitutionalBackground[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const id = String(item.id || "").trim();
    const src = String(item.src || "").trim();
    if (!id || seen.has(id) || src.length > INSTITUTIONAL_MAX_SRC || !IMAGE_SRC.test(src)) continue;
    seen.add(id);
    items.push({
      id,
      name: String(item.name || "خلفية").trim().slice(0, 80) || "خلفية",
      src,
      w: Math.max(1, finite(item.w, 1)),
      h: Math.max(1, finite(item.h, 1)),
      sortOrder: finite(item.sortOrder, items.length),
      published: item.published !== false,
      updatedAt: finite(item.updatedAt, 0),
    });
  }
  items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ar"));
  return {
    updatedAt: finite(source.updatedAt, 0),
    items: items.map((item, index) => ({ ...item, sortOrder: index })),
  };
}

export function visibleInstitutionalBackgrounds(
  catalog: InstitutionalCatalog,
  canManage: boolean,
): InstitutionalBackground[] {
  return catalog.items.filter((item) => canManage || item.published);
}

export function applyInstitutionalBackground(
  current: { bgImage?: string; bgImageFit?: "cover" | "contain" },
  item: Pick<InstitutionalBackground, "src">,
): { bgImage: string; bgImageFit: "cover" | "contain"; bgImageX: number; bgImageY: number } {
  return {
    bgImage: item.src,
    bgImageFit: current.bgImageFit === "contain" ? "contain" : "cover",
    bgImageX: 50,
    bgImageY: 50,
  };
}
