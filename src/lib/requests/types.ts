/**
 * Client requests — shared vocabulary (client + server).
 *
 * The platform's own contact/request system. A visitor or an account holder
 * describes what they need; the administration reads it in a real inbox, with
 * a status, an assignee and a written answer. This module holds the nouns —
 * kinds, statuses, priorities and the settings document — so the browser and
 * the server can never disagree about what a value means.
 *
 * Sensible defaults live here rather than in the database, so a deployment
 * with an empty settings row still presents a complete, honest form: the
 * platform's own institutional number and the service types the product
 * actually offers. The administrator's saved row overrides them.
 */

export const REQUEST_KINDS = ["design", "template", "license", "support"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_STATUSES = ["new", "in_progress", "answered", "closed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_PRIORITIES = ["low", "normal", "high"] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];

/** Where a request was opened from — for reporting, never shown to customers. */
export const REQUEST_SOURCES = [
  "site",
  "contact",
  "custom-design",
  "template",
  "account",
  "editor",
] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  design: "طلب تصميم",
  template: "استفسار عن قالب",
  license: "ترخيص واشتراك",
  support: "دعم واستخدام",
};

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  new: "جديد",
  in_progress: "قيد المعالجة",
  answered: "تم الرد",
  closed: "مغلق",
};

export const REQUEST_PRIORITY_LABELS: Record<RequestPriority, string> = {
  low: "منخفضة",
  normal: "عادية",
  high: "مستعجلة",
};

/** One service type the form offers. Admin-managed, ordered, can be disabled. */
export interface RequestServiceType {
  id: string;
  label: string;
  /** One line of guidance under the option. */
  hint: string;
  enabled: boolean;
}

export interface RequestSettings {
  /** Contact numbers shown next to the form, in display form. */
  contactNumbers: string[];
  /** Institutional inbox for written correspondence, shown as text. */
  contactEmail: string;
  /** The service types the form offers, in the order they are presented. */
  services: RequestServiceType[];
  /** Which optional fields the form asks for. Name/details/contact are fixed. */
  fields: {
    organization: boolean;
    email: boolean;
    deadline: boolean;
    attachmentNote: boolean;
  };
  /** The answer window the platform promises, stated under the form. */
  responseWindow: string;
  /** The sentence shown after a successful submission. */
  confirmationNote: string;
  /** What the form tells the visitor about data use. */
  privacyNote: string;
}

/**
 * The shipped configuration.
 *
 * The number is the platform's published institutional contact number (the same
 * one the footer and the contact page already carry), never a placeholder: a
 * request surface that shows an invented number is worse than one that shows
 * none.
 */
export const DEFAULT_REQUEST_SETTINGS: RequestSettings = {
  contactNumbers: ["+966 55 201 7111"],
  contactEmail: "",
  services: [
    {
      id: "design",
      label: "طلب تصميم خاص",
      hint: "تقرير أو هوية مخرجات أو عرض مؤسسي يُبنى على مقاس جهتك.",
      enabled: true,
    },
    {
      id: "template",
      label: "قالب أو مكتبة قوالب",
      hint: "قالب مخصص يُضاف إلى مكتبتك، أو سؤال عن قالب من الكتالوج.",
      enabled: true,
    },
    {
      id: "license",
      label: "ترخيص واشتراك",
      hint: "اختيار الباقة المناسبة، التجديد، أو ترخيص لفريق.",
      enabled: true,
    },
    {
      id: "support",
      label: "دعم واستخدام",
      hint: "سؤال عن المحرر أو التصدير أو إدارة المشاريع.",
      enabled: true,
    },
  ],
  fields: {
    organization: true,
    email: true,
    deadline: true,
    attachmentNote: false,
  },
  responseWindow: "الرد المبدئي خلال يوم عمل واحد.",
  confirmationNote: "وصلنا طلبك وسيتواصل معك فريق نَسَق على بيانات التواصل التي أدخلتها.",
  privacyNote:
    "تُستخدم بياناتك للرد على هذا الطلب فقط، ولا تُنشر ولا تُشارك خارج فريق نَسَق.",
};

/** Merge a stored settings document over the defaults, field by field. */
export function normalizeRequestSettings(value: unknown): RequestSettings {
  const raw = (value ?? {}) as Partial<RequestSettings>;
  const numbers = Array.isArray(raw.contactNumbers)
    ? raw.contactNumbers
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean)
        .slice(0, 5)
    : DEFAULT_REQUEST_SETTINGS.contactNumbers;
  const services = Array.isArray(raw.services)
    ? raw.services
        .map((entry) => {
          const item = (entry ?? {}) as Partial<RequestServiceType>;
          const id = String(item.id ?? "").trim();
          const label = String(item.label ?? "").trim();
          if (!id || !label) return null;
          return {
            id,
            label,
            hint: String(item.hint ?? "").trim(),
            enabled: item.enabled !== false,
          } satisfies RequestServiceType;
        })
        .filter((entry): entry is RequestServiceType => entry !== null)
        .slice(0, 12)
    : DEFAULT_REQUEST_SETTINGS.services;
  return {
    contactNumbers: numbers.length
      ? numbers
      : DEFAULT_REQUEST_SETTINGS.contactNumbers,
    contactEmail: String(raw.contactEmail ?? "").trim(),
    services: services.length ? services : DEFAULT_REQUEST_SETTINGS.services,
    fields: {
      organization:
        raw.fields?.organization ?? DEFAULT_REQUEST_SETTINGS.fields.organization,
      email: raw.fields?.email ?? DEFAULT_REQUEST_SETTINGS.fields.email,
      deadline: raw.fields?.deadline ?? DEFAULT_REQUEST_SETTINGS.fields.deadline,
      attachmentNote:
        raw.fields?.attachmentNote ?? DEFAULT_REQUEST_SETTINGS.fields.attachmentNote,
    },
    responseWindow:
      String(raw.responseWindow ?? "").trim() ||
      DEFAULT_REQUEST_SETTINGS.responseWindow,
    confirmationNote:
      String(raw.confirmationNote ?? "").trim() ||
      DEFAULT_REQUEST_SETTINGS.confirmationNote,
    privacyNote:
      String(raw.privacyNote ?? "").trim() || DEFAULT_REQUEST_SETTINGS.privacyNote,
  };
}

/** The kinds the admin console can filter by, derived from the service types. */
export function requestKindOptions(
  settings: RequestSettings,
): { id: RequestKind; label: string }[] {
  const offered = new Set(
    settings.services.filter((service) => service.enabled).map((service) => service.id),
  );
  const kinds = REQUEST_KINDS.filter((kind) => offered.has(kind));
  return (kinds.length ? kinds : REQUEST_KINDS).map((kind) => ({
    id: kind,
    label: REQUEST_KIND_LABELS[kind],
  }));
}

/** A request as the customer sees it (their own history). */
export interface ClientRequestSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  kind: RequestKind;
  status: RequestStatus;
  serviceLabel: string;
  details: string;
  /** The administration's written answer, once there is one. */
  responseNote: string;
  respondedAt: string | null;
}
