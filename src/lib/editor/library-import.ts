/**
 * «أضف مكتبة» — turning ANY folder or file set into NASAQ library shelves.
 *
 * The shelf only understands images, so the importer's job is translation:
 * a designer's asset folder (mixed PNG/JPG/SVG/WEBP, nested sub-folders, a stray
 * `nasaq-library.json`) has to arrive as `{kind, version, folders, assets}` —
 * the one shape `planLibraryImport` accepts — with every asset landing in a
 * folder that actually exists.
 *
 * Two rules drive the design:
 *   · **The folder tree is the taxonomy.** A directory selected with
 *     `webkitdirectory` keeps its shape: `شعارات/رئيسي/a.png` becomes nested
 *     shelves «شعارات» → «رئيسي». A flat multi-select gets one shelf named
 *     after the import.
 *   · **Unsupported files are reported, not fatal.** A `.docx` inside a
 *     screenshots folder must not abandon the ninety PNGs next to it.
 *
 * Pure and browser-free (data in, data out) so it runs under
 * `node --experimental-strip-types`, like the other editor helpers.
 */

/** One file as the DOM hands it to us — only what the planner needs. */
export interface ImportEntry {
  /** File name, or the `webkitRelativePath` when a directory was picked. */
  path: string;
  /** `File.type`; often empty for unknown extensions, hence the name check. */
  mime: string;
  /** Bytes — used only for the size guard, never stored here. */
  size: number;
}

export type ImportKind = "image" | "svg" | "library" | "unsupported";

/** Image extensions the canvas can paint (SVG is routed separately). */
const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "avif",
] as const;

/** Files larger than this are skipped: data URLs live in IndexedDB. */
export const MAX_IMPORT_BYTES = 6 * 1024 * 1024;

/** Folder names that carry no meaning when a folder is imported wholesale. */
const NOISE_SEGMENTS = new Set(["", ".", "..", "__MACOSX"]);

export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Classify one entry. Name wins over MIME: browsers send `""` too often. */
export function importKindFor(entry: Pick<ImportEntry, "path" | "mime">): ImportKind {
  const ext = extensionOf(entry.path);
  if (ext === "svg") return "svg";
  if (ext === "json") return "library";
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return "image";
  if (entry.mime.startsWith("image/svg")) return "svg";
  if (entry.mime.startsWith("image/")) return "image";
  if (entry.mime === "application/json") return "library";
  return "unsupported";
}

/**
 * Split a `webkitRelativePath` into meaningful folder segments.
 *
 * `webkitRelativePath` is `root/child/file.png`, where `root` is the folder the
 * user picked — its own name is the shelf label for a single-folder import, so
 * it is kept here and dropped by the caller when several roots are present.
 */
export function folderSegments(path: string): string[] {
  const parts = path.split(/[\\/]/);
  // Last segment is the file name.
  parts.pop();
  return parts
    .map((segment) => segment.trim())
    .filter((segment) => !NOISE_SEGMENTS.has(segment));
}

/** Human label for a file name: extension stripped, separators spaced. */
export function assetLabel(path: string): string {
  const name = (path.split(/[\\/]/).pop() ?? path).trim();
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const cleaned = stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || name || "عنصر";
}

/**
 * A folder the import will create, keyed by its full path so a name reused at
 * two depths («شعارات/قديم» and «أيقونات/قديم») stays two distinct shelves.
 */
export interface PlannedFolder {
  id: string;
  name: string;
  /** Path of the parent folder, or `null` for a root shelf. */
  parentPath: string | null;
  path: string;
}

export interface LibraryImportBlueprint {
  folders: PlannedFolder[];
  /** Entries that will become assets, each already resolved to a folder path. */
  entries: Array<{ entry: ImportEntry; kind: ImportKind; folderPath: string | null }>;
  /** Entries with no importer — reported to the author, never thrown. */
  unsupported: ImportEntry[];
  /** Entries over {@link MAX_IMPORT_BYTES}, reported the same way. */
  oversized: ImportEntry[];
}

function folderIdFor(path: string, seed: number): string {
  // Deterministic per path within one import: every reference to the same
  // folder resolves to the same id without a shared mutable counter.
  let hash = 2166136261 ^ seed;
  for (let i = 0; i < path.length; i += 1) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `folder-${(hash >>> 0).toString(36)}${path.length.toString(36)}`;
}

/**
 * Plan the folder/asset taxonomy for a set of dropped files.
 *
 * `rootName` labels the single shelf used when the entries are flat (a
 * multi-select of files rather than a directory): everything then lands in one
 * «<rootName>» folder instead of scattering across the root shelf.
 */
export function planLibraryImportBlueprint(
  entries: ImportEntry[],
  rootName: string,
): LibraryImportBlueprint {
  const folders: PlannedFolder[] = [];
  const folderByPath = new Map<string, PlannedFolder>();
  const planned: LibraryImportBlueprint["entries"] = [];
  const unsupported: ImportEntry[] = [];
  const oversized: ImportEntry[] = [];

  // A directory pick yields `root/...` for every file; a flat multi-select
  // yields bare file names. Detect which by counting distinct first segments.
  const rootSegments = new Set<string>();
  for (const entry of entries) {
    const segments = folderSegments(entry.path);
    if (segments.length > 0) rootSegments.add(segments[0]);
  }
  const fromDirectory = rootSegments.size === 1 && entries.every(
    (entry) => folderSegments(entry.path).length > 0,
  );

  const ensureFolder = (path: string | null): string | null => {
    if (path == null) return null;
    const existing = folderByPath.get(path);
    if (existing) return existing.id;
    const segments = path.split("/").filter(Boolean);
    const parentPath = segments.length > 1 ? segments.slice(0, -1).join("/") : null;
    // Parents first: a child must never reference an id created after it.
    if (parentPath) ensureFolder(parentPath);
    const folder: PlannedFolder = {
      id: folderIdFor(path, entries.length),
      name: segments[segments.length - 1] ?? path,
      parentPath,
      path,
    };
    folders.push(folder);
    folderByPath.set(path, folder);
    return folder.id;
  };

  for (const entry of entries) {
    const kind = importKindFor(entry);
    if (kind === "unsupported") {
      unsupported.push(entry);
      continue;
    }
    if (entry.size > MAX_IMPORT_BYTES) {
      oversized.push(entry);
      continue;
    }
    const segments = folderSegments(entry.path);
    let folderPath: string | null;
    if (fromDirectory) {
      folderPath = segments.length ? segments.join("/") : null;
    } else {
      // Flat pick: one shelf named after the import (`rootName`).
      folderPath = rootName.trim() || null;
    }
    ensureFolder(folderPath);
    planned.push({ entry, kind, folderPath });
  }

  return { folders, entries: planned, unsupported, oversized };
}
