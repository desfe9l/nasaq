import { SITE_OG_IMAGE_HEIGHT, SITE_OG_IMAGE_WIDTH } from "@/lib/og/share";
import { publishedTemplateAbsoluteUrl } from "@/lib/templates/published";

/** Pixel width of a template preview served to crawlers. Height follows the page. */
export const SHARE_RASTER_WIDTH = 1200;

export interface TemplateShareImage {
  url: string;
  type: string;
  width: number;
  height: number;
}

function originOf(idOrSlug: string): string {
  return publishedTemplateAbsoluteUrl(idOrSlug).split("/templates/")[0] || "";
}

/** Opening of an SVG data URL, enough to read width/height or viewBox. */
function svgOpening(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return "";
  const body = dataUrl.slice(comma + 1, comma + 1 + 1200);
  try {
    const pad = body.length % 4 === 0 ? body : body.slice(0, body.length - (body.length % 4));
    return Buffer.from(pad, "base64").toString("utf8");
  } catch {
    return "";
  }
}

/** Target PNG size for an SVG thumbnail. Falls back to a portrait page. */
export function svgShareSize(dataUrl: string, targetWidth = SHARE_RASTER_WIDTH): { width: number; height: number } {
  const head = svgOpening(dataUrl);
  const attr = /<svg\b[^>]*>/i.exec(head)?.[0] ?? "";
  const width = Number(/width=["']([\d.]+)/i.exec(attr)?.[1] ?? "");
  const height = Number(/height=["']([\d.]+)/i.exec(attr)?.[1] ?? "");
  const view = /viewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i.exec(attr);
  const w = width > 0 ? width : view ? Number(view[1]) : 0;
  const h = height > 0 ? height : view ? Number(view[2]) : 0;
  if (!(w > 0 && h > 0)) return { width: targetWidth, height: Math.round(targetWidth * 1.414) };
  return { width: targetWidth, height: Math.max(1, Math.round(targetWidth * (h / w))) };
}

/**
 * Absolute image a browser, chat or tweet should show for a template link.
 *
 * SVG previews are not share images — crawlers skip them — so they are served
 * as PNG from the thumbnail endpoint. The page URL itself stays `/templates/…`.
 */
export function templateShareImage(idOrSlug: string, thumbnail?: string | null): TemplateShareImage {
  const origin = originOf(idOrSlug);
  const card: TemplateShareImage = {
    url: `${origin}/og.jpg`,
    type: "image/jpeg",
    width: SITE_OG_IMAGE_WIDTH,
    height: SITE_OG_IMAGE_HEIGHT,
  };
  if (!thumbnail) return card;
  if (/^https:\/\//i.test(thumbnail)) {
    const jpeg = /\.jpe?g(\?|$)/i.test(thumbnail);
    return {
      url: thumbnail,
      type: jpeg ? "image/jpeg" : "image/png",
      width: SITE_OG_IMAGE_WIDTH,
      height: SITE_OG_IMAGE_HEIGHT,
    };
  }
  if (!thumbnail.startsWith("data:image/")) return card;
  const svg = thumbnail.startsWith("data:image/svg");
  const jpeg = thumbnail.startsWith("data:image/jpeg") || thumbnail.startsWith("data:image/jpg");
  const size = svg ? svgShareSize(thumbnail) : { width: SITE_OG_IMAGE_WIDTH, height: SITE_OG_IMAGE_HEIGHT };
  return {
    url: `${origin}/api/templates/thumbnail?id=${encodeURIComponent(idOrSlug)}`,
    type: jpeg ? "image/jpeg" : "image/png",
    width: size.width,
    height: size.height,
  };
}
