/*
 * «تعديل القالب» — writing the edited working copy back into the library.
 *
 * `TemplatesPage` opens a template as a real project and records the link in
 * `TemplateDraft`. This module is the one place that turns that project back
 * into a template, so the catalog banner and the editor's own «تحديث القالب»
 * save exactly the same thing:
 *
 *   • a `custom` draft overwrites its custom template (same id, same metadata,
 *     the edited pages);
 *   • a `copy` draft (shipped / managed template) becomes a NEW custom template
 *     derived from the source — the shipped template itself is never modified.
 *
 * The project is read from the project library (IndexedDB), i.e. the last
 * SAVED state of the document — callers flush pending edits first.
 */

import type { PackId, Page } from "@/lib/editor/model";
import {
  projectAccessBlock,
  type EditorAccessEntitlements,
  type ProjectAccessBlock,
} from "@/lib/editor/access-limits";
import type { CatalogEntry } from "@/lib/templates/catalog";
import {
  clearDraft,
  saveCustomTemplate,
  type CustomTemplate,
  type TemplateDraft,
} from "@/lib/templates/custom-templates";

/** The project fields the commit needs (a subset of the stored project). */
export interface DraftProject {
  pages?: Page[];
  pack?: PackId;
  licensedTemplateId?: string;
}

export type DraftCommitResult =
  /** The working copy is gone (deleted project); the stale draft is cleared. */
  | { status: "missing" }
  /** The account may not save this content; nothing was written. */
  | { status: "blocked"; block: ProjectAccessBlock }
  /** Written to the library; `updated` = an existing custom template was overwritten. */
  | { status: "saved"; template: CustomTemplate; updated: boolean };

/**
 * Persist a template draft. Throws `TemplateStorageError` / `TemplateAccessError`
 * from the library write (quota, entitlement) so callers can show its message.
 */
export async function commitTemplateDraft(
  draft: TemplateDraft,
  options: {
    entries: readonly CatalogEntry[];
    entitlements: EditorAccessEntitlements;
    readProject: (id: string) => Promise<DraftProject | null | undefined>;
  },
): Promise<DraftCommitResult> {
  const project = await options.readProject(draft.projectId);
  if (!project?.pages?.length) {
    clearDraft();
    return { status: "missing" };
  }
  const target = options.entries.find((e) => e.id === draft.entryId);
  const pack =
    project.pack ??
    target?.custom?.pack ??
    (!target?.managedTemplate && target?.kind === "pack"
      ? (target.sourceId as PackId)
      : undefined);
  const licensedTemplateId =
    project.licensedTemplateId ??
    target?.custom?.licensedTemplateId ??
    (target?.managedTemplate?.tier === "licensed" ? target.managedTemplate.id : undefined);

  const block = projectAccessBlock(
    { pages: project.pages, pack, licensedTemplateId },
    options.entitlements,
  );
  if (block) return { status: "blocked", block };

  const updated = draft.kind === "custom" && Boolean(target?.custom);
  const template =
    updated && target?.custom
      ? saveCustomTemplate(
          {
            id: target.custom.id,
            title: target.custom.title,
            desc: target.custom.desc,
            category: target.custom.category,
            pills: target.custom.pills,
            tags: target.custom.tags,
            derivedFrom: target.custom.derivedFrom,
            pack,
            licensedTemplateId,
            pages: project.pages,
          },
          options.entitlements,
        )
      : saveCustomTemplate(
          {
            title: draft.title,
            desc: `مُشتق من «${draft.title}» بعد التعديل.`,
            category: target?.category || "editorial",
            pills: target?.pills.filter((p) => p !== "all" && p !== "custom") ?? [],
            tags: target?.tags ?? [],
            derivedFrom: draft.entryId,
            pack,
            licensedTemplateId,
            pages: project.pages,
          },
          options.entitlements,
        );
  clearDraft();
  return { status: "saved", template, updated };
}
