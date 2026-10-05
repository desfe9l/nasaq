import type { DesignFormat, DesignStyle, PaletteRoles } from "./schema";
import { paletteForStyle } from "./dna";

export interface PromptAnalysis {
  rawPrompt: string;
  docType:
    | "official_report"
    | "annual_report"
    | "cover"
    | "presentation"
    | "company_profile"
    | "executive_summary"
    | "infographic"
    | "minutes"
    | "plan"
    | "certificate"
    | "letterhead";
  docTypeLabel: string;
  topic: string;
  title: string;
  subtitle: string;
  org: string;
  style: DesignStyle;
  styleLabel: string;
  coverStyle:
    | "minimal"
    | "editorial"
    | "premium"
    | "gradient"
    | "wave"
    | "geometric"
    | "image-led"
    | "executive"
    | "formal"
    | "legal"
    | "media"
    | "annual-report";
  generationMode: "generate" | "balance" | "professional";
  contentDensity: "light" | "balanced" | "dense";
  bilingual: boolean;
  visualDirection: string;
  pages: number;
  format: DesignFormat;
  orientation: "portrait" | "landscape";
  dimensions: { w: number; h: number };
  palette: PaletteRoles;
  classification: string;
  dateString: string;
  keyMetrics: Array<{ value: string; label: string; trend?: string }>;
  frameworkPillars: Array<{ title: string; desc: string }>;
  tableData: {
    headers: string[];
    rows: string[][];
  };
  summaryTakeaways: string[];
  recommendations: string[];
}

const STYLE_LABELS: Record<DesignStyle, string> = {
  institutional: "مؤسسي سيادي",
  government: "حكومي رسمي",
  corporate: "شركات وأعمال",
  executive: "تنفيذي قيادي",
  editorial: "تحريري معاصر",
  presentation: "عرض مرئي",
  report: "تقرير شامل",
  infographic: "بيانات وإنفوجرافيك",
  auction: "مزادات واستثمار",
};

// Specialized palettes tailored to topics
const CYBER_PALETTE: PaletteRoles = {
  field: "#0a2239",
  paper: "#f7f9fb",
  ink: "#0c1b2c",
  accent: "#00a3c4",
  muted: "#5a6b7c",
  onField: "#f7f9fb",
};

const ENERGY_PALETTE: PaletteRoles = {
  field: "#133e2c",
  paper: "#f8f9f6",
  ink: "#14241c",
  accent: "#48bb78",
  muted: "#5c6b63",
  onField: "#f8f9f6",
};

const HEALTH_PALETTE: PaletteRoles = {
  field: "#0e4c5a",
  paper: "#f4f8f8",
  ink: "#11262d",
  accent: "#38bdf8",
  muted: "#556e75",
  onField: "#f4f8f8",
};

const ROYAL_PALETTE: PaletteRoles = {
  field: "#0c3d2c",
  paper: "#faf8f4",
  ink: "#17231c",
  accent: "#c6a05a",
  muted: "#5c6660",
  onField: "#faf8f4",
};

const CORPORATE_BLUE: PaletteRoles = {
  field: "#071d3d",
  paper: "#f7f8fb",
  ink: "#172033",
  accent: "#c6a05a",
  muted: "#5c6570",
  onField: "#f7f8fb",
};

