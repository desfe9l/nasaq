/**
 * Email/password form contract — pure validation shared by the sign-up and
 * sign-in surfaces and by their tests.
 *
 * The rules mirror what Better Auth enforces server-side (8–128 characters), so
 * the form never submits something the API will reject, and the server remains
 * the authority. Nothing here stores, logs or transmits a password.
 */

/** Minimum password length — must match `server.ts` (`minPasswordLength`). */
export const MIN_PASSWORD_LENGTH = 8;
/** Maximum password length — must match `server.ts` (`maxPasswordLength`). */
export const MAX_PASSWORD_LENGTH = 128;
/** Maximum name length accepted by the account row. */
export const MAX_NAME_LENGTH = 120;
/** Maximum email length accepted by the account row. */
export const MAX_EMAIL_LENGTH = 254;

/** Field-level validation result. `errors` is empty when `ok` is true. */
export type CredentialValidation =
  | {
      ok: true;
      value: { name: string; email: string; password: string };
      errors: Record<string, never>;
    }
  | {
      ok: false;
      value: { name: string; email: string; password: string };
      errors: { name?: string; email?: string; password?: string; confirm?: string };
    };

export type CredentialInput = {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
};

/**
 * Email normalization. Trim + lower-case only: NASAQ keeps the address the
 * visitor typed (minus surrounding whitespace) and never rewrites the local
 * part, because an address that differs from the real one cannot receive mail.
 * Lower-casing the whole address matches how Better Auth and the admin
 * allowlists compare it.
 */
export function normalizeEmail(value: string | undefined | null): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Trim + collapse internal whitespace in a display name. */
export function normalizeName(value: string | undefined | null): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * Deliberately permissive shape check: a single `@` with a dotted domain.
 * Deliverability is not knowable from the browser, and over-strict patterns
 * reject valid institutional addresses.
 */
export function isValidEmail(email: string): boolean {
  const value = normalizeEmail(email);
  if (!value || value.length > MAX_EMAIL_LENGTH) return false;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}

/** True when the password satisfies the server-side length contract. */
export function isValidPassword(password: string): boolean {
  const value = String(password ?? "");
  return value.length >= MIN_PASSWORD_LENGTH && value.length <= MAX_PASSWORD_LENGTH;
}

/**
 * Validate a sign-up submission. `confirm` is only checked when the caller
 * collects it (the sign-up form does).
 */
export function validateSignUpInput(input: CredentialInput): CredentialValidation {
  const value = {
    name: normalizeName(input.name),
    email: normalizeEmail(input.email),
    password: String(input.password ?? ""),
  };
  const errors: NonNullable<
    Extract<CredentialValidation, { ok: false }>["errors"]
  > = {};

  if (!value.name) errors.name = "أدخل الاسم الكامل.";
  if (!value.email) errors.email = "أدخل البريد الإلكتروني.";
  else if (!isValidEmail(value.email)) errors.email = "صيغة البريد الإلكتروني غير صحيحة.";
  if (!value.password) errors.password = `أدخل كلمة مرور من ${MIN_PASSWORD_LENGTH} أحرف على الأقل.`;
  else if (value.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `كلمة المرور قصيرة — ${MIN_PASSWORD_LENGTH} أحرف على الأقل.`;
  } else if (value.password.length > MAX_PASSWORD_LENGTH) {
    errors.password = `كلمة المرور طويلة — ${MAX_PASSWORD_LENGTH} حرفًا كحد أقصى.`;
  }
  if (input.confirm !== undefined) {
    if (!String(input.confirm)) errors.confirm = "أعد كتابة كلمة المرور.";
    else if (String(input.confirm) !== value.password) {
      errors.confirm = "كلمتا المرور غير متطابقتين.";
    }
  }

  return Object.keys(errors).length
    ? { ok: false, value, errors }
    : { ok: true, value, errors: {} };
}

/** Validate a sign-in submission (no name, no confirmation). */
export function validateSignInInput(input: CredentialInput): CredentialValidation {
  const value = {
    name: normalizeName(input.name),
    email: normalizeEmail(input.email),
    password: String(input.password ?? ""),
  };
  const errors: NonNullable<
    Extract<CredentialValidation, { ok: false }>["errors"]
  > = {};
  if (!value.email) errors.email = "أدخل البريد الإلكتروني.";
  else if (!isValidEmail(value.email)) errors.email = "صيغة البريد الإلكتروني غير صحيحة.";
  // Sign-in never states the length rule back: it would leak the policy to a
  // visitor who is probing accounts, and the server owns the real check.
  if (!value.password) errors.password = "أدخل كلمة المرور.";
  return Object.keys(errors).length
    ? { ok: false, value, errors }
    : { ok: true, value, errors: {} };
}
