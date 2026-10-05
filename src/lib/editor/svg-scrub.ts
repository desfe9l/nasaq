/**
 * DOM-free SVG allow-list scrubber — the portable half of SVG sanitising.
 *
 * `./svg.ts` sanitises with `DOMParser`, which only exists in a browser. Two
 * places need the SAME guarantee without a DOM:
 *
 *   • the server (`storage/library-sync.ts` normalises a synced library
 *     catalog, `admin/functions.ts` validates an uploaded template), and
 *   • Node-run unit tests.
 *
 * So the allow-list lives here — one definition, used by the DOM walk and by
 * this tokenizer — and the scrubber removes anything the DOM walk would have
 * removed: unknown elements (with their whole subtree, matching
 * `child.remove()`), unknown attributes, event handlers, external `href`s and
 * external `url(#…)` references.
 *
 * No dependencies, no `DOMParser`, no `node:*` import: safe in every bundle.
 */

/** Elements that may survive sanitising (drawn + structural only). */
export const SVG_ALLOWED_TAGS: ReadonlySet<string> = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "title",
  "desc",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "marker",
  "clippath",
  "mask",
  "pattern",
  "lineargradient",
  "radialgradient",
  "stop",
  "filter",
  "feflood",
  "feblend",
  "fecolormatrix",
  "fecomposite",
  "fegaussianblur",
  "feoffset",
]);

/** Attributes that may survive: presentation + geometry + a few linking ids. */
export const SVG_ALLOWED_ATTRS: ReadonlySet<string> = new Set([
  "id",
  "class",
  "d",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "viewbox",
  "points",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "transform",
  "dx",
  "dy",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientunits",
  "spreadmethod",
  "text-anchor",
  "font-family",
  "font-size",
  "font-weight",
  "preserveaspectratio",
  "clip-path",
  "clip-rule",
  "mask",
  "filter",
  "in",
  "in2",
  "result",
  "stddeviation",
  "values",
  "type",
  "tablevalues",
  "slope",
  "intercept",
  "amplitude",
  "exponent",
  "href",
  "xmlns",
  "xmlns:xlink",
  "role",
  "aria-hidden",
]);

/** `href` may only reference an in-document fragment (`#id`) — never a URL. */
export function safeSvgHref(value: string): string {
  const v = value.trim();
  return v.startsWith("#") ? v : "";
}

