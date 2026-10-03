import {
  gradientSvgDefinition,
  normalizeGradient,
  type Gradient,
} from "./gradient";
/**
 * SVG element support — sanitising author-pasted markup and rasterising it
 * for the Office exporters.
 *
 * The canvas renders sanitised SVG inline (vector, crisp at any zoom, editable
 * fill/stroke via CSS currentColor). Office export needs bytes, so the same
 * sanitised markup is drawn to a canvas at 2× and handed over as a PNG —
 * conversion happens ONLY at the export boundary, never in the editor.
 *
 * Sanitising uses the browser's own parser (`DOMParser` + allow-list walk):
 * no third-party dependency, deterministic, and unsafe nodes (script, event
 * handlers, external references) are removed rather than escaped.
 */

/** Elements that may survive sanitising (drawn + structural only). */
const ALLOWED_TAGS = new Set([
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
const ALLOWED_ATTRS = new Set([
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
function safeHref(value: string): string {
  const v = value.trim();
  return v.startsWith("#") ? v : "";
}

/** URI-bearing values (fill/stroke/clip-path/filter/mask) must stay internal. */
function safeUrlRef(value: string): string {
  const v = value.trim();
  return v.startsWith("url('#") ||
    v.startsWith('url("#') ||
    /^url\('#[^)]+'\)$/.test(v) ||
    /^url\("#[^)]+"\)$/.test(v) ||
    /^url\(#\S+\)$/.test(v)
    ? v
    : "";
}

/**
 * Sanitise pasted SVG source. Returns clean markup, or "" when the input holds
 * no root `<svg>` at all. Never throws.
 */
export function sanitizeSvgContent(raw: unknown): string {
  const value = String(raw ?? "");
  if (!value.includes("<svg")) return "";
  try {
    const doc = new DOMParser().parseFromString(value, "image/svg+xml");
    const root = doc.documentElement;
    if (
      !root ||
      root.nodeName.toLowerCase() !== "svg" ||
      doc.querySelector("parsererror")
    )
      return "";

    const walk = (node: Element): void => {
      for (const child of Array.from(node.children)) {
        const tag = child.nodeName.toLowerCase().replace(/^.*:/, "");
        if (!ALLOWED_TAGS.has(tag)) {
          child.remove();
          continue;
        }
        walk(child);
      }
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        let ok = ALLOWED_ATTRS.has(name);
        if (ok && (name === "href" || name.endsWith(":href")))
          ok = safeHref(attr.value) !== "" || attr.value.trim() === "#";
        if (ok && /^(fill|stroke|clip-path|filter|mask)$/.test(name))
          ok = safeUrlRef(attr.value) !== "" || !attr.value.includes("url(");
        if (!ok) node.removeAttribute(attr.name);
      }
    };
    walk(root);
    // Keep only the root's own markup — no XML prolog, no comments.
    root.removeAttribute("width");
    root.removeAttribute("height");
    return new XMLSerializer().serializeToString(root);
  } catch {
    return "";
  }
}

/** True when the string looks like usable SVG after sanitising. */
export function isUsableSvg(raw: unknown): boolean {
  const clean = sanitizeSvgContent(raw);
  return clean.includes("<svg") && clean.length > 20;
}

/** Validate through the model's normal image-source guard. */
export function safeSvgSrc(src: unknown): string {
  const value = String(src ?? "").trim();
  if (/^data:image\/svg\+xml/i.test(value)) return value;
  return "";
}

/**
 * Apply the element's independent fill/stroke/stroke-width overrides onto
 * sanitised markup BEFORE render/export. Each channel is opt-in: an unset
 * override leaves the author's own colors standing (the default), so adding
 * a stroke never rewrites the fills and vice-versa. `currentColor` in the
 * markup keeps following `ElStyle.color` as before.
 */
export function applySvgColors(
  svgMarkup: string,
  overrides: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    gradient?: Gradient;
    gradientId?: string;
    box?: { w: number; h: number };
  },
): string {
  if (!svgMarkup) return "";
  let { fill } = overrides;
  const { stroke, strokeWidth } = overrides;
  const gradient = normalizeGradient(overrides.gradient);
  if (fill == null && stroke == null && strokeWidth == null && !gradient)
    return svgMarkup;
  try {
    const doc = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
    if (
      doc.querySelector("parsererror") ||
      doc.documentElement?.nodeName.toLowerCase() !== "svg"
    )
      return svgMarkup;
    if (gradient) {
      const id = (overrides.gradientId || "nasaq-fill").replace(
        /[^a-zA-Z0-9_-]/g,
        "",
      );
      const values = (
        doc.documentElement.getAttribute("viewBox") || "0 0 100 100"
      )
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      const coordinates =
        values.length === 4 &&
        values.every(Number.isFinite) &&
        values[2] > 0 &&
        values[3] > 0
          ? { x: values[0], y: values[1], w: values[2], h: values[3] }
          : { w: 100, h: 100 };
      const markup = `<svg xmlns="http://www.w3.org/2000/svg"><defs>${gradientSvgDefinition(gradient, id, overrides.box || coordinates, coordinates)}</defs></svg>`;
      const defs = new DOMParser().parseFromString(markup, "image/svg+xml")
        .documentElement.firstElementChild;
      if (defs)
        doc.documentElement.insertBefore(
          doc.importNode(defs, true),
          doc.documentElement.firstChild,
        );
      fill = `url(#${id})`;
    }
    // Paint-order trick: rewrite each drawable's presentation attrs in place.
    // Defaults matter — a rect with no fill attr paints black, so "no fill"
    // must become explicit `fill="none"` before an override can be applied.
    const drawables = [
      ...doc.querySelectorAll(
        "path, rect, circle, ellipse, line, polyline, polygon, text, tspan, use",
      ),
    ];
    for (const node of drawables) {
      const el = node as SVGElement;
      const owner = el.closest(
        "linearGradient, radialGradient, pattern, marker, clipPath, mask",
      );
      if (owner) continue; // Never repaint clip/mask/gradient machinery; symbols may paint.
      // Resolve inherited presentation values (most outline icons put stroke
      // on <svg> or <g>, not on individual paths).
      const inherited = (name: string, fallback: string): string => {
        let node: Element | null = el;
        while (node) {
          if (node.hasAttribute(name)) return node.getAttribute(name)!;
          node = node.parentElement;
        }
        return fallback;
      };
      if (fill != null && inherited("fill", "black") !== "none")
        el.setAttribute("fill", fill);
      // An explicit stroke override may also add an outline to filled artwork.
      if (stroke != null) el.setAttribute("stroke", stroke);
      if (strokeWidth != null)
        el.setAttribute("stroke-width", String(strokeWidth));
    }
    return new XMLSerializer().serializeToString(doc);
  } catch {
    return svgMarkup;
  }
}

/**
 * Rasterise sanitised SVG markup to a PNG data URL at `scale`× its box, for
 * the Office exporters (docx/pptx embed raster bytes only). Returns "" on
 * failure — callers skip the element rather than embed garbage.
 */
export async function svgToPngDataUrl(
  svgMarkup: string,
  wMm: number,
  hMm: number,
  scale = 2,
): Promise<string> {
  try {
    const clean = sanitizeSvgContent(svgMarkup);
    if (!clean) return "";
    const pxW = Math.max(8, Math.round(wMm * (96 / 25.4) * scale));
    const pxH = Math.max(8, Math.round(hMm * (96 / 25.4) * scale));
    const blob = new Blob([clean], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = "sync";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("svg load failed"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = pxW;
      canvas.height = pxH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return "";
      ctx.drawImage(img, 0, 0, pxW, pxH);
      return canvas.toDataURL("image/png");
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return "";
  }
}
