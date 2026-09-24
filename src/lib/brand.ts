/**
 * Single source of truth for the platform identity.
 *
 * The phone number is a personal contact detail: it is rendered only where a
 * visitor is actively looking for the owner (contact page, about page, footer,
 * contact button) — never scattered through the app chrome.
 */

export const BRAND = {
  owner: "إدارة المنصة",
  developer: "فريق تطوير نَسَق",
  developerEn: "NASAQ Development Team",
  platform: "نَسَق",
  platformEn: "NASAQ",
  name: "نَسَق",
  nameAr: "نَسَق",
  tagline: "منصة التصميم والتحرير المؤسسي",
  short: "نَسَق",
  lockup: "نَسَق",
  description:
    "منصة احترافية لتصميم التقارير والمستندات والعروض المؤسسية بصيغ قابلة للتحرير — من تطوير فريق نَسَق.",
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

/** Custom design request contact info (used only in the dedicated section). */
export const CUSTOM_DESIGN_CONTACT = {
  phone: CONTACT_PHONE_DISPLAY,
  phoneIntl: CONTACT_PHONE_INTL,
  logoPlaceholder: "/custom-logo-placeholder.svg",
} as const;

export interface NavItem {
  to: string;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "الرئيسية" },
  { to: "/projects", label: "المشاريع" },
  { to: "/templates", label: "القوالب" },
  { to: "/purchase", label: "النسخ والتراخيص" },
  { to: "/الهوية", label: "الهوية" },
  { to: "/about", label: "عن المنصة" },
  { to: "/contact", label: "التواصل" },
  { to: "/account", label: "حسابي" },
  { to: "/custom-design", label: "طلب تصميم خاص" },
];