import type { DesignFormat, DesignStyle, PaletteRoles } from "./schema";
import { referenceAnalyses } from "./pipeline";
import { paletteForStyle } from "./dna";

export interface StudioVisualReference {
  id: string;
  title: string;
  category: string;
  style: DesignStyle;
  format: DesignFormat;
  pages: number;
  approved: boolean;
  palette: PaletteRoles;
  tags: string[];
  dimensions: { w: number; h: number };
  components: string[];
  description: string;
  internalSource?: {
    kind: "pdf" | "psd" | "nasaq";
    identifier: string;
    bytes?: number;
  };
  thumbnail?: string;
  updatedAt: number;
}

export interface StudioGenerationSettings {
  enabledSources: {
    referenceCorpus: boolean;
    nativeTemplates: boolean;
    psdImports: boolean;
    institutionalBackgrounds: boolean;
  };
  activeStyles: DesignStyle[];
  qualityThreshold: number; // minimum score e.g. 85
  enforceArabicRTL: boolean;
  updatedAt: number;
}

export const REFERENCE_CATEGORIES = [
  { id: "all", label: "كافة المراجع" },
  { id: "reports", label: "تقارير سنوية ورسمية" },
  { id: "presentations", label: "عروض قيادية" },
  { id: "profiles", label: "ملفات تعريفية" },
  { id: "contracts", label: "مزادات وعقود" },
  { id: "infographics", label: "إنفوجرافيك وبيانات" },
] as const;

export const DEFAULT_STUDIO_SETTINGS: StudioGenerationSettings = {
  enabledSources: {
    referenceCorpus: true,
    nativeTemplates: true,
    psdImports: true,
    institutionalBackgrounds: true,
  },
  activeStyles: [
    "institutional",
    "government",
    "corporate",
    "executive",
    "editorial",
    "presentation",
    "report",
    "infographic",
    "auction",
  ],
  qualityThreshold: 85,
  enforceArabicRTL: true,
  updatedAt: Date.now(),
};

/**
 * Builds clean, curated visual references from internal knowledge.
 * Raw file names are kept purely in internalSource.identifier, never in title or user copy!
 */
export function defaultCuratedReferences(): StudioVisualReference[] {
  const analyses = referenceAnalyses();

  // Curated naming map for the 18 measured corpus references
  const curatedTitles: Record<string, { title: string; category: string; desc: string }> = {
    "ref-01": {
      title: "دليل مزاد أرض الخبر وشروط المشاركة",
      category: "contracts",
      desc: "وثيقة شروط رسمية بقياس رأسي متزن ولوحة ألوان فيروزية وذهبية مؤسسية.",
    },
    "ref-02": {
      title: "الإطار الاستراتيجي لتقارير الأداء الحكومي",
      category: "reports",
      desc: "هيكل تقرير متعدد الصفحات بتوزيع منتظم للهوامش والترويسات والتذييل.",
    },
    "ref-03": {
      title: "دليل الهوية والمعايير المؤسسية",
      category: "profiles",
      desc: "مستند تعريفي منظم بهرمية بصرية واضحة للعناوين والمتون.",
    },
    "ref-04": {
      title: "عرض مؤشرات الإنجاز والتحول الرقمي",
      category: "presentations",
      desc: "عرض أفقي 16:9 مخصص للشرائح القيادية ولوحات البيانات.",
    },
    "ref-05": {
      title: "تقرير الحوكمة والامتثال الرقابي",
      category: "reports",
      desc: "تقرير رسمي يتضمن جداول قياسية متزنة وهوامش آمنة للطباعة.",
    },
    "ref-06": {
      title: "الملف التعريفي للخدمات الاستشارية",
      category: "profiles",
      desc: "تصميم بروفايل عصري يركز على ركائز الخدمة والمؤشرات الرقمية.",
    },
  };

  return analyses.map((analysis, index) => {
    const curated = curatedTitles[analysis.id] || {
      title: analysis.title && !analysis.title.endsWith(".pdf")
        ? analysis.title
        : `مرجع تصميم مؤسسي معتمد ${index + 1}`,
      category:
        analysis.document.format === "wide-slide"
          ? "presentations"
          : analysis.document.pages > 5
            ? "reports"
            : "profiles",
      desc: "مرجع تصميم مقيس من الهوية المؤسسية المعتمدة.",
    };

    const style: DesignStyle =
      analysis.document.format === "wide-slide"
        ? "presentation"
        : index % 2 === 0
          ? "institutional"
          : "corporate";

    return {
      id: analysis.id,
      title: curated.title,
      category: curated.category,
      style,
      format: analysis.document.format,
      pages: analysis.document.pages,
      approved: true,
      palette: analysis.palette || paletteForStyle(style),
      tags: ["معتمد", "هوية مؤسسية", analysis.document.format],
      dimensions: {
        w: analysis.document.primary.w,
        h: analysis.document.primary.h,
      },
      components: analysis.components || ["cover", "title-block", "footer"],
      description: curated.desc,
      internalSource: {
        kind: "pdf",
        identifier: `ref-${String(index + 1).padStart(2, "0")}`,
        bytes: analysis.source.bytes,
      },
      updatedAt: Date.now(),
    };
  });
}