export function parsePrompt(prompt: string): PromptAnalysis {
  const clean = prompt.trim();
  const lower = clean.toLowerCase();

  // 1. Detect page count
  let pages = 0;
  const pageMatch = clean.match(/(?:من\s+)?(\d+)\s*صفح/i);
  if (pageMatch) {
    pages = Number.parseInt(pageMatch[1], 10);
  } else if (/صفحت(?:ين|ان)/i.test(clean)) {
    pages = 2;
  } else if (/ثلاث(?:ة)?\s*صفح/i.test(clean)) {
    pages = 3;
  } else if (/أربع(?:ة)?\s*صفح/i.test(clean)) {
    pages = 4;
  } else if (/خمس(?:ة)?\s*صفح/i.test(clean)) {
    pages = 5;
  } else if (/ست(?:ة)?\s*صفح/i.test(clean)) {
    pages = 6;
  } else if (/سبع(?:ة)?\s*صفح/i.test(clean)) {
    pages = 7;
  } else if (/ثمان(?:ي|ية)?\s*صفح/i.test(clean)) {
    pages = 8;
  } else if (/عشر(?:ة)?\s*صفح/i.test(clean)) {
    pages = 10;
  } else if (/اثنتا?\s*عشر(?:ة)?\s*صفح/i.test(clean)) {
    pages = 12;
  } else if (/صفحة\s*واحدة|صفحة\s*فردية/i.test(clean)) {
    pages = 1;
  }

  // 2. Detect Document Type
  let docType: PromptAnalysis["docType"] = "official_report";
  let docTypeLabel = "تقرير رسمي";

  if (/غلاف|صفحة\s*أولى|واجهة/i.test(clean) && !/تقرير\s+من\s+\d+/i.test(clean)) {
    docType = "cover";
    docTypeLabel = "غلاف تقرير";
    if (pages === 0) pages = 1;
  } else if (/عرض|سلايد|شرائح|برزنتيشن|تقديمي|قيادي/i.test(clean)) {
    docType = "presentation";
    docTypeLabel = "عرض تقديمي قيادي";
    if (pages === 0) pages = 6;
  } else if (/تقرير\s*سنوي/i.test(clean)) {
    docType = "annual_report";
    docTypeLabel = "تقرير سنوي";
    if (pages === 0) pages = 6;
  } else if (/تعريفي|بروفايل|نبذة|صفحة\s*تعريفية|ملف\s*شركة/i.test(clean)) {
    docType = "company_profile";
    docTypeLabel = "ملف تعريفي بالشركة";
    if (pages === 0) pages = 2;
  } else if (/ملخص\s*تنفيذي|موجز/i.test(clean)) {
    docType = "executive_summary";
    docTypeLabel = "ملخص تنفيذي";
    if (pages === 0) pages = 2;
  } else if (/محضر|اجتماع/i.test(clean)) {
    docType = "minutes";
    docTypeLabel = "محضر اجتماع";
    if (pages === 0) pages = 2;
  } else if (/خطة\s*عمل|خطة\s*تشغيل|استراتيجية/i.test(clean)) {
    docType = "plan";
    docTypeLabel = "خطة تشغيلية";
    if (pages === 0) pages = 4;
  } else if (/إنفوجرافيك|رسم\s*بياني/i.test(clean)) {
    docType = "infographic";
    docTypeLabel = "إنفوجرافيك";
    if (pages === 0) pages = 1;
  } else if (/شهادة|شكر|تقدير/i.test(clean)) {
    docType = "certificate";
    docTypeLabel = "شهادة تقدير";
    if (pages === 0) pages = 1;
  } else if (/خطاب|مراسلة/i.test(clean)) {
    docType = "letterhead";
    docTypeLabel = "خطاب رسمي";
    if (pages === 0) pages = 1;
  } else {
    // Default official report
    if (pages === 0) pages = 4;
  }

  // Cap pages between 1 and 12
  pages = Math.min(12, Math.max(1, pages));

  // 3. Format and orientation
  let format: DesignFormat = "a4-book";
  let orientation: "portrait" | "landscape" = "portrait";
  let dimensions = { w: 210, h: 297 };

  if (docType === "presentation") {
    format = "wide-slide";
    orientation = "landscape";
    dimensions = { w: 338.7, h: 190.5 };
  } else if (docType === "certificate") {
    format = "a4-book";
    orientation = "landscape";
    dimensions = { w: 297, h: 210 };
  } else if (docType === "infographic" && pages === 1) {
    format = "tall-story";
    orientation = "portrait";
    dimensions = { w: 210, h: 560 };
  }

  // 4. Style & Topic Detection
  let style: DesignStyle = "institutional";
  let palette: PaletteRoles = ROYAL_PALETTE;
  let topic = "الأداء المؤسسي والاستراتيجي";
  let title = "التقرير الرسمي للأداء المؤسسي";
  let subtitle = "رصد النتائج الاستراتيجية ومؤشرات الإنجاز المعتمدة";
  let org = "الجهة المختصة";
  let classification = "وثيقة رسمية - للاستخدام الداخلي";
  let coverStyle: PromptAnalysis["coverStyle"] = "formal";
  const generationMode: PromptAnalysis["generationMode"] = /توازن|متوازن/i.test(clean)
    ? "balance"
    : /توليد|إبداعي|إبداع/i.test(clean)
      ? "generate"
      : "professional";
  const contentDensity: PromptAnalysis["contentDensity"] = /مكثف|كثيف|تفصيلي/i.test(clean)
    ? "dense"
    : /موجز|خفيف|minimal/i.test(clean)
      ? "light"
      : "balanced";
  const bilingual = /ثنائي|لغتين|عربي.*إنجليزي|إنجليزي.*عربي/i.test(clean);
  let visualDirection = "تكوين عربي RTL مؤسسي بهرمية قوية ومساحات بيضاء مقصودة";

  // Check organization in prompt
  const orgMatch = clean.match(/(?:لـ|لجهة|لشركة|لهيئة|لمؤسسة|لمركز|لوزارة|لمكتب)\s+([^،.\n]+)/i);
  if (orgMatch) {
    org = orgMatch[1].trim();
  }

  // Topic matching with flexible Arabic prefixes (الـ، بـ، كـ، للـ)
  if (/(?:ال)?(?:أمن|أمان)\s*(?:ال)?(?:سيبران|رقمي)|حماية\s*(?:ال)?بيانات|اختراق|تقنية\s*(?:ال)?معلومات|شبكات|سيبران/i.test(clean)) {
    topic = "الأمن السيبراني";
    style = "corporate";
    palette = CYBER_PALETTE;
    if (docType === "cover") {
      title = "تقرير الأمن السيبراني والجاهزية الرقمية";
      subtitle = "تقييم الامتثال لضوابط الهيئة الوطنية وإدارة المخاطر والتهديدات";
    } else if (docType === "presentation") {
      title = "استراتيجية الأمن السيبراني والصمود الرقمي";
      subtitle = "العرض القيادي لمستوى النضج السيبراني وحماية الأصول السحابية";
    } else {
      title = "التقرير الاستراتيجي للأمن السيبراني";
      subtitle = "ملخص الامتثال للضوابط الأساسية والجاهزية ضد التهديدات المتقدمة";
    }
    if (!orgMatch) org = "الإدارة العامة للأمن السيبراني";
    classification = "وثيقة رسمية - سري للغاية";
    coverStyle = "gradient";
    visualDirection = "شبكة تقنية دقيقة فوق تدرج عميق مع صورة معالجة وطبقات ضوء";
  } else if (/(?:ال)?سنوي|إنجازات|حصاد|تقرير\s*(?:ال)?سنوي/i.test(clean)) {
    topic = "التقرير السنوي";
    style = "government";
    palette = ROYAL_PALETTE;
    title = "التقرير السنوي للإنجازات والتميز المؤسسي";
    subtitle = "استعراض مستهدفات الأداء والمشاريع المنجزة والأثر المحقق";
    if (!orgMatch) org = "الهيئة الوطنية للتطوير المؤسسي";
    classification = "تقرير سنوي منشور - معتمد";
    coverStyle = "annual-report";
  } else if (/(?:ال)?شرك(?:ة|ات)|ملف\s*تعريفي|بروفايل|أعمال/i.test(clean)) {
    topic = "ملف الشركة التعريفي";
    style = "corporate";
    palette = CORPORATE_BLUE;
    title = "الملف التعريفي للشركة وحلول الأعمال";
    subtitle = "رؤيتنا، خدماتنا المتقدمة، وقصص النجاح في تمكين الشركاء";
    if (!orgMatch) org = "شركة نَسَق للاستشارات والحلول المتقدمة";
    classification = "ملف تعريفي رسمي للشركاء";
    coverStyle = "image-led";
  } else if (/طاقة|بيئة|استدامة|شمسية|خضراء/i.test(clean)) {
    topic = "الاستدامة والطاقة المتجددة";
    style = "institutional";
    palette = ENERGY_PALETTE;
    title = "تقرير الاستدامة ومبادرات الطاقة المتجددة";
    subtitle = "خفض الانبعاثات وتحقيق كفاءة الطاقة والتحول الأخضر المستدام";
    if (!orgMatch) org = "مركز كفاءة الطاقة والمبادرات الخضراء";
    classification = "وثيقة التميز البيئي والاستدامة";
    coverStyle = "wave";
  } else if (/صحة|طبي|رعاية|مستشفى/i.test(clean)) {
    topic = "الرعاية الصحية والتحول الصحي";
    style = "institutional";
    palette = HEALTH_PALETTE;
    title = "تقرير جودة الرعاية والتحول الصحي";
    subtitle = "تطوير منظومة الخدمات الطبية وتجربة المريض وسلامة الرعاية";
    if (!orgMatch) org = "التجمع الصحي وإدارة الرعاية المتقدمة";
    classification = "وثيقة الجودة والاعتماد الصحي";
    coverStyle = "media";
  } else if (/مالي|استثمار|ميزانية|أرباح|أسهم/i.test(clean)) {
    topic = "التقرير المالي والاستثماري";
    style = "executive";
    palette = CORPORATE_BLUE;
    title = "تقرير الأداء المالي والفرص الاستثمارية";
    subtitle = "مؤشرات الربحية، التدفقات النقدية، ومحفظة المشاريع الرأسمالية";
    if (!orgMatch) org = "إدارة الاستثمار والشؤون المالية";
    classification = "تقرير مالي دوري - تنفيذي";
  } else if (/حكومي|وزارة|هيئة|بلد/i.test(clean)) {
    topic = "الشؤون الحكومية والسياسات";
    style = "government";
    palette = ROYAL_PALETTE;
    title = "تقرير الحوكمة والامتثال للسياسات العامة";
    subtitle = "متابعة مسارات التحول الوطني وتكامل الخدمات الحكومية";
    if (!orgMatch) org = "الجهة الحكومية المختصة";
    classification = "وثيقة حكومية رسمية";
  } else if (/قيادي|إدارة\s*عليا|مجلس\s*إدارة/i.test(clean)) {
    topic = "العرض القيادي الاستراتيجي";
    style = "executive";
    palette = ROYAL_PALETTE;
    title = "العرض القيادي للقرارات الاستراتيجية";
    subtitle = "محاور التوجه المستقبلي ومصفوفة الأولويات التنفيذية للمجلس";
    if (!orgMatch) org = "الأمانة العامة لمجلس الإدارة";
    classification = "لأعضاء المجلس فقط - سري";
  }

  // Adjust style label
  const styleLabel = STYLE_LABELS[style] || "مؤسسي سيادي";

  // Dynamic rich topic content
  const keyMetrics =
    topic === "الأمن السيبراني"
      ? [
          { value: "99.8%", label: "معدل الجاهزية والحماية", trend: "+2.4% عن الربع السابق" },
          { value: "٠", label: "حوادث أمنية حرجة", trend: "حماية كاملة للأصول" },
          { value: "< 8 د", label: "متوسط زمن الاستجابة", trend: "انخفاض بنسبة 40%" },
          { value: "100%", label: "الامتثال للضوابط الأساسية", trend: "مطابقة تامة لـ ECC" },
        ]
      : topic === "ملف الشركة التعريفي"
        ? [
            { value: "+١٥", label: "عامًا من الخبرة والريادة", trend: "سجل أعمال موثوق" },
            { value: "٢٥٠+", label: "مشروع منجز بنجاح", trend: "في مختلف القطاعات" },
            { value: "٩٨٫٥٪", label: "معدل رضا العملاء والشركاء", trend: "وفق قياس مستقل" },
            { value: "+٥٠", label: "خبير ومستشار معتمد", trend: "كفاءات وطنية متخصصة" },
          ]
        : topic === "الاستدامة والطاقة المتجددة"
          ? [
              { value: "35%", label: "خفض البصمة الكربونية", trend: "تجاوز المستهدف بـ 5%" },
              { value: "1.2 GW", label: "طاقة نظيفة مولدة", trend: "نمو سنوي بنسبة 28%" },
              { value: "85%", label: "إعادة تدوير الموارد", trend: "كفاءة تدوير نموذجية" },
              { value: "42M", label: "وفر في التكاليف التشغيلية", trend: "ريال سنوياً" },
            ]
          : [
              { value: "94.6%", label: "معدل الإنجاز الاستراتيجي", trend: "+6.8% نمو مستهدف" },
              { value: "٤٨+", label: "مبادرة وطنية منجزة", trend: "وفق الجدول الزمني" },
              { value: "٩٧٫٢٪", label: "مؤشر الرضا العام", trend: "أعلى تقييم ربع سنوي" },
              { value: "٢٫٤ مليار", label: "الأثر المالي والاقتصادي", trend: "ريال سعودي" },
            ];

  const frameworkPillars =
    topic === "الأمن السيبراني"
      ? [
          {
            title: "الحوكمة وإدارة المخاطر",
            desc: "تطبيق السياسات الأمنية ومواءمة الضوابط التنظيمية مع معايير الهيئة الوطنية.",
          },
          {
            title: "الصمود والحماية الاستباقية",
            desc: "أنظمة مراقبة متقدمة على مدار الساعة للكشف الفوري والتصدي للتهديدات.",
          },
          {
            title: "بناء القدرات والوعي البشري",
            desc: "برامج تدريبية متخصصة ومحاكاة دورية لرفع الجاهزية السيبرانية للموظفين.",
          },
        ]
      : topic === "ملف الشركة التعريفي"
        ? [
            {
              title: "الاستشارات والحلول المخصصة",
              desc: "تصميم وتنفيذ استراتيجيات أعمال دقيقة تضمن تحقيق أهداف العميل بكفاءة.",
            },
            {
              title: "الابتكار والتحول الرقمي",
              desc: "توظيف أحدث الحلول السحابية وتقنيات الذكاء الاصطناعي لرفع الإنتاجية.",
            },
            {
              title: "إدارة المشاريع والتميز التشغيلي",
              desc: "متابعة مؤشرات الأداء وضمان تسليم المخرجات وفق أعلى معايير الجودة العالمية.",
            },
          ]
        : [
            {
              title: "الكفاءة التشغيلية والتميز",
              desc: "تحسين الإجراءات الداخلية والتحول الرقمي الكامل للعمليات والخدمات.",
            },
            {
              title: "الشراكات والأثر المستدام",
              desc: "توسيع نطاق التعاون المؤسسي وبناء تحالفات استراتيجية تدعم النمو طويل الأمد.",
            },
            {
              title: "تمكين الكوادر والمعرفة",
              desc: "الاستثمار في رأس المال البشري واستقطاب المواهب المتخصصة لضمان الريادة.",
            },
          ];

  const tableData =
    topic === "الأمن السيبراني"
      ? {
          headers: ["المجال الأمني", "الضابط الأساسي", "نسبة الامتثال", "مستوى النضج"],
          rows: [
            ["حوكمة الأمن السيبراني", "السياسات والأدوار والمسؤوليات", "100%", "متقدم جداً"],
            ["تعزيز الأمن السيبراني", "حماية الشبكات والأنظمة السحابية", "98.5%", "متقدم"],
            ["صمود الأمن السيبراني", "إدارة الحوادث واستمرارية الأعمال", "99.0%", "متقدم جداً"],
            ["أمن الأطراف الخارجية", "تدقيق الموردين وسلاسل الإمداد", "96.8%", "مكتمل"],
          ],
        }
      : {
          headers: ["المحور الاستراتيجي", "المستهدف السنوي", "المحقق فعلياً", "الحالة التنفيذية"],
          rows: [
            ["التحول والابتكار الرقمي", "90%", "95.2%", "مكتمل بنجاح"],
            ["رفع جودة الخدمات وتجربة المستفيد", "85%", "89.4%", "تجاوز المستهدف"],
            ["كفاءة الإنفاق وترشيد الميزانية", "15% خفض", "18.3% خفض", "مكتمل بنجاح"],
            ["بناء الشراكات المؤسسية الفعالة", "12 شراكة", "16 شراكة", "مكتمل بنجاح"],
          ],
        };

  const summaryTakeaways = [
    "تحقيق نتائج تفوق المستهدفات المعتمدة بنسبة نمو سنوية ملحوظة.",
    "التوافق التام مع المعايير والسياسات التنظيمية والامتثال المؤسسي الشامل.",
    "كفاءة عالية في إدارة الموارد وتوجيه الاستثمارات نحو المشاريع ذات الأثر الأعلى.",
  ];

  const recommendations = [
    "الاستمرار في دعم مبادرات التحول الرقمي والتوسع في حلول الذكاء الاصطناعي.",
    "تعزيز منظومة قياس الأداء وتحديث لوحات البيانات اللحظية لصناع القرار.",
    "اعتماد خطة التوسع المستقبلية وتخصيص الميزانيات التقديرية للمرحلة التالية.",
  ];

  return {
    rawPrompt: clean,
    docType,
    docTypeLabel,
    topic,
    title,
    subtitle,
    org,
    style,
    styleLabel,
    coverStyle,
    generationMode,
    contentDensity,
    bilingual,
    visualDirection,
    pages,
    format,
    orientation,
    dimensions,
    palette,
    classification,
    dateString: "ربيع الآخر ١٤٤٨هـ · أكتوبر ٢٠٢٦م",
    keyMetrics,
    frameworkPillars,
    tableData,
    summaryTakeaways,
    recommendations,
  };
}
