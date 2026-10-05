/**
 * Store/checkout/subscription management offline cache.
 * Show cached information where useful (account status, plans), but require
 * connectivity for purchases, payments, and subscription changes.
 */

import { getStorageOwner } from "@/lib/editor/storage-owner";

const KEY_PREFIX = "nasaq-commercial-cache::";

export interface CachedCommercial {
  ownerId: string;
  account: unknown;
  requests: unknown;
  plans: unknown;
  cachedAt: number;
}

export async function cacheCommercial(data: Omit<CachedCommercial, "cachedAt" | "ownerId">): Promise<void> {
  const ownerId = getStorageOwner();
  const payload: CachedCommercial = { ...data, ownerId, cachedAt: Date.now() };
  try { localStorage.setItem(`${KEY_PREFIX}${ownerId}`, JSON.stringify(payload)); } catch {}
}

export function getCachedCommercial(ownerId: string = getStorageOwner()): CachedCommercial | null {
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${ownerId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Keep for 24h
    if (Date.now() - parsed.cachedAt > 24*60*60*1000) return null;
    return parsed as CachedCommercial;
  } catch { return null; }
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function requireOnlineForPurchase(): { ok: true } | { ok: false; error: string } {
  if (isOnline()) return { ok: true };
  return { ok: false, error: "إجراء الشراء والدفع يتطلب اتصالاً بالإنترنت. سيتم فتح المتجر عند عودة الاتصال." };
}
