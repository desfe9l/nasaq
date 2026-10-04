/*
 * Template → project actions, shared by every surface that offers «استخدام
 * القالب», «تعديل القالب» and «تكرار».
 *
 * The gallery, the Home shelf and a template's own page must behave
 * identically: the same entitlement gates, the same page/project ceilings, the
 * same fetch of a managed template's content. Keeping the operations here means
 * a template page can never drift into a second, weaker implementation of the
 * rules the store enforces.
 *
 * Every action resolves to a PROJECT ID — the caller decides where to send the
 * author (`/editor/<id>`), which is what keeps the editor's address truthful.
 */

import type { ThemeId } from "@/lib/editor/model";
import { projectAccessBlock } from "@/lib/editor/access-limits";
import type { FeatureId } from "@/lib/license/types";
import { useEditor } from "@/lib/editor/store";
import { DEMO_LICENSE, canCreateDemoProject, canUseDemoPack } from "@/lib/product/product";
import {
  entryProjectSeed,
  type CatalogEntry,
} from "@/lib/templates/catalog";
import {
  mergePublishedTemplateContext,
  publishedTemplateSeed,
  templateDisplaySlug,
} from "@/lib/templates/published";
import {
  draftSnapshot,
  duplicateCustomTemplate,
  saveCustomTemplate,
  saveDraft,
} from "@/lib/templates/custom-templates";
import { getProject } from "@/lib/editor/storage";

export interface TemplateActionContext {
  theme: ThemeId;
  orgName: string;
  /** The server-resolved entitlements — the same map the store judges by. */
  entitlements: Record<FeatureId, boolean>;
}

/** Why an action could not proceed — each reason has its own way forward. */
export type TemplateActionBlock =
  | "license"
  | "capacity"
  | "pages"
  | "unavailable"
  | "cancelled";

export type TemplateActionResult =
  | { status: "opened"; projectId: string }
  | { status: "duplicated"; templateId: string; title: string }
  | { status: "blocked"; reason: TemplateActionBlock; message?: string };

/** A bundled pack/page outside the demo allowance belongs to a paid plan. */
export function entryRequiresLicense(
  entry: CatalogEntry,
  entitlements: Record<FeatureId, boolean>,
): boolean {
  if (entry.managedTemplate) {
    return entry.managedTemplate.tier === "licensed" && !entitlements.premium_templates;
  }
  return (
    entry.kind === "pack" &&
    !canUseDemoPack(entry.sourceId) &&
    !entitlements.premium_templates
  );
}

/**
 * The project seed for a catalog entry, with a managed template's content
 * fetched through the same server gate the public template page uses.
 */
async function seedForEntry(
  entry: CatalogEntry,
  context: TemplateActionContext,
  overrides: { name?: string } = {},
): Promise<
  | { status: "ok"; seed: ReturnType<typeof entryProjectSeed> }
  | { status: "blocked"; reason: TemplateActionBlock; message?: string }
> {
  try {
    if (!entry.managedTemplate) {
      const seed = entryProjectSeed(entry, {
        themeId: context.theme,
        orgName: context.orgName,
      });
      return { status: "ok", seed: overrides.name ? { ...seed, name: overrides.name } : seed };
    }
    const { getPublishedTemplateFn } = await import("@/lib/admin/functions");
    const result = await getPublishedTemplateFn({
      data: { id: templateDisplaySlug(entry.managedTemplate) },
    });
    if (!result.ok) {
      if ("locked" in result && result.locked) {
        return {
          status: "blocked",
          reason: "license",
          message: "هذا القالب متاح في النسخة الكاملة.",
        };
      }
      return {
        status: "blocked",
        reason: "unavailable",
        message: result.error || "القالب غير متاح",
      };
    }
    const context$ = entryProjectSeed(entry, {
      themeId: context.theme,
      orgName: context.orgName,
    });
    const seed = mergePublishedTemplateContext(
      publishedTemplateSeed(result.template),
      context$,
    );
    return { status: "ok", seed: overrides.name ? { ...seed, name: overrides.name } : seed };
  } catch {
    return {
      status: "blocked",
      reason: "unavailable",
      message: "تعذر تحميل محتوى القالب — تحقق من الاتصال ثم أعد المحاولة.",
    };
  }
}

/**
 * Capacity gates, said in the store's own numbers so a template page can never
 * offer more than the licence behind it allows.
 */
function capacityBlock(
  pages: number,
  projectCount: number,
  entitlements: Record<FeatureId, boolean>,
): TemplateActionResult | null {
  if (!entitlements.unlimited_projects && !canCreateDemoProject(projectCount)) {
    return {
      status: "blocked",
      reason: "capacity",
      message: "اكتملت مساحة تجربة المحرر — يتضمن العرض مشروعًا واحدًا.",
    };
  }
  const maxPages = DEMO_LICENSE.entitlements.maxPagesPerProject ?? Infinity;
  if (!entitlements.unlimited_pages && pages > maxPages) {
    return {
      status: "blocked",
      reason: "pages",
      message: "يتاح حتى 3 صفحات في العرض — افتح النسخة الكاملة لمشاريع أطول.",
    };
  }
  return null;
}

