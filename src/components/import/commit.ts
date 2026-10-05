/**
 * Save / open helpers shared by the import service and the admin console
 * importer. Everything a converted document needs to land in the editor goes
 * through one path: asset decisions, embedded fonts, the project title, the
 * IndexedDB save and the import-service history entry.
 */

import { adminUpsertTemplateFn } from "@/lib/admin/functions";
import type { Project } from "@/lib/editor/model";
import { editorPathFor } from "@/lib/site-routes";
import type { AssetFinding } from "@/lib/editor/psd/types";
import type { AssetDecision } from "@/lib/editor/psd/pipeline";
import { applyAssetDecisions } from "@/lib/editor/psd/pipeline";
import { rememberUploadedFont } from "@/lib/nsq/fonts";
import type { ProjectMeta } from "@/lib/editor/model";
import {
  getProject,
  getSetting,
  saveProject,
  setSetting,
} from "@/lib/editor/storage";
import { syncStorageOwner } from "@/lib/auth/storage-owner-sync";
import { resolveTemplateName } from "@/lib/templates/naming";
import { applyBrandToProject } from "@/lib/editor/brand-design";
import type { BrandKit } from "@/lib/product/product";

export const IMPORT_HISTORY_KEY = "importServiceHistory";
const HISTORY_LIMIT = 24;

export interface ImportHistoryEntry {
  id: string;
  name: string;
  format: string;
  savedAt: number;
}

/** Fonts the owner attached during import, keyed by family. */
export type AttachedFonts = Record<string, string>;

export interface CommitInput {
  title: string;
  titleIsManual?: boolean;
  sourceName?: string;
  format?: string;
  /** Office / PDF / raster import result (project already final). */
  project: Project;
  /** PSD conversion, for asset decisions. */
  psd?: { project: Project; assets: AssetFinding[] } | null;
  fonts?: AttachedFonts;
  /**
   * The account's institutional identity, when `brand_kit` is licensed and the
   * author asked for it. Applied here — the one place every import path passes
   * through — so a converted file arrives in the organisation's colours without
   * any importer knowing about identities.
   */
  brand?: BrandKit | null;
}

/** Build the final project (assets routed, fonts embedded, title applied). */
export async function buildFinalProject(input: CommitInput): Promise<Project> {
  let project = input.project;
  if (input.psd) {
    const decisions: AssetDecision[] = input.psd.assets.map((asset) => ({
      hash: asset.hash,
      disposition: "design",
    }));
    const applied = applyAssetDecisions(input.psd.project, input.psd.assets, decisions, new Map());
    project = applied.project;
  }
  const embedded = Object.entries(input.fonts || {}).map(([family, dataUrl]) => {
    rememberUploadedFont(family, dataUrl);
    return { family, dataUrl };
  });
  if (input.brand) project = applyBrandToProject(project, input.brand);
  const name = resolveTemplateName({
    title: input.title,
    titleIsManual: input.titleIsManual,
    sourceName: input.sourceName,
    kind: "json",
    format: input.format,
    category: input.format === "pptx" ? "slides" : "import",
    content: project,
  });
  return {
    ...project,
    name,
    embeddedFonts: embedded.length ? embedded : project.embeddedFonts,
  };
}

/** Record the save in the import-service history (best effort). */
export async function rememberImport(saved: Project | ProjectMeta, format: string): Promise<void> {
  try {
    if (!saved.id) return;
    const history = (await getSetting<ImportHistoryEntry[]>(IMPORT_HISTORY_KEY)) || [];
    const next = [
      { id: saved.id, name: saved.name, format, savedAt: Date.now() },
      ...history.filter((row) => row.id !== saved.id),
    ].slice(0, HISTORY_LIMIT);
    await setSetting(IMPORT_HISTORY_KEY, next);
  } catch {
    /* history is a convenience, never a blocker */
  }
}

export interface SaveOutcome {
  ok: boolean;
  id?: string;
  error?: string;
}

/** Save the document into the local library and remember the import. */
export async function saveImportedDocument(project: Project, format: string): Promise<SaveOutcome> {
  try {
    await syncStorageOwner();
    const saved = await saveProject(project);
    await rememberImport(saved, format);
    return { ok: true, id: saved.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "تعذر حفظ المستند" };
  }
}

/** Persist the repaired project back over an existing library row. */
export async function updateImportedDocument(project: Project): Promise<SaveOutcome> {
  try {
    if (!project.id) return { ok: false, error: "المستند بلا معرف محفوظ" };
    const existing = await getProject(project.id);
    if (!existing) return { ok: false, error: "لم يُعثر على المستند في المكتبة" };
    const saved = await saveProject({ ...project, updatedAt: Date.now() });
    return { ok: true, id: saved.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "تعذر تحديث المستند" };
  }
}

/** Point the editor at the saved document and open it. */
export async function openSavedInEditor(id: string): Promise<void> {
  await setSetting("activeProjectId", id);
  window.location.assign(editorPathFor(id));
}

export interface TemplateOutcome {
  ok: boolean;
  error?: string;
}

/** Keep the document as a draft template in the admin catalogue. */
export async function saveImportedTemplate(
  project: Project,
  format: string,
  description: string,
  thumbnail: string | null,
  sourceName = "",
  titleIsManual = false,
): Promise<TemplateOutcome> {
  const content = JSON.stringify(project);
  if (content.length > 4 * 1024 * 1024) {
    return {
      ok: false,
      error: "المستند أكبر من حد القالب (4 ميغابايت). افتحه في المحرر، أو أبقِ الصور داخل التصميم فقط.",
    };
  }
  const saved = await adminUpsertTemplateFn({
    data: {
      template: {
        title: project.name,
        titleIsManual,
        sourceName,
        format,
        description: description.slice(0, 500),
        category: format === "psd" || format === "psb" ? "psd" : format === "pptx" ? "slides" : "import",
        tier: "free",
        status: "draft",
        kind: "json",
        content,
        thumbnail: thumbnail && thumbnail.length < 1_800_000 ? thumbnail : null,
      },
    },
  });
  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true };
}
