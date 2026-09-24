/**
 * Single source of truth for the platform identity.
 *
 * The platform speaks institutionally: `owner` / `developer` carry the team
 * identity that appears in public copy and in exported document metadata, never
 * an individual's name. Pick the phrasing per context — `team` for authorship
 * ("فريق نَسَق"), `administration` where the platform itself is the actor, and
 * `workTeam` for a generic crew.
 *
 * The phone number is an institutional contact channel: it is rendered only
 * where a visitor is actively looking for the platform (contact page, about
 * page, footer, contact button) — never scattered through the app chrome.
 */

export const BRAND = {
  owner: "فريق نَسَق",
  developer: "فريق نَسَق",
  developerEn: "NASAQ Team",
  /** Institutional actors — use per context instead of a personal name. */
  team: "فريق نَسَق",
  administration: "إدارة نَسَق",
  workTeam: "فريق العمل",
  platform: "نَسَق",
  platformEn: "NASAQ",
  name: "نَسَق",
  nameAr: "نَسَق",
  tagline: "منصة التصميم والتحرير المؤسسي",
  short: "نَسَق",
  lockup: "نَسَق",
  description:
    "منصة احترافية لتصميم التقارير والمستندات والعروض المؤسسية بصيغ قابلة للتحرير.",
} as const;

/** Local display form: what the owner hands out inside Saudi Arabia. */
export const CONTACT_PHONE_DISPLAY = "+966 55 201 7111";

/** International form used in tel: and wa.me links. */
export const CONTACT_PHONE_INTL = "966552017111";

export function telHref() {
  return `tel:+${CONTACT_PHONE_INTL}`;
}

export function whatsappHref(message?: string) {
  const text = message ?? `السلام عليكم، أرغب بالاستفسار عن تصميم تقرير عبر ${BRAND.platform}.`;
  return `https://wa.me/${CONTACT_PHONE_INTL}?text=${encodeURIComponent(text)}`;
}

export interface NavItem {
  to: string;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "الرئيسية" },
  { to: "/projects", label: "المشاريع" },
  { to: "/templates", label: "القوالب" },
  { to: "/purchase", label: "النسخ والتراخيص" },
  { to: "/custom-design", label: "طلب تصميم خاص" },
  { to: "/الهوية", label: "الهوية" },
  { to: "/about", label: "عن المنصة" },
  { to: "/contact", label: "التواصل" },
  { to: "/account", label: "حسابي" },
];

/**
 * «طلب تصميم خاص» — institutional request surface.
 *
 * Two things are deliberately reserved, not invented:
 *   • `logoSlotLabel` / `logoSlotHint` — the artwork slot for the requesting
 *     entity's own logo. The platform mark is only a placeholder frame until the
 *     real logo is supplied.
 *   • `channelPlaceholder` — the direct contact channel for these requests is
 *     added later from one place (`site_settings.commercial` in the admin
 *     dashboard); until then the page says so instead of showing a made-up
 *     number.
 */
export const CUSTOM_DESIGN = {
  title: "طلب تصميم خاص",
  subtitle:
    "مسار مؤسسي مخصّص لمن يحتاج تقريراً أو هوية بصرية أو منظومة مخرجات كاملة تُبنى على مقاس جهته.",
  logoSlotLabel: "مساحة الشعار",
  logoSlotHint: "تُحفظ هذه المساحة لشعار الجهة، ويوضع الشعار هنا بعد اعتماد الطلب.",
  channelPlaceholder: "قناة التواصل المباشر لطلبات التصميم — قيد التجهيز",
  channelHint:
    "لا يُعرض هنا رقم غير معتمد. إلى أن تُفعّل القناة الرسمية يمكنك إرسال الطلب من صفحة التواصل وسيصل إلى إدارة نَسَق.",
  turnaround: "الرد المبدئي من إدارة نَسَق خلال يوم عمل واحد.",
  scopes: [
    { id: "report", label: "تقرير مؤسسي كامل", hint: "غلاف، فصول، جداول، مؤشرات، وتصدير طباعي." },
    { id: "identity", label: "هوية مخرجات", hint: "ألوان وخطوط ورأس وتذييل موحّد لمستندات الجهة." },
    { id: "presentation", label: "عرض تنفيذي", hint: "شرائح 16:9 بترتيب مؤسسي جاهز للعرض." },
    { id: "template", label: "قالب مخصص للمنصة", hint: "قالب يُضاف إلى كتالوج المنصة ويُستخدم من فريقك." },
  ],
} as const;