/** URI-bearing values (fill/stroke/clip-path/filter/mask) must stay internal. */
export function safeSvgUrlRef(value: string): string {
  const v = value.trim();
  return v.startsWith("url('#") ||
    v.startsWith('url("#') ||
    /^url\('#[^)]+'\)$/.test(v) ||
    /^url\("#[^)]+"\)$/.test(v) ||
    /^url\(#\S+\)$/.test(v)
    ? v
    : "";
}

/** Presentation attributes whose value may carry a `url(#…)` reference. */
const URL_REF_ATTRS = /^(fill|stroke|clip-path|filter|mask)$/;

/**
 * Elements whose mere presence means the file is trying to execute or load
 * something. An uploaded TEMPLATE is refused outright when one of these is
 * found (see `svgDangerFindings`) — unlike an ordinary library icon, where the
 * element is simply dropped.
 */
const DANGEROUS_TAGS: ReadonlySet<string> = new Set([
  "script",
  "foreignobject",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "style",
  "link",
  "meta",
  "handler",
  "listener",
]);

export type SvgScrubReport = {
  /** Clean markup, or "" when the input held no usable `<svg>` root. */
  markup: string;
  /** Lower-cased element names that were removed (subtree included). */
  removedTags: string[];
  /**
   * `tag@attribute` pairs that were removed because they are NOT allowed.
   * The root's own `width`/`height` are a layout normalisation, not a finding,
   * so they never appear here.
   */
  removedAttrs: string[];
  /**
   * Constructs that are actively hostile rather than merely unlisted: an
   * executable element, an `on…` handler, an external `href`, an external
   * `url(…)` reference, or a `javascript:` / `data:text/html` URI anywhere in
   * tag markup. Empty for every well-behaved drawing.
   */
  dangerous: string[];
};

export type SvgScrubOptions = {
  /**
   * Keep the root's authored `width`/`height`.
   *
   * The canvas renderer drops them (the element's own box drives the size), but
   * the library importer measures an SVG's intrinsic size from the very markup
   * it stores — removing the box there would hand the shelf a 0×0 asset.
   */
  keepRootBox?: boolean;
};

type ParsedTag = {
  /** Tag name exactly as authored — SVG tag names are case-sensitive. */
  name: string;
  localName: string;
  isEnd: boolean;
  selfClosing: boolean;
  /** Raw attribute section (between the name and `>`), unparsed. */
  attrSource: string;
  /** Index just past the closing `>`. */
  end: number;
};

/** Parse one `<…>` construct, honouring quoted attribute values. */
function parseTag(src: string, open: number): ParsedTag | null {
  const head = /^<(\/?)([^\s/>]*)/.exec(src.slice(open, open + 200));
  if (!head) return null;
  const rawName = head[2];
  if (!rawName || !/^[A-Za-z_]/.test(rawName)) return null;
  let i = open + head[0].length;
  const attrStart = i;
  while (i < src.length) {
    const char = src[i];
    if (char === '"' || char === "'") {
      const quote = char;
      i += 1;
      while (i < src.length && src[i] !== quote) i += 1;
      i += 1;
      continue;
    }
    if (char === ">") break;
    i += 1;
  }
  if (i >= src.length) return null; // unterminated tag: not markup we can trust
  const attrSource = src.slice(attrStart, i);
  const selfClosing = /\/\s*$/.test(attrSource);
  return {
    name: rawName,
    localName: rawName.replace(/^.*:/, "").toLowerCase(),
    isEnd: head[1] === "/",
    selfClosing,
    attrSource: selfClosing ? attrSource.replace(/\/\s*$/, "") : attrSource,
    end: i + 1,
  };
}

const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Re-serialise one start tag with only allow-listed attributes. */
function sanitizeAttributes(
  tag: ParsedTag,
  isRoot: boolean,
  report: SvgScrubReport,
  keepRootBox: boolean,
): string {
  const kept: string[] = [];
  ATTR_RE.lastIndex = 0;
  for (const match of tag.attrSource.matchAll(ATTR_RE)) {
    const rawName = match[1];
    if (!rawName || rawName === "/") continue;
    const name = rawName.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    // The root's box is driven by the element's own layout; a stored
    // width/height would fight the canvas sizing (the DOM walk drops them too).
    // Callers that need the authored box (library import) opt out — and either
    // way this is a normalisation, not a dangerous construct, so it is never
    // reported as a removal.
    if (isRoot && !keepRootBox && (name === "width" || name === "height")) {
      continue;
    }
    let allowed = SVG_ALLOWED_ATTRS.has(name);
    // Any `on…` handler is refused explicitly so the report names it even when
    // a future allow-list edit would otherwise let it through. Note the tag
    // tokenizer already treats `<svg/onload=…>` as an attribute of `svg`, so
    // the slash-separated form cannot slip past this check.
    if (/^on/i.test(name)) {
      allowed = false;
      report.dangerous.push(`handler:${tag.localName}@${name}`);
    } else if (!allowed) {
      report.removedAttrs.push(`${tag.localName}@${name}`);
    }
    if (allowed && (name === "href" || name.endsWith(":href"))) {
      allowed = safeSvgHref(value) !== "";
      if (!allowed) report.dangerous.push(`href:${tag.localName}@${name}`);
    }
    if (allowed && URL_REF_ATTRS.test(name) && value.includes("url(")) {
      allowed = safeSvgUrlRef(value) !== "";
      if (!allowed) report.dangerous.push(`urlref:${tag.localName}@${name}`);
    }
    if (/javascript\s*:|data\s*:\s*text\/html/i.test(value)) {
      allowed = false;
      report.dangerous.push(`uri:${tag.localName}@${name}`);
    }
    if (!allowed) continue;
    kept.push(`${rawName}="${escapeAttr(value)}"`);
  }
  return kept.length ? ` ${kept.join(" ")}` : "";
}

/** Strip prolog/doctype/comments/CDATA so only element markup is tokenised. */
function stripNonElements(src: string): string {
  return src
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<\?[\s\S]*?(?:\?>|$)/g, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<![\s\S]*?(?:>|$)/g, "");
}

/**
 * Scrub SVG markup without a DOM. Deterministic and total: it never throws and
 * never leaves a construct the allow-list does not contain.
 */
