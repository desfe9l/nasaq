import type { AdminTemplate } from "@/lib/admin/types";
import type { Page } from "@/lib/editor/model";
import { freshPages } from "@/lib/templates/custom-templates";

/** Only published admin records have share links. Never link local/private templates. */
export function publishedTemplatePath(id: string): string {
  return `/templates/${encodeURIComponent(id)}`;
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
