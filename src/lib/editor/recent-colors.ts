/**
 * Recent colours — ONE persistent swatch strip for every colour picker.
 *
 * Requirement: a compact picker (HEX + swatches) whose "recent" row survives
 * reloads and is shared by Fill / Stroke / SVG / text colours — a single
 * localStorage-backed list, not a per-field palette. Values are stored as
 * normalised lowercase hex; anything that is not a colour (empty, "none",
 * rgba strings from legacy files) is simply never recorded.
 */

const KEY = "nasaq.recentColors.v1";
/** Long enough to feel like a palette, short enough to stay one wrapped row. */
const MAX = 14;

/** `#rgb` · `#rrggbb` · `#rrggbbaa`, case-insensitive. */
const HEX_RE = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?$/i;

const listeners = new Set<() => void>();
let cache: string[] | null = null;

/**
 * Normalise a colour string to a storable hex, or null when it is not one.
 * Short `#f0c` expands to `#ff00cc` so the list keys dedupe properly.
 */
export function normalizeColorHex(value: string | undefined | null): string | null {
  if (!value) return null;
  let v = String(value).trim().toLowerCase();
  if (!HEX_RE.test(v)) return null;
  if (v.length === 4) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return v;
}

function read(): string[] {
  if (cache) return cache;
  let out: string[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (Array.isArray(raw)) {
      out = raw
        .map((c) => (typeof c === "string" ? normalizeColorHex(c) : null))
        .filter((c): c is string => Boolean(c))
        .slice(0, MAX);
    }
  } catch {
    /* SSR / private mode: an empty list is a valid answer */
  }
  cache = out;
  return out;
}

function write(list: string[]) {
  cache = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode: recents live for this session only */
  }
  for (const fn of listeners) fn();
}

/** Current recents, most recent first (empty array when none). */
export function getRecentColors(): string[] {
  return read();
}

/** Push a colour to the front of the strip (deduped, capped). No-op for non-colours. */
export function recordRecentColor(value: string | undefined | null): void {
  const hex = normalizeColorHex(value);
  if (!hex) return;
  const next = [hex, ...read().filter((c) => c !== hex)].slice(0, MAX);
  if (next.length === read().length && next[0] === read()[0]) return;
  write(next);
}

/** Subscribe to strip changes (React `useState` + effect pattern). */
export function subscribeRecentColors(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
