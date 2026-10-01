import { CENTRAL_PLANS, planSavings } from "../commercial/catalog";
/**
 * NASAQ admin-managed content — shared (client + server) types and defaults.
 *
 * Everything here is data only. Persistence happens server-side
 * (`functions.ts` → Postgres/PGLite via `getSql`) and writes are gated by the
 * server-side owner authorization; the browser never decides who is an admin.
 */

export interface CommercialSettings {
  /** WhatsApp number in international form, digits only (e.g. 9665…). */
  whatsappNumber: string;
  /** Prefilled WhatsApp message for licence requests. */
  whatsappLicenseMessage: string;
  /** Prefilled WhatsApp message for institutional/enterprise requests. */
  whatsappEnterpriseMessage: string;
  /** Monthly list prices in SAR. */
  priceIndividualMonthly: number;
  priceTeamMonthly: number;
  /** Annual discount percentage applied on the pricing page. */
  annualDiscountPercent: number;
}

export interface Announcement {
  enabled: boolean;
  text: string;
  /** Optional link (relative path or https URL). */
  href: string;
  tone: "info" | "success" | "warning";
}

export interface SiteTexts {
  heroEyebrow: string;
  heroTitle: string;
  heroDescription: string;
  footerNote: string;
  /** ID of a published, free record in the Admin template catalog. */
  featuredTemplateId: string;
}

export interface BrandPreset {
  id: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  paperColor: string;
  textColor: string;
}

/**
 * Owner-managed site imagery.
 *
 * One slot per image the marketing pages and the editor walkthrough paint.
 * A slot holds either an `https:` URL or a `data:image/…;base64,` payload the
 * owner uploaded from the admin dashboard; an EMPTY string means "use the
 * bundled artwork shipped in `public/`". That fallback is what lets the owner
 * replace one image at a time without having to fill the whole set.
 *
 * The slots are deliberately dimension-free: the owner uploads whatever they
 * have and the surfaces render it with `object-contain` in a flexible box, so
 * a 4:3 screenshot and a 16:9 capture both fit the same card.
 */
export interface SiteImages {
  /** «واجهة المحرر» — the wide workspace capture on the home page. */
  workspace: string;
  /** «مستند مؤسسي داخل المحرر» — the document card. */
  document: string;
  /** «الصفحات وبنية المستند» — the pages / document-structure card. */
  pages: string;
  /** «أدوات التصميم والمكتبة» — the tools and library card. */
  tools: string;
}

/** Label, description and the bundled fallback for every image slot. */
export const SITE_IMAGE_SLOTS: ReadonlyArray<{
  id: keyof SiteImages;
  label: string;
  hint: string;
  /** Bundled artwork used when the owner has not uploaded a replacement. */
  fallback: string;
}> = [
  {
    id: "workspace",
    label: "واجهة المحرر (لقطة واسعة)",
    hint: "تظهر أعلى جولة المنتج في الصفحة الرئيسية — أي مقاس يتناسب تلقائيًا.",
    fallback: "/editor-previews/workspace.png",
  },
  {
    id: "document",
    label: "بطاقة المستند",
    hint: "صورة بطاقة «مستند مؤسسي داخل المحرر».",
    fallback: "/editor-previews/document.png",
  },
  {
    id: "pages",
    label: "بطاقة الصفحات وبنية المستند",
    hint: "صورة بطاقة «الصفحات وبنية المستند».",
    fallback: "/editor-previews/pages.png",
  },
  {
    id: "tools",
    label: "بطاقة الأدوات والمكتبة",
    hint: "صورة بطاقة «أدوات التصميم والمكتبة».",
    fallback: "/editor-previews/tools.png",
  },
] as const;

/** An empty slot: every surface falls back to the bundled artwork. */
export const DEFAULT_SITE_IMAGES: SiteImages = {
  workspace: "",
  document: "",
  pages: "",
  tools: "",
};

/** Largest accepted upload per slot, in bytes (before re-encoding). */
export const MAX_SITE_IMAGE_BYTES = 8 * 1024 * 1024;
/** Longest edge the browser re-encodes an upload to, in pixels. */
export const SITE_IMAGE_MAX_EDGE = 1800;

export interface PublicSiteSettings {
  commercial: CommercialSettings;
  announcement: Announcement;
  texts: SiteTexts;
  brandPresets: BrandPreset[];
  images: SiteImages;
}

export type SettingsSection = keyof PublicSiteSettings;

export const DEFAULT_SITE_SETTINGS: PublicSiteSettings = {
  commercial: {
    whatsappNumber: "966552017111",
    whatsappLicenseMessage: "السلام عليكم، أرغب بطلب ترخيص النسخة الكاملة من منصة نَسَق.",
    whatsappEnterpriseMessage: "السلام عليكم، أرغب بطلب ترخيص مؤسسي مخصص لمنصة نَسَق.",
    priceIndividualMonthly: CENTRAL_PLANS["individual-monthly"].amount,
    priceTeamMonthly: CENTRAL_PLANS["team-monthly"].amount,
    annualDiscountPercent: Math.round(planSavings(CENTRAL_PLANS["individual-annual"]) / (CENTRAL_PLANS["individual-monthly"].amount * 12) * 100),
  },
  announcement: { enabled: false, text: "", href: "", tone: "info" },
  texts: {
    heroEyebrow: "",
    heroTitle: "",
    heroDescription: "",
    footerNote: "",
    // Existing free Admin catalog record; the public preview resolves this ID
    // through the published catalog endpoint instead of a showcase preset.
    featuredTemplateId: "builtin_page_cover",
  },
  brandPresets: [],
  images: { ...DEFAULT_SITE_IMAGES },
};

