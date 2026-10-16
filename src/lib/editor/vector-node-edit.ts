/**
 * Editable geometry for the FIRST path of an `svg` element — the pure half of
 * the vector node editor (`VectorNodeEditor.tsx`). No DOM, no store, no React:
 * every rule the editor relies on is decided here and unit-tested in
 * `vector-node-edit.test.ts`.
 *
 * NOT the Office writers' parser: `./vector-path.ts` normalises shape-library
 * paths for Word/PowerPoint export (it approximates arcs and only needs the
 * commands the library emits). This module answers a different question — "can
 * the user drag a node on this drawing, and if so what exactly gets written
 * back?" — so it refuses anything it cannot represent exactly instead of
 * approximating it.
 *
 * WHY MARKUP, NOT A BARE PATH STRING
 * `el.content` is a whole sanitised `<svg>…</svg>` document (a Photoshop vector
 * layer lands here as markup, and the canvas renders that markup inline). The
 * previous editor scraped numbers straight out of the whole document, so the
 * token stream was desynced by `viewBox="0 0 900 640"` and the xmlns URL, and
 * it committed the bare path data back over `el.content` — which replaced the
 * drawing with text. Both defects are fixed by the three rules below:
 *
 *  · find the first `<path>` and read ITS `d` attribute;
 *  · rewrite only `d` values that equal the original, byte-for-byte preserving
 *    every other byte of the markup (one Photoshop shape paints twice — a fill
 *    pass and a gradient pass sharing the same `d` — and both must move
 *    together);
 *  · return null for path commands this editor cannot represent, so an
 *    unsupported drawing degrades to "not editable" instead of "corrupted".
 */

export interface PathPoint {
  x: number;
  y: number;
  type: "M" | "L" | "C" | "Q" | "Z";
  cp1?: { x: number; y: number };
  cp2?: { x: number; y: number };
  cp?: { x: number; y: number };
}

export type DragPart = "point" | "cp1" | "cp2" | "cp";

export interface VectorTarget {
  /** Exact value of the first path's `d` attribute — the rewrite key. */
  d: string;
  /** Parsed absolute geometry (moveto/lineto/cubic/quadratic/close). */
  points: PathPoint[];
}

/** Commands this editor can represent; an arc (`A`) is intentionally absent. */
const SUPPORTED = "MLHVCQSTZ";
const TOKEN = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

/**
 * Parse a `d` attribute into absolute points.
 *
 * Handles absolute and relative commands, implicit lineto pairs after a
 * moveto, H/V, the smooth shorthands S/T (reflecting the previous control
 * point exactly as the SVG specification defines) and `Z` close markers.
 * Returns null when the path uses a command outside SUPPORTED or is malformed;
 * callers treat null as "this path is not editable".
 */
export function parsePathData(d: string): PathPoint[] | null {
  const tokens = String(d ?? "").match(TOKEN);
  if (!tokens || !tokens.length) return null;

  const points: PathPoint[] = [];
  let i = 0;
  let x = 0;
  let y = 0;
  /** Start of the current subpath (`Z` returns here). */
  let sx = 0;
  let sy = 0;
  /** Previous control point + its command, for S/T reflection. */
  let ctrl: { x: number; y: number } | null = null;
  let prev: "C" | "Q" | null = null;
  let cmd = "";
  let rel = false;

  try {
    const num = (): number => {
      const t = tokens[i];
      if (!t || /^[a-zA-Z]$/.test(t)) throw new Error("expected a number");
      i += 1;
      const v = Number(t);
      if (!Number.isFinite(v)) throw new Error("bad number");
      return v;
    };
    const pair = (): { x: number; y: number } => {
      const dx = num();
      const dy = num();
      return rel ? { x: x + dx, y: y + dy } : { x: dx, y: dy };
    };

    while (i < tokens.length) {
      const t = tokens[i];
      if (/^[a-zA-Z]$/.test(t)) {
        i += 1;
        cmd = t.toUpperCase();
        rel = t !== cmd;
        if (!SUPPORTED.includes(cmd)) return null;
        if (cmd === "Z") {
          points.push({ x: sx, y: sy, type: "Z" });
          x = sx;
          y = sy;
          ctrl = null;
          prev = null;
          continue;
        }
      } else if (!cmd) {
        return null; // geometry before any command
      }

      if (cmd === "M" || cmd === "L") {
        const p = pair();
        points.push({ x: p.x, y: p.y, type: cmd === "M" ? "M" : "L" });
        if (cmd === "M") {
          sx = p.x;
          sy = p.y;
          /* Extra coordinate pairs after a moveto are implicit linetos. */
          cmd = "L";
        }
        x = p.x;
        y = p.y;
        ctrl = null;
        prev = null;
      } else if (cmd === "H" || cmd === "V") {
        const v = num();
        if (cmd === "H") x = rel ? x + v : v;
        else y = rel ? y + v : v;
        points.push({ x, y, type: "L" });
        ctrl = null;
        prev = null;
      } else if (cmd === "C") {
        const c1 = pair();
        const c2 = pair();
        const p = pair();
        points.push({ x: p.x, y: p.y, type: "C", cp1: c1, cp2: c2 });
        x = p.x;
        y = p.y;
        ctrl = c2;
        prev = "C";
      } else if (cmd === "S") {
        const c2 = pair();
        const p = pair();
        const reflected: { x: number; y: number } =
          prev === "C" && ctrl
            ? { x: 2 * x - ctrl.x, y: 2 * y - ctrl.y }
            : { x, y };
        points.push({ x: p.x, y: p.y, type: "C", cp1: reflected, cp2: c2 });
        x = p.x;
        y = p.y;
        ctrl = c2;
        prev = "C";
      } else if (cmd === "Q") {
        const c = pair();
        const p = pair();
        points.push({ x: p.x, y: p.y, type: "Q", cp: c });
        x = p.x;
        y = p.y;
        ctrl = c;
        prev = "Q";
      } else if (cmd === "T") {
        const p = pair();
        const reflected: { x: number; y: number } =
          prev === "Q" && ctrl
            ? { x: 2 * x - ctrl.x, y: 2 * y - ctrl.y }
            : { x, y };
        points.push({ x: p.x, y: p.y, type: "Q", cp: reflected });
        x = p.x;
        y = p.y;
        ctrl = reflected;
        prev = "Q";
      } else {
        return null;
      }
    }
  } catch {
    return null;
  }
  return points.length ? points : null;
}

