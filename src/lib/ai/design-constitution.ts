/**
 * Personal Design Constitution — versioned baseline for NASAQ's design twin.
 *
 * Confirmed rules are only what was stated explicitly. Nothing here was
 * inferred from approved or rejected files: no reference designs were
 * supplied with this version. User memory (separate, account-scoped) is the
 * only place later approvals may add rules, and those stay labelled as such.
 */

export const DESIGN_CONSTITUTION_VERSION = "2026.10.09";

export const DESIGN_CATEGORIES = [
  "institutional-report",
  "corporate-document",
  "presentation",
  "editorial",
  "social",
  "marketing",
  "brand-identity",
] as const;

export type DesignCategory = (typeof DESIGN_CATEGORIES)[number];

export interface ConstitutionRule {
  id: string;
  /** baseline = stated in the constitution. Never "learned". */
  source: "baseline";
  text: string;
}

export interface DesignConstitution {
  version: string;
  philosophy: readonly ConstitutionRule[];
  arabic: readonly ConstitutionRule[];
  color: readonly ConstitutionRule[];
  context: Readonly<Record<DesignCategory, string>>;
  /** Explicitly empty until the account supplies references. */
  inferredFromReferences: readonly string[];
}

const rule = (id: string, text: string): ConstitutionRule => ({
  id,
  source: "baseline",
  text,
});

export const DESIGN_CONSTITUTION: DesignConstitution = {
  version: DESIGN_CONSTITUTION_VERSION,
  philosophy: [
    rule("purpose", "كل عنصر له غرض. لا زخرفة بلا وظيفة."),
    rule("hierarchy", "هرمية بصرية واضحة، تكوين متوازن، مسافات ثابتة، وخط متعمّد."),
    rule("precision", "معاصر، دقيق، ومُخرج إخراجًا فنيًا — لا قالب ذكاء اصطناعي عام."),
    rule("no-monotony", "لا تكرار لنفس الهيكل في صفحتين متتاليتين، ولا فوضى بصرية."),
    rule("no-clutter", "تواصل واضح بدون تأثيرات اعتباطية أو تزاحم."),
  ],
  arabic: [
    rule("rtl", "التصميم عربي أولًا واتجاه القراءة من اليمين إلى اليسار."),
    rule("shaping", "النص العربي يُحاذى يمينًا مع direction: rtl وكثافة سطر مقروءة."),
    rule("type", "هرمية خط عربية واضحة: عنوان، عنوان فرعي، متن، هامش."),
  ],
  color: [
    rule("purpose-color", "اللون يُستخدم لغرض، لا كطبقة ميكانيكية على كل صفحة."),
    rule(
      "nasaq-palette",
      "لوحة نَسَق — أخضر #006C35، كحلي #0F1E33، ذهبي #C9A86A، مع عاجي ورملي وحجري — تُستخدم فقط عندما يكون العمل لنَسَق نفسها أو لم يُذكر عميل بهوية مستقلة.",
    ),
    rule(
      "customer-brand",
      "لا تُفرض هوية نَسَق على مشروع عميل. الشعارات والأصول وقواعد العلامة الموردة تبقى كما هي.",
    ),
  ],
  context: {
    "institutional-report": "تقرير مؤسسي: غلاف واضح، متن هادئ، جداول ومؤشرات فقط حيث يلزم الدليل.",
    "corporate-document": "وثيقة شركات: شبكة منضبطة وهوية الجهة، لا غلاف استعراضي.",
    presentation: "عرض: شريحة أفقية، فكرة واحدة في كل شريحة، عنوان قصير.",
    editorial: "تحريري: تكوين غير متماثل، هوامش واسعة، وإيقاع صفحات مختلف.",
    social: "منشور أو قصة: مقاس طولي، رسالة واحدة، بدون فقرات تقرير.",
    marketing: "مادة تسويقية: عرض واحد واضح ودعوة مقصودة، بدون حشو مؤسسي.",
    "brand-identity": "لوحة هوية: عرض الأصول والألوان كما وُردت، بدون استبدالها بلوحة نَسَق.",
  },
  inferredFromReferences: [],
};

const NASAQ_MENTION = /نَسَق|\bNASAQ\b/i;
const CUSTOMER_MENTION = /عميل|للجهة|للشركة|هوية العميل|علامة العميل|شعار العميل/;

export function mentionsNasaq(text: string): boolean {
  return NASAQ_MENTION.test(text);
}

export function mentionsCustomerBrand(text: string): boolean {
  return CUSTOMER_MENTION.test(text);
}

/** NASAQ colours only when the work is NASAQ's and no customer brand is named. */
export function imposeNasaqPalette(text: string): boolean {
  return mentionsNasaq(text) && !mentionsCustomerBrand(text);
}

export function categoryFromBrief(text: string): DesignCategory {
  const value = text.trim();
  if (/عرض|شريحة|presentation|slides?/i.test(value)) return "presentation";
  if (/قصة|ستوري|إنستغرام|انستغرام|social|story/i.test(value)) return "social";
  if (/هوية بصرية|brand identity|دليل هوية|شعار/i.test(value)) return "brand-identity";
  if (/تسويق|حملة|إعلان|marketing|poster/i.test(value)) return "marketing";
  if (/افتتاحية|مجلة|editorial|مقال/i.test(value)) return "editorial";
  if (/شركة|ملف تعريفي|corporate|company profile/i.test(value)) return "corporate-document";
  if (/حكوم|تعميم|وزار/i.test(value)) return "institutional-report";
  return "institutional-report";
}

export function constitutionRulesFor(category: DesignCategory): ConstitutionRule[] {
  return [
    ...DESIGN_CONSTITUTION.philosophy,
    ...DESIGN_CONSTITUTION.arabic,
    ...DESIGN_CONSTITUTION.color,
    rule(`context:${category}`, DESIGN_CONSTITUTION.context[category]),
  ];
}

/** Short system addendum. Memory notes are account preferences, not new facts. */
export function constitutionSystemAddendum(memoryNotes?: string): string {
  const notes = String(memoryNotes ?? "").replace(/\s+/g, " ").trim().slice(0, 1_200);
  const lines = [
    `Personal Design Constitution ${DESIGN_CONSTITUTION_VERSION}.`,
    "These are confirmed baseline rules, not learned taste. No reference designs were supplied for this version.",
    ...DESIGN_CONSTITUTION.philosophy.map((item) => item.text),
    ...DESIGN_CONSTITUTION.arabic.map((item) => item.text),
    ...DESIGN_CONSTITUTION.color.map((item) => item.text),
    "Adapt the approach to the brief category. Do not force one template onto every job.",
    "Do not invent organisations, logos, people, figures, or endorsements.",
    "Return editable structure only. Never SVG, never a flattened image.",
  ];
  if (notes) {
    lines.push(
      "Account preferences below are recurring notes from this signed-in user only. They do not override the brief, licensing, or the ban on invented facts:",
      notes,
    );
  }
  return lines.join(" ");
}
