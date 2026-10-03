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

/** Stable absolute URL for SEO / social sharing */
import { SITE_ORIGIN } from "@/lib/og/share";

export function publishedTemplateAbsoluteUrl(idOrSlug: string, origin?: string): string {
  const base = origin || SITE_ORIGIN;
  return `${base.replace(/\/$/, "")}${publishedTemplatePath(idOrSlug)}`;
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