/** Three decimals keep a large artboard precise and the markup compact. */
function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

export function pointsToPathData(points: PathPoint[]): string {
  return points
    .map((p) => {
      if (p.type === "Z") return "Z";
      if (p.type === "M") return `M${fmt(p.x)} ${fmt(p.y)}`;
      if (p.type === "L") return `L${fmt(p.x)} ${fmt(p.y)}`;
      if (p.type === "Q")
        return `Q${fmt(p.cp!.x)} ${fmt(p.cp!.y)} ${fmt(p.x)} ${fmt(p.y)}`;
      return `C${fmt(p.cp1!.x)} ${fmt(p.cp1!.y)} ${fmt(p.cp2!.x)} ${fmt(
        p.cp2!.y,
      )} ${fmt(p.x)} ${fmt(p.y)}`;
    })
    .join(" ");
}

/** First `<path …>` opening tag, tolerating quoted `>` inside attributes. */
const PATH_TAG = /<path\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i;

function attrValue(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(
    tag,
  );
  if (!m) return null;
  return m[1] ?? m[2] ?? "";
}

/**
 * Read the editable target out of an element's markup. Null when there is no
 * path, no `d`, or the path cannot be represented (see parsePathData).
 */
export function extractVectorTarget(content: string): VectorTarget | null {
  const tag = PATH_TAG.exec(String(content ?? ""));
  if (!tag) return null;
  const d = attrValue(tag[0], "d");
  if (!d) return null;
  const points = parsePathData(d);
  if (!points || points.length < 2) return null;
  return { d, points };
}

/**
 * Replace every `d` attribute whose value is exactly `originalD` with `nextD`.
 * All occurrences move together (Photoshop's fill + gradient passes), and the
 * rest of the markup is preserved byte-for-byte. Null when nothing matched, so
 * a caller never writes a "changed" document that did not actually change.
 */
export function rewritePathData(
  content: string,
  originalD: string,
  nextD: string,
): string | null {
  if (!originalD) return null;
  if (originalD === nextD) return content;
  let hit = false;
  const out = content.replace(
    /(\sd=)(?:"([^"]*)"|'([^']*)')/gi,
    (whole, lead: string, dq: string | undefined, sq: string | undefined) => {
      const value = dq ?? sq ?? "";
      if (value !== originalD) return whole;
      hit = true;
      return `${lead}${dq !== undefined ? `"${nextD}"` : `'${nextD}'`}`;
    },
  );
  return hit ? out : null;
}

/**
 * Move one anchor point (carrying its control handles) or a single control
 * handle to (x, y). Pure: every returned object is fresh, so React compares
 * the produced array by value, never against a mutated snapshot.
 */
export function movePoint(
  points: PathPoint[],
  index: number,
  part: DragPart,
  x: number,
  y: number,
): PathPoint[] {
  const current = points[index];
  if (!current || current.type === "Z") return points;
  const next = [...points];
  const p: PathPoint = { ...current };
  if (part === "point") {
    const dx = x - current.x;
    const dy = y - current.y;
    p.x = x;
    p.y = y;
    if (p.cp1) p.cp1 = { x: p.cp1.x + dx, y: p.cp1.y + dy };
    if (p.cp2) p.cp2 = { x: p.cp2.x + dx, y: p.cp2.y + dy };
    if (p.cp) p.cp = { x: p.cp.x + dx, y: p.cp.y + dy };
  } else if (part === "cp1" && p.cp1) {
    p.cp1 = { x, y };
  } else if (part === "cp2" && p.cp2) {
    p.cp2 = { x, y };
  } else if (part === "cp" && p.cp) {
    p.cp = { x, y };
  } else {
    return points;
  }
  next[index] = p;
  return next;
}
