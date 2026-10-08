export { INTELLIGENCE_SCHEMA_VERSION, DESIGN_STYLES } from "./schema";
export type {
  Critique,
  DesignAnalysis,
  DesignBrief,
  DesignDna,
  DesignStyle,
  PipelineResult,
} from "./schema";
export { referenceAnalyses, referenceById, designDna, generateTemplate, improveProject, improveReference } from "./pipeline";
export { critiqueProject, applyGatedFixes } from "./critic";
export { validateProject } from "./layout";
export { languageModelConfigured, visualNoteReady, DETERMINISTIC_MODEL_ID } from "./provider";
export { adapterFor } from "./sources";
export {
  LAYOUT_PATTERNS,
  LAYOUT_PATTERN_META,
  applySecondaryLayout,
  checkLayoutVariety,
  contentBlocks,
  directiveForPattern,
  enforceLayoutVariety,
  normalizePageLayoutDirectives,
  pageFingerprint,
  pagePattern,
  planPageLayouts,
  stampLayoutMeta,
} from "./layout-variety";
export type {
  LayoutHierarchyLevel,
  LayoutPatternId,
  LayoutPlanInput,
  LayoutPositioning,
  LayoutSimilarity,
  LayoutVarietyReport,
  LayoutWhitespace,
  PageLayoutDirective,
} from "./layout-variety";
export {
  STYLE_PRESETS,
  applyStylePreset,
  describePreset,
  paletteFollows60_30_10,
  presetForDesignStyle,
  stylePresetFor,
  stylePresets,
} from "./style-presets";
export type { StylePreset, StylePresetId } from "./style-presets";