export type TemplateTier = "free" | "licensed";
export type TemplateStatus = "draft" | "published" | "archived";
export type TemplateKind = "json" | "svg";

export interface AdminTemplateSummary {
  id: string;
  slug: string | null;
  title: string;
  description: string;
  category: string;
  tier: TemplateTier;
  status: TemplateStatus;
  kind: TemplateKind;
  thumbnail: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTemplate extends AdminTemplateSummary {
  content: string;
}

export interface AdminTemplateInput {
  id?: string;
  slug?: string | null;
  title: string;
  description?: string;
  category?: string;
  tier: TemplateTier;
  status: TemplateStatus;
  kind: TemplateKind;
  content: string;
  thumbnail?: string | null;
  sortOrder?: number;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function str(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function httpsOrEmpty(value: unknown): string {
  const s = str(value, 500).trim();
  if (!s) return "";
  try {
    return new URL(s).protocol === "https:" ? s : "";
  } catch {
    return "";
  }
}

function safeHref(value: unknown): string {
  const s = str(value, 500).trim();
  if (!s) return "";
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  return httpsOrEmpty(s);
}

/**
 * One owner-uploaded image.
 *
 * Accepts an `https:` URL or a `data:image/…;base64,` payload and rejects
 * everything else — a `javascript:` or `vbscript:` src in a marketing page is
 * an XSS hole, not a misconfiguration. `svg+xml` is refused on purpose: an SVG
 * is a document, and letting one be uploaded into a page-wide `<img>` slot
 * re-opens the whole script-injection surface the editor's own sanitiser
 * exists to close.
 */
export function siteImage(value: unknown): string {
  const s = str(value, MAX_SITE_IMAGE_BYTES).trim();
  if (!s) return "";
  if (/^data:image\/(png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/i.test(s))
    return s;
  return httpsOrEmpty(s);
}

function hex(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX.test(value) ? value : fallback;
}

/** Validate + coerce one settings section; unknown fields are dropped. */
export function normalizeSection<K extends SettingsSection>(key: K, raw: unknown): PublicSiteSettings[K] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SITE_SETTINGS;
  switch (key) {
    case "commercial": {
      const value: CommercialSettings = {
        whatsappNumber: str(r.whatsappNumber, 20, d.commercial.whatsappNumber).replace(/\D/g, "") || d.commercial.whatsappNumber,
        whatsappLicenseMessage: str(r.whatsappLicenseMessage, 500, d.commercial.whatsappLicenseMessage),
        whatsappEnterpriseMessage: str(r.whatsappEnterpriseMessage, 500, d.commercial.whatsappEnterpriseMessage),
        priceIndividualMonthly: d.commercial.priceIndividualMonthly,
        priceTeamMonthly: d.commercial.priceTeamMonthly,
        annualDiscountPercent: d.commercial.annualDiscountPercent,
      };
      return value as PublicSiteSettings[K];
    }
    case "announcement": {
      const tone = r.tone === "success" || r.tone === "warning" ? r.tone : "info";
      const value: Announcement = {
        enabled: r.enabled === true,
        text: str(r.text, 300),
        href: safeHref(r.href),
        tone,
      };
      return value as PublicSiteSettings[K];
    }
    case "texts": {
      const value: SiteTexts = {
        heroEyebrow: str(r.heroEyebrow, 120),
        heroTitle: str(r.heroTitle, 200),
        heroDescription: str(r.heroDescription, 600),
        footerNote: str(r.footerNote, 300),
        featuredTemplateId:
          typeof r.featuredTemplateId === "string"
            ? str(r.featuredTemplateId, 120).trim()
            : d.texts.featuredTemplateId,
      };
      return value as PublicSiteSettings[K];
    }
    case "images": {
      const value: SiteImages = { ...DEFAULT_SITE_IMAGES };
      for (const slot of SITE_IMAGE_SLOTS) {
        value[slot.id] = siteImage(r[slot.id]);
      }
      return value as PublicSiteSettings[K];
    }
    case "brandPresets": {
      const list = Array.isArray(raw) ? raw.slice(0, 24) : [];
      const value: BrandPreset[] = list
        .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
        .map((p, i) => ({
          id: str(p.id, 60) || `preset-${i + 1}`,
          name: str(p.name, 60) || `لوحة ${i + 1}`,
          primaryColor: hex(p.primaryColor, "#0c3d2c"),
          secondaryColor: hex(p.secondaryColor, "#145c42"),
          accentColor: hex(p.accentColor, "#c6a05a"),
          paperColor: hex(p.paperColor, "#fbfaf6"),
          textColor: hex(p.textColor, "#1f2937"),
        }));
      return value as PublicSiteSettings[K];
    }
    default:
      return d[key];
  }
}
