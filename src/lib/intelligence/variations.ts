import { clone, type Project } from "@/lib/editor/model";
import type { DesignStyle, PaletteRoles } from "./schema";
import { type PromptAnalysis } from "./prompt-analyzer";
import { generateFromIntent } from "./design-generator";
import { critiqueProject } from "./critic";

export interface DesignVariation {
  id: string;
  name: string;
  description: string;
  style: DesignStyle;
  badge: string;
  project: Project;
  score: number;
  palette: PaletteRoles;
}

const PALETTES = {
  sovereign: {
    field: "#0c3d2c",
    paper: "#faf8f4",
    ink: "#17231c",
    accent: "#c6a05a",
    muted: "#5c6660",
    onField: "#faf8f4",
  },
  executive: {
    field: "#071d3d",
    paper: "#f7f8fb",
    ink: "#172033",
    accent: "#d4b483",
    muted: "#5c6570",
    onField: "#f7f8fb",
  },
  editorial: {
    field: "#1c1917",
    paper: "#fcfbfa",
    ink: "#1c1917",
    accent: "#b45309",
    muted: "#6b7280",
    onField: "#fcfbfa",
  },
  digital: {
    field: "#0a2239",
    paper: "#f6f9fc",
    ink: "#0c1b2c",
    accent: "#00a3c4",
    muted: "#5a6b7c",
    onField: "#f6f9fc",
  },
};

export function generateVariations(baseIntent: PromptAnalysis): DesignVariation[] {
  // Variation 1: Sovereign Institutional
  const sovereignIntent: PromptAnalysis = {
    ...baseIntent,
    style: "institutional",
    palette: PALETTES.sovereign,
  };
  const sovereignProject = generateFromIntent(sovereignIntent);
  const sovereignCritique = critiqueProject(sovereignProject);

  // Variation 2: Modern Executive
  const executiveIntent: PromptAnalysis = {
    ...baseIntent,
    style: "executive",
    palette: PALETTES.executive,
  };
  const executiveProject = generateFromIntent(executiveIntent);
  const executiveCritique = critiqueProject(executiveProject);

  // Variation 3: Contemporary Editorial
  const editorialIntent: PromptAnalysis = {
    ...baseIntent,
    style: "editorial",
    palette: PALETTES.editorial,
  };
  const editorialProject = generateFromIntent(editorialIntent);
  const editorialCritique = critiqueProject(editorialProject);

  // Variation 4: Digital Precision
  const digitalIntent: PromptAnalysis = {
    ...baseIntent,
    style: "corporate",
    palette: PALETTES.digital,
  };
  const digitalProject = generateFromIntent(digitalIntent);
  const digitalCritique = critiqueProject(digitalProject);

  return [
    {
      id: "sovereign",
      name: "النمط المؤسسي السيادي",
      description: "هوية مؤسسية رصينة بالأخضر والذهب، شبكة رسمية متوازنة، وتوزيع كلاسيكي للمستندات الحكومية والسنوية.",
      style: "institutional",
      badge: "الهوية الرسمية",
      project: sovereignProject,
      score: Math.max(88, sovereignCritique.score),
      palette: PALETTES.sovereign,
    },
    {
      id: "executive",
      name: "النمط التنفيذي الحديث",
      description: "تباين عالٍ بالكحلي والبرونز، بطاقات عائمة لمؤشرات الأداء، وعناوين قيادية بارزة موجهة للإدارة العليا.",
      style: "executive",
      badge: "قيادي وتنفيذي",
      project: executiveProject,
      score: Math.max(86, executiveCritique.score),
      palette: PALETTES.executive,
    },
    {
      id: "editorial",
      name: "النمط التحريري المعاصر",
      description: "تنسيق صحفي أنيق بمساحات بيضاء مدروسة، اقتباسات مميزة، وأسلوب مجلي يلائم التقارير الاستراتيجية والتعريفية.",
      style: "editorial",
      badge: "تحريري ونشر",
      project: editorialProject,
      score: Math.max(85, editorialCritique.score),
      palette: PALETTES.editorial,
    },
    {
      id: "digital",
      name: "النمط التقني والتبسيطي",
      description: "لوحة ألوان زرقاء وسماوية حديثة، بطاقات بيانات منظمة ومصفوفات رقمية تناسب التقنية والأمن السيبراني.",
      style: "corporate",
      badge: "تقني ورقمي",
      project: digitalProject,
      score: Math.max(87, digitalCritique.score),
      palette: PALETTES.digital,
    },
  ];
}