/** Make sure the store judges the new project against the same entitlements. */
async function prepareStore(context: TemplateActionContext) {
  const store = useEditor.getState();
  store.setEntitlements(context.entitlements);
  await store.hydrate();
  return useEditor.getState();
}

/**
 * «استخدام القالب» — a NEW editable document. The template itself is untouched,
 * and the author lands in the editor on the project that was just created.
 */
export async function startFromTemplateEntry(
  entry: CatalogEntry,
  context: TemplateActionContext,
): Promise<TemplateActionResult> {
  if (entryRequiresLicense(entry, context.entitlements)) {
    return { status: "blocked", reason: "license" };
  }
  const store = await prepareStore(context);
  const resolved = await seedForEntry(entry, context);
  if (resolved.status === "blocked") {
    return { status: "blocked", reason: resolved.reason, message: resolved.message };
  }
  const blocked = capacityBlock(
    resolved.seed.pages.length,
    store.projects.length,
    context.entitlements,
  );
  if (blocked) return blocked;
  const access = projectAccessBlock(resolved.seed, context.entitlements);
  if (access) {
    return {
      status: "blocked",
      reason: access === "premium-template" ? "license" : "pages",
    };
  }
  const imported = await useEditor.getState().importProject(resolved.seed, {
    successMessage: null,
  });
  if (!imported) {
    return {
      status: "blocked",
      reason: "unavailable",
      message: "تعذر إنشاء مستند من هذا القالب.",
    };
  }
  const projectId = useEditor.getState().id;
  return projectId
    ? { status: "opened", projectId }
    : { status: "blocked", reason: "unavailable" };
}

/**
 * «تعديل القالب» — a working copy in the editor. A copy that already exists for
 * this entry is re-opened instead of being replaced, so an author's edits are
 * never silently orphaned.
 */
export async function editTemplateEntry(
  entry: CatalogEntry,
  context: TemplateActionContext,
): Promise<TemplateActionResult> {
  if (entryRequiresLicense(entry, context.entitlements)) {
    return { status: "blocked", reason: "license" };
  }
  const store = await prepareStore(context);
  const draft = draftSnapshot();
  if (draft?.entryId === entry.id) {
    const existing = await getProject(draft.projectId);
    if (existing?.pages?.length) {
      const opened = await useEditor.getState().openProject(draft.projectId);
      return opened
        ? { status: "opened", projectId: draft.projectId }
        : { status: "blocked", reason: "unavailable" };
    }
  }

  const resolved = await seedForEntry(entry, context, {
    name: `${entry.title} — مسودة`,
  });
  if (resolved.status === "blocked") {
    return { status: "blocked", reason: resolved.reason, message: resolved.message };
  }
  const blocked = capacityBlock(
    resolved.seed.pages.length,
    store.projects.length,
    context.entitlements,
  );
  if (blocked) return blocked;
  const access = projectAccessBlock(resolved.seed, context.entitlements);
  if (access) {
    return {
      status: "blocked",
      reason: access === "premium-template" ? "license" : "pages",
    };
  }
  const imported = await useEditor.getState().importProject(resolved.seed, {
    successMessage: null,
  });
  if (!imported) {
    return { status: "blocked", reason: "unavailable" };
  }
  const projectId = useEditor.getState().id;
  if (!projectId) return { status: "blocked", reason: "unavailable" };
  try {
    await saveDraft({
      entryId: entry.id,
      title: entry.title,
      projectId,
      kind: entry.kind === "custom" ? "custom" : "copy",
      startedAt: Date.now(),
    });
  } catch {
    /* the working copy is still open; the draft link is a convenience */
  }
  return { status: "opened", projectId };
}

/** «تكرار» — the copy is always a personal template, whatever the source was. */
export async function duplicateTemplateEntry(
  entry: CatalogEntry,
  context: TemplateActionContext,
): Promise<TemplateActionResult> {
  if (entryRequiresLicense(entry, context.entitlements)) {
    return { status: "blocked", reason: "license" };
  }
  await prepareStore(context);
  if (entry.kind === "custom") {
    try {
      const copy = await duplicateCustomTemplate(entry.sourceId, context.entitlements);
      if (!copy) return { status: "blocked", reason: "unavailable" };
      return { status: "duplicated", templateId: copy.id, title: copy.title };
    } catch {
      return { status: "blocked", reason: "unavailable" };
    }
  }
  const resolved = await seedForEntry(entry, context);
  if (resolved.status === "blocked") {
    return { status: "blocked", reason: resolved.reason, message: resolved.message };
  }
  const access = projectAccessBlock(resolved.seed, context.entitlements);
  if (access) {
    return {
      status: "blocked",
      reason: access === "premium-template" ? "license" : "pages",
    };
  }
  try {
    const saved = await saveCustomTemplate(
      {
        title: `${entry.title} — نسخة`,
        desc: entry.desc,
        category: entry.category,
        pills: entry.pills.filter((pill) => pill !== "all" && pill !== "custom"),
        tags: entry.tags,
        derivedFrom: entry.id,
        licensedTemplateId: resolved.seed.licensedTemplateId,
        pack: resolved.seed.pack,
        pages: resolved.seed.pages,
      },
      context.entitlements,
    );
    return { status: "duplicated", templateId: saved.id, title: saved.title };
  } catch {
    return { status: "blocked", reason: "unavailable" };
  }
}
