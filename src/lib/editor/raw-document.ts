/*
 * Draft → real NASAQ document, composed from the EXISTING parts.
 *
 * There is no second document builder here. The page comes from
 * `buildNewDocument` (the same «إنشاء تصميم» configuration the creation screen
 * uses, chrome included), and the content is `buildReportDraftBlock` — the very
 * block `store.insertReportDraft` places when the author uses «مسودات التقارير»
 * inside the editor. The only new thing is the placement, which is arithmetic
 * because this composer runs BEFORE any canvas exists.
 *
 * That ordering matters: the raw-content flow composes a complete project,
 * saves it through the store's own `importProject` (entitlements, history,
 * library) and then opens `/editor/<id>` — so the demonstration ends in the real
 * editor, on a real address, not in a preview of one.
 */

import type { ReportDraft } from "@/lib/ai/contract";
import type { Project, ThemeId } from "./model";
import { buildNewDocument, defaultNewDocument, type PageSizeId } from "./new-document";
import { buildReportDraftBlock } from "./report-blocks";
import { placeElements } from "./report-tools";

/** A4's content margin: the 170 mm block centred on a 210 mm page. */
export const DRAFT_ORIGIN = { x: 20, y: 24 } as const;

export interface DraftDocumentInput {
  draft: ReportDraft;
  theme: ThemeId;
  orgName: string;
  /** Overrides the draft's own title when the author named the document. */
  title?: string;
  size?: PageSizeId;
}

/**
 * One page with light chrome (header/footer carry the organisation and the
 * document name) and the draft block as one editable group.
 */
export function buildDraftDocument(input: DraftDocumentInput): Project {
  const project = buildNewDocument(
    defaultNewDocument({
      start: "blank",
      content: "chrome",
      pages: 1,
      theme: input.theme,
      orgName: input.orgName,
      name: input.title?.trim() || input.draft.title,
      size: input.size ?? "a4",
      orientation: "portrait",
    }),
  );
  const block = buildReportDraftBlock(input.theme, input.draft, DRAFT_ORIGIN);
  if (!block) return project;
  return {
    ...project,
    pages: project.pages.map((page, index) =>
      index === 0 ? placeElements(page, [block]) : page,
    ),
  };
}
