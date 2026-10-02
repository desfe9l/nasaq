/**
 * Versioned design-analysis schema for NASAQ template intelligence.
 *
 * This describes measured reference facts and the rules derived from them.
 * It is not a second document model. Generated pages are ordinary NASAQ
 * `Project` / `Page` / `CanvasEl` values.
 */

export const INTELLIGENCE_SCHEMA_VERSION = 1 as const;

export const DESIGN_STYLES = [
  "institutional",
  "government",
  "corporate",
  "executive",
  "editorial",
  "presentation",
  "report",
  "infographic",
  "auction",
] as const;

export type DesignStyle = (typeof DESIGN_STYLES)[number];

export type DesignFormat = "a4-book" | "wide-slide" | "tall-story" | "custom-brochure";

export type PipelinePath = "generate" | "improve";

export interface ReferenceFact {
  file: string;
  bytes: number;
  pages: number;
  sizes: Array<{
    w: number;
    h: number;
    pages: number;
    orientation: "portrait" | "landscape" | "square";
  }>;
  primarySize: {
    w: number;
    h: number;
    pages: number;
    orientation: "portrait" | "landscape" | "square";
  };
  fonts: Array<{ name: string; spans: number }>;
  textSamples: Array<{ page: number; text: string }>;
  spans: Array<{
    page: number;
    text: string;
    size: number;
    font: string;
    color?: number;
  }>;
  colors: {
    edge: Array<{ hex: string; count: number }>;
    overall: Array<{ hex: string; count: number }>;
    sampledPx: number;
  };
}

export interface PaletteRoles {
  field: string;
  paper: string;
  ink: string;
  accent: string;
  muted: string;
  onField: string;
}

export interface DesignAnalysis {
  schemaVersion: typeof INTELLIGENCE_SCHEMA_VERSION;
  id: string;
  source: { file: string; bytes: number; kind: "pdf" };
  fidelity: "measured-pdf";
  /** What the extractor could not see. Never filled with guesses. */
  limitations: string[];
  document: {
    pages: number;
    primary: { w: number; h: number; orientation: "portrait" | "landscape" | "square" };
    variants: ReferenceFact["sizes"];
    format: DesignFormat;
    language: "ar" | "mixed" | "unknown";
    direction: "rtl";
  };
  title: string;
  typography: {
    families: string[];
    sizes: number[];
  };
  palette: PaletteRoles;
  /** Edge colors actually counted on the rendered first page. */
  colorSamples: string[];
  extractedLines: string[];
  components: string[];
}

export interface ComponentKnowledge {
  id: string;
  role: string;
  nasaqTypes: string[];
  rule: string;
}

export interface DesignDna {
  schemaVersion: typeof INTELLIGENCE_SCHEMA_VERSION;
  id: "nasaq-design-dna-v1";
  sourceCount: number;
  statement: string;
  direction: "rtl";
  typography: {
    display: string;
    body: string;
    meta: string;
    ceremony: string;
    sizes: { display: number; h1: number; h2: number; body: number; meta: number; folio: number };
    lineHeights: { display: number; body: number; meta: number };
    observedFamilies: string[];
    mappingRule: string;
  };
  grid: {
    marginMm: number;
    columns: number;
    gutterMm: number;
    measureMm: number;
  };
  styles: Record<DesignStyle, PaletteRoles & { label: string; note: string }>;
  components: ComponentKnowledge[];
  rules: string[];
  constraints: string[];
}

export interface DesignBrief {
  title: string;
  subtitle?: string;
  org?: string;
  style: DesignStyle;
  pages: number;
  kind: "report" | "presentation" | "infographic";
}

export interface CritiqueIssue {
  id: string;
  severity: "high" | "medium" | "low";
  metric: string;
  evidence: string;
  instruction: string;
}

export interface Critique {
  schemaVersion: typeof INTELLIGENCE_SCHEMA_VERSION;
  score: number;
  issues: CritiqueIssue[];
}

export interface Correction {
  pageId: string;
  elementId: string;
  action: string;
  instruction: string;
  before: Record<string, string | number>;
  after: Record<string, string | number>;
}

export interface ImprovementVerdict {
  sizeKept: boolean;
  titleKept: boolean;
  contentKept: boolean;
  scoreBefore: number;
  scoreAfter: number;
  realImprovement: boolean;
  notes: string[];
}

export interface PipelineResult {
  schemaVersion: typeof INTELLIGENCE_SCHEMA_VERSION;
  path: PipelinePath;
  label: string;
  projectName: string;
  iterations: Array<{ score: number; applied: Correction[] }>;
  critique: Critique;
  /** Present on the improve path: literal import versus the composed result. */
  verdict?: ImprovementVerdict;
  stoppedBecause: "stable" | "max-iterations" | "no-safe-fix";
}
