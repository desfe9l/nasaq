import type { ComponentKnowledge } from "./schema";

/**
 * Recurring structures in the reference set, mapped onto element types the
 * editor already edits. No new canvas primitive is introduced.
 */
export const COMPONENT_KNOWLEDGE: ComponentKnowledge[] = [
  {
    id: "cover",
    role: "غلاف",
    nasaqTypes: ["shape", "text", "image", "logo"],
    rule: "One field band, one title, one replaceable image. Not a copy of a reference lockup.",
  },
  {
    id: "title-block",
    role: "كتلة عنوان",
    nasaqTypes: ["text", "line"],
    rule: "Display line, then a short gold thread, then one lede. The thread is not a paragraph.",
  },
  {
    id: "running-head",
    role: "ترويسة",
    nasaqTypes: ["shape", "text"],
    rule: "A short field bar. The title sits inside it, right-aligned.",
  },
  {
    id: "footer",
    role: "تذييل",
    nasaqTypes: ["shape", "text"],
    rule: "Full-width field bar. Organization name only. No second accent.",
  },
  {
    id: "folio",
    role: "رقم الصفحة",
    nasaqTypes: ["shape", "text"],
    rule: "Number inside a circle on the outer (left) edge, vertically centered in the circle.",
  },
  {
    id: "kpi",
    role: "مؤشر",
    nasaqTypes: ["stat"],
    rule: "A number and a short label. Used on data pages, not on covers.",
  },
  {
    id: "table",
    role: "جدول",
    nasaqTypes: ["table"],
    rule: "Field-colored header, right-aligned cells, no deed numbers invented by the generator.",
  },
  {
    id: "photo-slot",
    role: "صورة",
    nasaqTypes: ["image"],
    rule: "A replaceable image element. The frame stays when the source changes.",
  },
  {
    id: "callout",
    role: "إبراز",
    nasaqTypes: ["box"],
    rule: "One note, not a card grid on a prose page.",
  },
  {
    id: "meta",
    role: "بيانات",
    nasaqTypes: ["text"],
    rule: "Small meta face. Dates and classification, never the title.",
  },
  {
    id: "stamp",
    role: "ختم",
    nasaqTypes: ["stamp"],
    rule: "Closing pages only.",
  },
  {
    id: "qr",
    role: "رمز",
    nasaqTypes: ["qr"],
    rule: "Optional, author-replaceable. Never a copied code from a reference.",
  },
];
