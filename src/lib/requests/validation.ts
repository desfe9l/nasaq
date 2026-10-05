/**
 * Client-request validation — pure, testable, and shared.
 *
 * The form and the server run the SAME rules from this module. A browser that
 * skips a check therefore changes nothing: the server re-runs them on the real
 * payload. What this file deliberately does NOT do is trust the shape of the
 * input — every field is read defensively, because the endpoint is public.
 */

import {
  REQUEST_KINDS,
  REQUEST_PRIORITIES,
  REQUEST_SOURCES,
  REQUEST_STATUSES,
  type RequestKind,
  type RequestPriority,
  type RequestSource,
  type RequestStatus,
} from "./types";

export const REQUEST_LIMITS = {
  name: { min: 2, max: 80 },
  contact: { min: 7, max: 120 },
  email: { max: 160 },
  organization: { max: 120 },
  details: { min: 12, max: 4000 },
  /** Free text an administrator can write back. */
  note: { max: 4000 },
  /** Submissions allowed per identity per window. */
  rate: { submissions: 5, windowMs: 10 * 60_000 },
} as const;

export interface ClientRequestInput {
  kind: RequestKind;
  name: string;
  contact: string;
  email: string;
  organization: string;
  details: string;
  source: RequestSource;
  templateId: string | null;
}

export type ValidationResult =
  | { ok: true; value: ClientRequestInput }
  | { ok: false; errors: string[] };

function text(value: unknown, max: number): string {
  /*
   * Only NUL is removed. Everything else the customer typed — including the
   * newlines that separate paragraphs of a written answer — is theirs and is
   * preserved; `replaceAll` states that without a character-class regex.
   */
  return String(value ?? "")
    .replaceAll("\u0000", "")
    .trim()
    .slice(0, max);
}

/**
 * One line only, for a field that is printed on a row.
 *
 * A customer pasting a paragraph into «الاسم» is not an attacker, but the
 * inbox row still has to stay readable, so newlines collapse to a space.
 */
function line(value: unknown, max: number): string {
  return text(value, max).replace(/\s+/g, " ");
}

/**
 * A contact value the platform can actually act on.
 *
 * Deliberately permissive: Saudi numbers are written with and without the
 * country code, with and without spaces or dashes, and some customers leave an
 * email instead. What is rejected is a value with no way to reach anyone at
 * all — a single character, or letters with no digits and no `@`.
 */
export function isReachableContact(contact: string): boolean {
  const value = contact.trim();
  if (value.length < REQUEST_LIMITS.contact.min) return false;
  if (value.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7;
}

/** Digits-only international form of a phone number, for `tel:`/`wa.me`. */
export function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const candidate = String(value ?? "").trim();
  return (allowed as readonly string[]).includes(candidate)
    ? (candidate as T)
    : fallback;
}

export function validateClientRequest(raw: unknown): ValidationResult {
  const input = (raw ?? {}) as Record<string, unknown>;
  const errors: string[] = [];

  const name = line(input.name, REQUEST_LIMITS.name.max);
  if (name.length < REQUEST_LIMITS.name.min)
    errors.push("الاسم مطلوب (حرفان على الأقل).");

  const contact = line(input.contact, REQUEST_LIMITS.contact.max);
  if (!isReachableContact(contact))
    errors.push("أدخل رقم جوال أو بريدًا إلكترونيًا صحيحًا للتواصل.");

  const emailRaw = line(input.email, REQUEST_LIMITS.email.max);
  if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailRaw))
    errors.push("البريد الإلكتروني غير صحيح.");

  const details = text(input.details, REQUEST_LIMITS.details.max);
  if (details.length < REQUEST_LIMITS.details.min)
    errors.push("اكتب وصفًا موجزًا للطلب (١٢ حرفًا على الأقل).");

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      kind: oneOf(input.kind, REQUEST_KINDS, "design"),
      name,
      contact,
      email: emailRaw,
      organization: line(input.organization, REQUEST_LIMITS.organization.max),
      details,
      source: oneOf(input.source, REQUEST_SOURCES, "site"),
      templateId: line(input.templateId, 120) || null,
    },
  };
}

export function isRequestStatus(value: unknown): value is RequestStatus {
  return (REQUEST_STATUSES as readonly string[]).includes(String(value ?? ""));
}

export function isRequestPriority(value: unknown): value is RequestPriority {
  return (REQUEST_PRIORITIES as readonly string[]).includes(String(value ?? ""));
}

/** A written answer: trimmed, bounded, and empty when there is nothing to say. */
export function normalizeResponseNote(value: unknown): string {
  return text(value, REQUEST_LIMITS.note.max).replace(/\n{3,}/g, "\n\n");
}
