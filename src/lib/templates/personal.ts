/**
 * Personal-template sharing rules.
 *
 * A private template has no public URL. A share link exists only after the
 * owner turns sharing on, and it never carries account or payment data.
 */

import { SITE_ORIGIN } from "@/lib/og/share";

export type PersonalVisibility = "private" | "shared";

export function personalSharePath(token: string): string | null {
  const clean = String(token || "").trim();
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(clean)) return null;
  return `/templates/share/${encodeURIComponent(clean)}`;
}

export function personalShareAbsoluteUrl(token: string, origin?: string): string | null {
  const path = personalSharePath(token);
  if (!path) return null;
  const base = (origin || SITE_ORIGIN).replace(/\/$/, "");
  return `${base}${path}`;
}

/** Private and missing templates are indistinguishable to everyone else. */
export function personalTemplateIsPublic(row: {
  visibility?: string | null;
  shareToken?: string | null;
} | null): boolean {
  return Boolean(row && row.visibility === "shared" && row.shareToken && personalSharePath(row.shareToken));
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
