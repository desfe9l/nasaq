/**
 * Where a reference enters the pipeline.
 *
 * PDF facts are already measured. PSD bytes are not parsed here: the editor
 * importer in `src/lib/editor/psd` already turns a PSD into a NASAQ Project,
 * and `improveProject` is the improvement path for that project.
 */

export interface DesignSourceAdapter {
  kind: "pdf" | "psd";
  /** True when an existing NASAQ pipeline can read the original bytes. */
  readsBytes: boolean;
  note: string;
}

export const PDF_ADAPTER: DesignSourceAdapter = {
  kind: "pdf",
  readsBytes: false,
  note: "PDF references are measured facts only: page size, fonts, edge colors, and logical text. The file has no layer tree.",
};

export const PSD_ADAPTER: DesignSourceAdapter = {
  kind: "psd",
  readsBytes: true,
  note: "PSD bytes are converted by the existing importer in src/lib/editor/psd, which returns a NASAQ Project. Intelligence improves that project and does not parse PSD itself.",
};

export function adapterFor(kind: "pdf" | "psd"): DesignSourceAdapter {
  return kind === "psd" ? PSD_ADAPTER : PDF_ADAPTER;
}
