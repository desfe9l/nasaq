import type { ComponentType, SVGProps } from "react";
import { Loader2, ShieldAlert, Check, Lock } from "lucide-react";
import { useLicense } from "@/lib/license/client";
import type { AppUser } from "@/lib/auth/use-current-user";
import { cn } from "@/lib/utils";

/**
 * Account state badge — «مشترك» / «موقوف» / «مجاني».
 *
 * Mounted as its own component (rather than called as a hook inside
 * `HeaderAccount`) for two reasons: `useLicense` must run unconditionally, and
 * it must NOT run for a signed-out visitor — a badge is personal state, and
 * polling for it while signed out would be a wasted round trip on every page.
 *
 * The state is resolved on the server from the verified session
 * (`getLicenseStatusFn`): a licence row, an administrator identity or a cached
 * key. The browser never decides which badge it deserves.
 */
export type AccountTier = "LOADING" | "LICENSED" | "ADMIN" | "SUSPENDED" | "FREE";

/**
 * Server-resolved account standing. `tier` drives the visible badge and every
 * licensing gate in the UI; `isOwner` only refines the ADMIN label/tooltip.
 */
export type AccountTierState = { tier: AccountTier; isOwner: boolean };

export function useAccountTier(user: AppUser | null): AccountTierState {
  // `useLicense` short-circuits when there is no cached key and no user id, so
  // mounting this for a real user costs exactly one status call.
  const { isLoading, hasLicense, isAdmin, isSuspended, isOwner } = useLicense(user?.id, user?.primaryEmail ?? null);
  if (!user) return { tier: "FREE", isOwner: false };
  if (isLoading) return { tier: "LOADING", isOwner: Boolean(isOwner) };
  if (isAdmin) return { tier: "ADMIN", isOwner: Boolean(isOwner) };
  if (isSuspended) return { tier: "SUSPENDED", isOwner: Boolean(isOwner) };
  return { tier: hasLicense ? "LICENSED" : "FREE", isOwner: Boolean(isOwner) };
}

const BADGE_META: Record<
  AccountTier,
  { label: string; className: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }
> = {
  LOADING: {
    label: "جارٍ التحقق",
    className:
 "border-line bg-surface text-muted",
    Icon: Loader2,
  },
  LICENSED: {
    label: "مشترك",
    className:
      "border-brand/20 bg-brand/10 text-brand",
    Icon: Check,
  },
  ADMIN: {
    label: "مشترك",
    className:
      "border-brand/20 bg-brand/10 text-brand",
    Icon: Check,
  },
  SUSPENDED: {
    label: "موقوف",
    className:
 "border-danger/30 bg-danger/10 text-error ",
    Icon: ShieldAlert,
  },
  FREE: {
    label: "مجاني",
    className:
      "border-gold/25 border-dashed bg-gold/10 text-ink",
    Icon: Lock,
  },
};

/**
 * The badge itself.
 *
 * Compact RTL status pill; the icon reinforces the label without ornamental
 * brackets, glow or a second status treatment.
 */
export function AccountBadge({
  tier,
  isOwner = false,
  compact = false,
  className,
}: {
  tier: AccountTier;
  isOwner?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const meta = BADGE_META[tier];
  const Icon = meta.Icon;
  const label = (tier === "ADMIN" && isOwner) ? "المالك الرئيسي" : meta.label;
  return (
    <span
      data-account-status={tier}
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap gap-1 rounded-full border py-0.5 text-[11px] font-bold leading-4",
        compact ? "px-2" : "px-2.5",
        meta.className,
        className,
      )}
      title={
        (tier === "ADMIN" && isOwner)
          ? "المالك الرئيسي — صلاحيات إدارية كاملة"
          : tier === "ADMIN"
            ? "مشترك — صلاحيات إدارية كاملة"
            : tier === "LICENSED"
              ? "مشترك"
              : tier === "SUSPENDED"
                ? "الحساب موقوف مؤقتًا بقرار الإدارة"
              : tier === "LOADING"
                ? "جارٍ التحقق من حالة الترخيص"
                : "حساب مجاني — الترخيص يفتح المزايا المتقدمة"
      }
    >
      <Icon className={cn("size-3 shrink-0", tier === "LOADING" && "animate-spin")} aria-hidden />

      <span>{label}</span>

    </span>
  );
}
