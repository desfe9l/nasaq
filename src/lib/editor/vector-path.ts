/**
 * SVG path parsing for the Office writers.
 *
 * The shape library expresses every shape as a handful of primitives in a
 * 100×100 box, and a few decorative ones (crescent, arch, callouts, icons) as
 * SVG path data. Word and PowerPoint both accept real vector geometry, so the
 * paths are translated into each format's own path syntax rather than rasterised
 * — that is what keeps an exported crescent an editable crescent.
 *
 * Only the commands the library actually emits are supported (`M/L/H/V/C/A/Z`,
 * absolute and relative). Anything else ends the current subpath instead of
 * guessing at geometry.
 */

/** A drawing command in a normalised, unit-independent form. */
export type PathSegment =
  | { kind: "move"; x: number; y: number }
  | { kind: "line"; x: number; y: number }
  | {
      kind: "cubic";
      x: number;
      y: number;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
  | { kind: "close" };

const SUPPORTED = new Set(["M", "L", "H", "V", "C", "A", "Z"]);
/** Commands that repeat when operands follow without a new letter. */
const REPEATS = new Set(["M", "L", "H", "V", "C", "A"]);

/**
 * Split path data into commands and numeric operands, preserving order.
 *
 * Every letter is captured, including unsupported ones, so the parser can stop
 * at `Q` instead of mistaking its operands for another `L`.
 */
function tokenize(d: string): string[] {
  return d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
}

/**
 * Parse SVG path data into ordered segments, in the path's own units.
 *
 * Elliptical arcs are approximated by a single cubic per command. Every arc in
 * the shape library is a circular sweep of a half turn or less, where one cubic
 * through the arc's apex is visually identical at page scale and avoids
 * reimplementing endpoint-to-centre arc conversion for both writers.
 */
export function parseSvgPath(d: string): PathSegment[] {
  const tokens = tokenize(d);
  const out: PathSegment[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let i = 0;
  // A bare number after a command repeats that command; tracking the last one
  // keeps `M0 0 L10 0 20 0` correct.
  let last = "";

  const readNum = () => Number(tokens[i++]);

  while (i < tokens.length) {
    const token = tokens[i];
    if (/[A-Za-z]/.test(token)) {
      last = token;
      i++;
      const upper = last.toUpperCase();
      if (!SUPPORTED.has(upper)) {
        // Unsupported command: stop at the last valid vertex rather than let its
        // operands be read as a continuation of the previous command.
        break;
      }
    } else if (!last) {
      i++;
      continue;
    } else if (!REPEATS.has(last.toUpperCase())) {
      // `Z` takes no operands; a stray number is malformed input.
      i++;
      continue;
    } else if (last === "M") {
      // A repeated moveto is an implicit lineto, per the SVG spec.
      last = "L";
    } else if (last === "m") {
      last = "l";
    }

    const cmd = last;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();

    if (C === "Z") {
      out.push({ kind: "close" });
      x = startX;
      y = startY;
      continue;
    }

    if (C === "M") {
      x = readNum() + (rel ? x : 0);
      y = readNum() + (rel ? y : 0);
      startX = x;
      startY = y;
      out.push({ kind: "move", x, y });
      continue;
    }

    if (C === "L") {
      x = readNum() + (rel ? x : 0);
      y = readNum() + (rel ? y : 0);
      out.push({ kind: "line", x, y });
      continue;
    }

    if (C === "H") {
      x = readNum() + (rel ? x : 0);
      out.push({ kind: "line", x, y });
      continue;
    }

    if (C === "V") {
      y = readNum() + (rel ? y : 0);
      out.push({ kind: "line", x, y });
      continue;
    }

    if (C === "C") {
      const bx = x;
      const by = y;
      const x1 = readNum() + (rel ? bx : 0);
      const y1 = readNum() + (rel ? by : 0);
      const x2 = readNum() + (rel ? bx : 0);
      const y2 = readNum() + (rel ? by : 0);
      x = readNum() + (rel ? bx : 0);
      y = readNum() + (rel ? by : 0);
      out.push({ kind: "cubic", x, y, x1, y1, x2, y2 });
      continue;
    }

    if (C === "A") {
      const bx = x;
      const by = y;
      const rx = readNum();
      const ry = readNum();
      readNum(); // x-axis rotation — every arc in the library is axis-aligned
      const large = readNum();
      const sweep = readNum();
      x = readNum() + (rel ? bx : 0);
      y = readNum() + (rel ? by : 0);

      // Apex of the bulge, offset perpendicular to the chord.
      const midX = (bx + x) / 2;
      const midY = (by + y) / 2;
      const bulge = (large ? Math.max(rx, ry) : Math.min(rx, ry)) / 2;
      const nx = -(y - by);
      const ny = x - bx;
      const len = Math.hypot(nx, ny) || 1;
      const sign = sweep ? 1 : -1;
      const cx = midX + (nx / len) * bulge * sign;
      const cy = midY + (ny / len) * bulge * sign;

      out.push({
        kind: "cubic",
        x,
        y,
        x1: bx + (2 / 3) * (cx - bx),
        y1: by + (2 / 3) * (cy - by),
        x2: x + (2 / 3) * (cx - x),
        y2: y + (2 / 3) * (cy - y),
      });
      continue;
    }

    // A command in `SUPPORTED` always matched above, so this is unreachable.
    break;
  }

  return out;
}

/** Scale a segment list from its own units into a target box. */
export function scaleSegments(
  segments: PathSegment[],
  sx: number,
  sy: number,
): PathSegment[] {
  return segments.map((seg) => {
    switch (seg.kind) {
      case "move":
      case "line":
        return { ...seg, x: seg.x * sx, y: seg.y * sy };
      case "cubic":
        return {
          ...seg,
          x: seg.x * sx,
          y: seg.y * sy,
          x1: seg.x1 * sx,
          y1: seg.y1 * sy,
          x2: seg.x2 * sx,
          y2: seg.y2 * sy,
        };
      default:
        return seg;
    }
  });
}
