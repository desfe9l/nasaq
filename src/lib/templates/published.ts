import type { AdminTemplate } from "@/lib/admin/types";
import type { Page } from "@/lib/editor/model";
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
export function publishedTemplateSeed(template: AdminTemplate): { name: string; pages: Page[] } {
  if (template.kind === "svg") {
    return {
      name: template.title,
      pages: [{
        id: crypto.randomUUID(), name: "صفحة 1", w: 210, h: 297,
        elements: [{
          id: crypto.randomUUID(), type: "svg", name: template.title,
          x: 15, y: 15, w: 180, h: 267, rotation: 0, opacity: 1, z: 1,
          content: template.content, style: { overflowVisible: false },
        }],
      } as Page],
    };
  }
  const data: unknown = JSON.parse(template.content);
  if (!data || typeof data !== "object" || !Array.isArray((data as { pages?: unknown }).pages)) {
    throw new Error("Invalid template");
  }
  const pages = (data as { pages: Page[] }).pages;
  if (!pages.length || pages.some((page) => !page || typeof page !== "object" || !Array.isArray(page.elements))) {
    throw new Error("Invalid template pages");
  }
  return { name: template.title, pages: freshPages(pages) };
}