export function inspectSvgMarkup(
  raw: unknown,
  options: SvgScrubOptions = {},
): SvgScrubReport {
  const report: SvgScrubReport = {
    markup: "",
    removedTags: [],
    removedAttrs: [],
    dangerous: [],
  };
  const original = String(raw ?? "");
  const rootAt = original.search(/<svg[\s>/]/i);
  if (rootAt < 0) return report;
  // A URI scheme that would survive entity/whitespace tricks inside tag markup
  // is hostile no matter which attribute carries it.
  if (/<[^>]*(?:javascript|data)\s*:/i.test(original)) {
    report.dangerous.push("uri:markup");
  }
  const src = stripNonElements(original.slice(rootAt));
  if (!/<svg[\s>/]/i.test(src)) return report;

  let out = "";
  let i = 0;
  let emittedRoot = false;
  /** Nesting depth of `<svg>` elements INSIDE the root (the root itself is 0). */
  let svgDepth = 0;
  /** Stack of disallowed open elements whose subtree is being skipped. */
  const dropping: Array<{ name: string; depth: number }> = [];

  while (i < src.length) {
    const next = src.indexOf("<", i);
    if (next < 0) {
      if (!dropping.length) out += escapeText(src.slice(i));
      break;
    }
    if (next > i && !dropping.length) out += escapeText(src.slice(i, next));
    const tag = parseTag(src, next);
    if (!tag) {
      // A `<` that does not start a parseable tag is text, not markup.
      if (!dropping.length) out += escapeText(src.slice(next, next + 1));
      i = next + 1;
      continue;
    }
    i = tag.end;

    if (dropping.length) {
      const top = dropping[dropping.length - 1];
      if (tag.isEnd) {
        if (tag.localName === top.name) {
          top.depth -= 1;
          if (top.depth <= 0) dropping.pop();
        }
      } else if (!tag.selfClosing && tag.localName === top.name) {
        top.depth += 1;
      }
      continue;
    }

    if (!SVG_ALLOWED_TAGS.has(tag.localName)) {
      if (!report.removedTags.includes(tag.localName)) {
        report.removedTags.push(tag.localName);
      }
      if (DANGEROUS_TAGS.has(tag.localName) && !report.dangerous.includes(`tag:${tag.localName}`)) {
        report.dangerous.push(`tag:${tag.localName}`);
      }
      // A disallowed element loses its whole subtree — exactly what the DOM
      // walk's `child.remove()` does. That is what makes `<script>`,
      // `<foreignObject>` and `<style>` inert rather than merely unwrapped:
      // their TEXT children would otherwise survive as content.
      if (!tag.selfClosing) dropping.push({ name: tag.localName, depth: 1 });
      continue;
    }

    const isRoot = !emittedRoot && !tag.isEnd && tag.localName === "svg";
    if (tag.isEnd) {
      if (tag.localName === "svg") {
        // A nested `<svg>` closes inside the root; the root's own close ends
        // the scrub, so an SVG pasted inside an HTML wrapper (or followed by
        // anything else) never drags trailing markup along.
        if (svgDepth > 0) {
          svgDepth -= 1;
          out += `</${tag.name}>`;
        } else if (emittedRoot) {
          out += `</${tag.name}>`;
          break;
        }
        continue;
      }
      out += `</${tag.name}>`;
      continue;
    }
    const attrs = sanitizeAttributes(tag, isRoot, report, options.keepRootBox === true);
    out += `<${tag.name}${attrs}${tag.selfClosing ? " /" : ""}>`;
    if (isRoot) emittedRoot = true;
    else if (tag.localName === "svg" && !tag.selfClosing) svgDepth += 1;
  }

  if (!emittedRoot || !/<svg/i.test(out)) return report;
  report.markup = out;
  return report;
}

/** The scrubbed markup alone, or "" when nothing safe survived. */
export function scrubSvgMarkup(raw: unknown, options: SvgScrubOptions = {}): string {
  return inspectSvgMarkup(raw, options).markup;
}

/**
 * Library icon/divider markup that is safe to paint with
 * `dangerouslySetInnerHTML`.
 *
 * Same allow-list as the DOM sanitiser in `./svg.ts`, but the authored root
 * `width`/`height` survive: the shelf thumbnails are sized by them, and
 * dropping the box would silently reflow every icon in the library. Lives here
 * (not in `./svg.ts`) so the store — which is imported from Node tests — can
 * use it without pulling `DOMParser` into its module graph.
 */
export function safeLibrarySvg(raw: unknown): string {
  return scrubSvgMarkup(raw, { keepRootBox: true });
}

/**
 * Hostile constructs in an SVG upload, for server-side validation that must
 * REFUSE the file rather than quietly rewrite it.
 *
 * Deliberately narrower than `removedAttrs`: a Figma or Illustrator export
 * legitimately carries attributes this editor does not render (`data-name`,
 * `enable-background`, `xlink:href` on an `<image>`). Refusing those would
 * break real template imports, while every one of them is already stripped
 * before the markup can reach a DOM. What is listed here — an executable
 * element, an event handler, an external reference, a script URI — has no
 * legitimate use in a document template.
 */
export function svgDangerFindings(raw: unknown): string[] {
  return inspectSvgMarkup(raw, { keepRootBox: true }).dangerous;
}
