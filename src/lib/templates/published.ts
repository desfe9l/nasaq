import type { AdminTemplate } from "@/lib/admin/types";
import {
  pageSize,
  sizeIdOf,
  type PackId,
  type Page,
  type ThemeId,
} from "@/lib/editor/model";
import type { EntryProjectSeed } from "@/lib/templates/catalog";
import { freshPages } from "@/lib/templates/custom-templates";

/** Only published admin records have share links. Never link local/private templates. */
export function publishedTemplatePath(idOrSlug: string): string {
  return `/templates/${encodeURIComponent(idOrSlug)}`;
}

export function templateDisplaySlug(template: { slug?: string | null; id: string }): string {
  return template.slug && template.slug.trim() ? template.slug : template.id;
}

/** Compact, reversible share token for catalogue ids minted by Admin. */
export function shortTemplateToken(id: string): string | null {
  const match = /^tpl_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(id);
  if (!match) return null;
  const hex = match[1].replace(/-/g, "");
  const bytes = hex.match(/[0-9a-f]{2}/gi)?.map((part) => Number.parseInt(part, 16));
  if (!bytes || bytes.length !== 16) return null;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Expand a short share token back into its canonical Admin template id. */
export function templateIdFromShortToken(token: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
  try {
    const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
    const binary = globalThis.atob(`${normalized}==`);
    if (binary.length !== 16) return null;
    const hex = Array.from(binary, (char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    return `tpl_${uuid}`;
  } catch {
    return null;
  }
}

/** A concise public URL, reversible without adding another database column. */
export function shortPublishedTemplatePath(template: { id: string; slug?: string | null }): string {
  const token = shortTemplateToken(template.id);
  return token
    ? `/t/${token}`
    : publishedTemplatePath(templateDisplaySlug(template));
}

/** Stable absolute URL for SEO / social sharing */
import { SITE_ORIGIN } from "@/lib/og/share";

export function publishedTemplateAbsoluteUrl(idOrSlug: string, origin?: string): string {
  const base = origin || SITE_ORIGIN;
  return `${base.replace(/\/$/, "")}${publishedTemplatePath(idOrSlug)}`;
}

export function shortPublishedTemplateAbsoluteUrl(
  template: { id: string; slug?: string | null },
  origin?: string,
): string {
  const base = (origin || SITE_ORIGIN).replace(/\/$/, "");
  return `${base}${shortPublishedTemplatePath(template)}`;
}

/**
 * Slugify for marketing URLs: keeps Arabic letters, latin, numbers, hyphen.
 * Collision resistance is handled server-side; this is only the base form.
 */
export function slugifyTitle(title: string): string {
  const raw = String(title || "").trim();
  if (!raw) return "";
  // Lowercase latin, keep arabic range \u0600-\u06FF, numbers, spaces, hyphen
  let s = raw.toLowerCase();
  // Replace any sequence of characters that is NOT arabic, latin, number with hyphen
  s = s.replace(/[^0-9a-z\u0600-\u06FF]+/g, "-");
  s = s.replace(/-+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  if (s.length > 80) s = s.slice(0, 80).replace(/-+$/g, "");
  return s;
}

/** Import only the public template content, never project identity or private metadata. */
const PUBLISHED_PACK_IDS: ReadonlySet<string> = new Set([
  "official",
  "eid",
  "briefing",
  "blank",
  "slides",
]);

function validThemeId(value: unknown): ThemeId {
  return value === "official" || value === "eid" || value === "ministry" || value === "slate" || value === "sand"
    ? value
    : "official";
}

function validEmbeddedFonts(value: unknown): { family: string; dataUrl: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const fonts = value.filter(
    (font): font is { family: string; dataUrl: string } =>
      !!font &&
      typeof font === "object" &&
      typeof (font as { family?: unknown }).family === "string" &&
      typeof (font as { dataUrl?: unknown }).dataUrl === "string" &&
      (font as { dataUrl: string }).dataUrl.startsWith("data:"),
  );
  return fonts.length ? fonts.slice(0, 24) : undefined;
}
function validPackId(value: unknown): PackId | undefined {
  return typeof value === "string" && PUBLISHED_PACK_IDS.has(value)
    ? (value as PackId)
    : undefined;
}

export function mergePublishedTemplateContext(
  seed: EntryProjectSeed,
  context: EntryProjectSeed,
): EntryProjectSeed {
  const pack = seed.pack ?? context.pack;
  return {
    ...seed,
    theme: context.theme,
    orgName: context.orgName,
    // The public file's real page dimensions outrank a built-in catalog preset.
    defaultSize: sizeIdOf(pageSize(seed.pages[0])),
    // A built-in pack association is safe local-project metadata, not Admin
    // licensing metadata; the latter remains exactly what the fetched record says.
    ...(pack ? { pack } : {}),
  };
}

export function publishedTemplateSeed(template: AdminTemplate): EntryProjectSeed {
  if (template.kind === "svg") {
    const page: Page = {
      id: crypto.randomUUID(),
      name: "صفحة 1",
      w: 210,
      h: 297,
      elements: [
        {
          id: crypto.randomUUID(),
          type: "svg",
          name: template.title,
          x: 15,
          y: 15,
          w: 180,
          h: 267,
          rotation: 0,
          opacity: 1,
          z: 1,
          content: template.content,
          style: { overflowVisible: false },
        },
      ],
    };
    return {
      name: template.title,
      theme: "official",
      orgName: "",
      defaultSize: sizeIdOf(pageSize(page)),
      ...(template.tier === "licensed"
        ? { licensedTemplateId: template.id }
        : {}),
      pages: [page],
    };
  }
  const data: unknown = JSON.parse(template.content);
  if (!data || typeof data !== "object" || !Array.isArray((data as { pages?: unknown }).pages)) {
    throw new Error("Invalid template");
  }
  const project = data as {
    pages: Page[];
    pack?: unknown;
    theme?: unknown;
    orgName?: unknown;
    transactionNo?: unknown;
    embeddedFonts?: unknown;
  };
  const pages = project.pages;
  if (!pages.length || pages.some((page) => !page || typeof page !== "object" || !Array.isArray(page.elements))) {
    throw new Error("Invalid template pages");
  }
  const fresh = freshPages(pages);
  const pack = validPackId(project.pack);
  const fonts = validEmbeddedFonts(project.embeddedFonts);
  const transactionNo = typeof project.transactionNo === "string" ? project.transactionNo.trim().slice(0, 80) : "";
  return {
    name: template.title,
    theme: validThemeId(project.theme),
    orgName: typeof project.orgName === "string" ? project.orgName.slice(0, 160) : "",
    defaultSize: sizeIdOf(pageSize(fresh[0])),
    ...(transactionNo ? { transactionNo } : {}),
    ...(pack ? { pack } : {}),
    ...(template.tier === "licensed"
      ? { licensedTemplateId: template.id }
      : {}),
    ...(fonts ? { embeddedFonts: fonts } : {}),
    pages: fresh,
  };
}
