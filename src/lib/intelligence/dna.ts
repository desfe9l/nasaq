import { COMPONENT_KNOWLEDGE } from "./components";
import type { DesignAnalysis, DesignDna, DesignStyle, PaletteRoles } from "./schema";
import { DESIGN_STYLES } from "./schema";

const INSTITUTIONAL: PaletteRoles = {
  field: "#0c3d2c",
  paper: "#f7f6f3",
  ink: "#172033",
  accent: "#c6a05a",
  muted: "#5c6570",
  onField: "#f7f6f3",
};

const CORPORATE: PaletteRoles = {
  field: "#071d3d",
  paper: "#f7f8fb",
  ink: "#172033",
  accent: "#c6a05a",
  muted: "#5c6570",
  onField: "#f7f8fb",
};

const TEAL: PaletteRoles = {
  field: "#0e4c5a",
  paper: "#f4f7f6",
  ink: "#142028",
  accent: "#d4b483",
  muted: "#5c6570",
  onField: "#f4f7f6",
};

const EDITORIAL: PaletteRoles = {
  field: "#1c1917",
  paper: "#f7f6f3",
  ink: "#1c1917",
  accent: "#c6a05a",
  muted: "#6b7280",
  onField: "#f7f6f3",
};

const PURPLE: PaletteRoles = {
  field: "#3b1764",
  paper: "#f7f5fb",
  ink: "#1c1430",
  accent: "#d4b483",
  muted: "#6b6578",
  onField: "#f7f5fb",
};

/**
 * Style roles are a system, not a swatch copied from one brochure.
 * Institutional/government/report follow the existing NASAQ media grammar.
 * Auction/editorial/corporate shift the field color only.
 */
const STYLE_NOTES: Record<DesignStyle, { palette: PaletteRoles; label: string; note: string }> = {
  institutional: {
    palette: INSTITUTIONAL,
    label: "مؤسسي",
    note: "ورق فاتح، حقل أخضر عميق، خيط ذهبي. لغة تقارير نَسَق.",
  },
  government: {
    palette: INSTITUTIONAL,
    label: "حكومي",
    note: "نفس النحو المؤسسي. لا شعار جهة، ولا ادعاء اعتماد.",
  },
  corporate: {
    palette: CORPORATE,
    label: "شركات",
    note: "حقل كحلي بدل الأخضر. الذهب يبقى خطًا واحدًا.",
  },
  executive: {
    palette: INSTITUTIONAL,
    label: "تنفيذي",
    note: "قرار واحد ورقم واحد. مسافة أوسع بين العنوان والمتن.",
  },
  editorial: {
    palette: EDITORIAL,
    label: "تحريري",
    note: "حبر على ورق. الحقل الداكن للغلاف فقط.",
  },
  presentation: {
    palette: CORPORATE,
    label: "عرض",
    note: "شريحة عريضة. عنوان واحد في الشريحة.",
  },
  report: {
    palette: INSTITUTIONAL,
    label: "تقرير",
    note: "غلاف، قسم، مؤشرات، ختام.",
  },
  infographic: {
    palette: TEAL,
    label: "إنفوجرافيك",
    note: "تسلسل عمودي مرقم. ليس لوحة معلومات.",
  },
  auction: {
    palette: TEAL,
    label: "مزاد",
    note: "حقل فيروزي مستخلص من مجموعة المراجع، لا من ملف واحد.",
  },
};

export function isDesignStyle(value: string): value is DesignStyle {
  return (DESIGN_STYLES as readonly string[]).includes(value);
}

export function paletteForStyle(style: DesignStyle): PaletteRoles {
  return STYLE_NOTES[style].palette;
}

export function buildDesignDna(analyses: DesignAnalysis[]): DesignDna {
  const families = [...new Set(analyses.flatMap((item) => item.typography.families))].slice(0, 24);
  const styles = Object.fromEntries(
    DESIGN_STYLES.map((style) => [
      style,
      {
        ...STYLE_NOTES[style].palette,
        label: STYLE_NOTES[style].label,
        note: STYLE_NOTES[style].note,
      },
    ]),
  ) as DesignDna["styles"];

  return {
    schemaVersion: 1,
    id: "nasaq-design-dna-v1",
    sourceCount: analyses.length,
    statement:
      "Shared rules from the measured references plus the NASAQ media grammar. A new document follows the rules. It does not reproduce a reference.",
    direction: "rtl",
    typography: {
      display: "Tajawal",
      body: "Noto Naskh Arabic",
      meta: "IBM Plex Sans Arabic",
      ceremony: "Amiri",
      sizes: { display: 28, h1: 18, h2: 13, body: 11, meta: 8, folio: 8 },
      lineHeights: { display: 1.12, body: 1.7, meta: 1.35 },
      observedFamilies: families,
      mappingRule:
        "Font names found in the PDFs are recorded only. NASAQ draws the roles with families the editor already ships. Commercial faces are not embedded.",
    },
    grid: { marginMm: 16, columns: 12, gutterMm: 4, measureMm: 178 },
    styles,
    components: COMPONENT_KNOWLEDGE,
    rules: [
      "Arabic pages are designed RTL. Text alignment is right unless a folio or a centered seal.",
      "A4 books use a 16mm margin and a 178mm measure.",
      "One field color, one paper, one accent. The accent is a thread, a circle, or a diamond — not body text.",
      "The cover may bleed. Interior text does not.",
      "The page number sits in a circle on the outer edge.",
      "A data page may use stat cards and one table. A prose page does not become a card grid.",
      "Photography is a replaceable image element.",
      "Tall stories stack from the top and close at the foot. Wide slides put the field on the right.",
      "ANTI-MONOTONY: no two consecutive pages share one composition. Interior pages rotate between summary, stat cards, tables, multi-column cards, asymmetric editorial grids, and airy summary callouts.",
      "Every page keeps the 60-30-10 color discipline: 60% paper (dominant), 30% field (secondary), 10% accent (thread, diamond, or number circle — never body text).",
    ],
    constraints: [
      "Do not copy a reference title, photograph, phone number, or deed into an original brief.",
      "An improved reference keeps the dominant page size, orientation, and extracted wording.",
      "Do not invent measurements, prices, or case numbers that were not in the file.",
      "Do not add a second template catalog. Results are ordinary NASAQ projects.",
      "Purple field is an allowed variation because several references measured it. It is not the default institutional palette.",
    ],
  };
}

export const PURPLE_FIELD = PURPLE;
