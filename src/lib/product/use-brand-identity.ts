/*
 * The account's institutional identity, ready for a document to be built from.
 *
 * One hook, so every creation surface answers the same two questions the same
 * way: IS the identity licensed (`brand_kit`), and WHICH kit is active. It reads
 * the existing store (`readBrandKit`) — there is no second identity source — and
 * it reports `null` when the kit is still the default, because a default kit is
 * not a choice the author made.
 */

import { useEffect, useState } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useLicense } from "@/lib/license/client";
import { brandIsConfigured } from "@/lib/editor/brand-design";
import { readBrandKit } from "./brand-kit";
import type { BrandKit } from "./product";

export interface BrandIdentityState {
  /** The active kit, or null when there is nothing to apply. */
  kit: BrandKit | null;
  /** Whether the `brand_kit` entitlement is present. */
  entitled: boolean;
}

export function useBrandIdentity(): BrandIdentityState {
  const { user } = useCurrentUserState();
  const { entitlements } = useLicense(user?.id, user?.primaryEmail);
  const [kit, setKit] = useState<BrandKit | null>(null);

  useEffect(() => {
    let alive = true;
    if (!entitlements.brand_kit) {
      setKit(null);
      return () => {
        alive = false;
      };
    }
    void readBrandKit()
      .then((next) => {
        if (alive) setKit(brandIsConfigured(next) ? next : null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [entitlements.brand_kit, user?.id]);

  return { kit, entitled: Boolean(entitlements.brand_kit) };
}
