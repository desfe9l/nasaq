/**
 * One identity view for the signed-in account.
 *
 * The editor header, the site chrome chip and the account page all print WHO is
 * signed in, and they must agree — three copies of `name ?? email ?? "حسابي"`
 * drift the first time one of them is edited. Resolution therefore lives here,
 * and every surface renders the result.
 *
 * The source is always the verified session (`useCurrentUserState` → Better
 * Auth): no second profile store, no cached name, no guessing.
 */

import type { AppUser } from "./use-current-user";

/** What the UI prints for an account that carries no usable name. */
export const ACCOUNT_FALLBACK_LABEL = "حسابي";

/** One resolved identity, ready to render. */
export interface AccountIdentity {
  /** The real profile name when the account has one; the email only as a last resort. */
  label: string;
  /** Up to two initials for the avatar (empty when the label has no letters). */
  initials: string;
  /** Account avatar from the auth provider, when it has one. */
  avatarUrl: string | null;
  /** Primary email — secondary information, never the display name when a name exists. */
  email: string | null;
  /** True when the label came from the email or the generic fallback, not a real name. */
  hasProfileName: boolean;
}

/** Collapse whitespace and drop an empty/blank string to `null`. */
function clean(value: string | null | undefined): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length ? text : null;
}

/**
 * The name the account is known by.
 *
 * Precedence: the profile name from the auth system, then the email (an account
 * created without a display name still has to be identifiable), then a generic
 * label so the chrome never renders an empty chip.
 */
export function accountLabel(user: AppUser | null | undefined): string {
  const name = clean(user?.displayName);
  if (name) return name;
  return clean(user?.primaryEmail) ?? ACCOUNT_FALLBACK_LABEL;
}

/** True when the account itself carries a name (not an email fallback). */
export function hasProfileName(user: AppUser | null | undefined): boolean {
  return clean(user?.displayName) !== null;
}

/**
 * Initials for the avatar — the first letter of the first two words.
 *
 * Works for both scripts the product serves: «فيصل العنزي» → «فع» and
 * "Faisal Alenezi" → "FA". An email label collapses to the first letter of the
 * address («U» for user@example.com) because an avatar of «us» from a domain
 * tells nobody anything.
 */

/** Leading punctuation (@, quotes, bullets) that is not part of a name. */
const LEADING_SIGILS = /^[^\p{L}\p{N}]+/u;
/**
 * The Arabic definite article. Only the SECOND word has it stripped: a surname
 * is known by its real first letter («العنزي» → «ع», not «ا»), while a first
 * name such as «الهام» must keep its own.
 */
const ARABIC_ARTICLE = /^ال(?=\p{L})/u;

function firstLetter(word: string, dropArticle: boolean): string {
  const cleaned = word
    .replace(LEADING_SIGILS, "")
    .replace(dropArticle ? ARABIC_ARTICLE : "", "");
  return Array.from(cleaned)[0] ?? "";
}

export function accountInitials(label: string): string {
  const words = clean(label)?.split(" ").filter(Boolean) ?? [];
  if (!words.length) return "";
  const head = firstLetter(words[0], false);
  const second = words.length > 1 ? firstLetter(words[1], true) : "";
  return (head + second).toUpperCase();
}

/** Resolve everything the account chrome needs from the session user. */
export function accountIdentity(user: AppUser | null | undefined): AccountIdentity {
  const label = accountLabel(user);
  return {
    label,
    initials: accountInitials(label),
    avatarUrl: clean(user?.profileImageUrl),
    email: clean(user?.primaryEmail),
    hasProfileName: hasProfileName(user),
  };
}
