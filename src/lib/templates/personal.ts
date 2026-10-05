/**
 * Personal-template sharing rules.
 *
 * A private template has no public URL. A share link exists only after the
 * owner turns sharing on, and it never carries account or payment data.
 */

import { SITE_ORIGIN } from "@/lib/og/share";
import { isShortCode } from "@/lib/templates/short-code";
import { sharedShortPathFor, sharedTemplatePathFor } from "@/lib/site-routes";

export type PersonalVisibility = "private" | "shared";

/** The historical opaque token: 16–80 URL-safe characters. */
const SHARE_TOKEN_RE = /^[a-zA-Z0-9_-]{16,80}$/;

/**
 * The public address of a shared personal template.
 *
 * A short code (`/s/k7m2p9q`) is preferred — it is what gets copied, printed and
 * dictated. An older row that only has the long token still resolves, through
 * its legacy path, so links already in circulation keep working.
 */
export function personalSharePath(tokenOrCode: string): string | null {
  const clean = String(tokenOrCode || "").trim();
  if (!clean) return null;
  if (isShortCode(clean)) return sharedShortPathFor(clean);
  if (SHARE_TOKEN_RE.test(clean)) return sharedTemplatePathFor(clean);
  return null;
}

export function personalShareAbsoluteUrl(token: string, origin?: string): string | null {
  const path = personalSharePath(token);
  if (!path) return null;
  const base = (origin || SITE_ORIGIN).replace(/\/$/, "");
  return `${base}${path}`;
}

/**
 * The key to build a share URL from: the short code when the row has one,
 * otherwise the legacy token.
 */
export function personalShareKey(row: {
  shortCode?: string | null;
  shareToken?: string | null;
} | null): string | null {
  if (!row) return null;
  if (row.shortCode && isShortCode(row.shortCode)) return row.shortCode;
  if (row.shareToken && SHARE_TOKEN_RE.test(row.shareToken)) return row.shareToken;
  return null;
}

/** Private and missing templates are indistinguishable to everyone else. */
export function personalTemplateIsPublic(row: {
  visibility?: string | null;
  shareToken?: string | null;
} | null): boolean {
  if (!row || row.visibility !== "shared") return false;
  return personalShareKey(row) !== null;
}

export function canUsePersonalTemplates(access: {
  isOwner?: boolean;
  isAdmin?: boolean;
  isSuspended?: boolean;
  premiumTemplates?: boolean;
}): boolean {
  if (access.isSuspended) return false;
  return Boolean(access.isOwner || access.isAdmin || access.premiumTemplates);
}
