import type { ComponentType, SVGProps } from "react";
import { NasaqPremiumMark } from "./NasaqPremiumMark";
import { Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { useLicense } from "@/lib/license/client";
import type { AppUser } from "@/lib/auth/use-current-user";
import { cn } from "@/lib/utils";

/**
 * Account state badge — «مرخص» / «موقوف» / «مجاني».
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

export function useAccountTier(user: AppUser | null): AccountTier {
  // `useLicense` short-circuits when there is no cached key and no user id, so
  // mounting this for a real user costs exactly one status call.
  const { isLoading, hasLicense, isAdmin, isSuspended } = useLicense(user?.id, user?.primaryEmail ?? null);
  if (!user) return "FREE";
  if (isLoading) return "LOADING";
  if (isAdmin) return "ADMIN";
  if (isSuspended) return "SUSPENDED";
  return hasLicense ? "LICENSED" : "FREE";
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
    label: "مرخص",
    className:
      "border-brand bg-ok/10 text-success",
    Icon: NasaqPremiumMark,
  },
  ADMIN: {
    label: "مرخص",
    className:
      "border-gold/40 bg-gold/15 text-warning",
    Icon: NasaqPremiumMark,
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
 "border-line bg-surface text-muted",
    Icon: Sparkles,
  },
};

/**
 * The badge itself.
 *
 * Rendered as `[ مرخص ]` / `[ مجاني ]` exactly as specified — the brackets are
 * part of the design language, not decoration around it — with an icon that
 * carries the same meaning when the label is hidden on the narrowest chrome.
 */
export function AccountBadge({
  tier,
  compact = false,
  className,
}: {
  tier: AccountTier;
  compact?: boolean;
  className?: string;
}) {
  const meta = BADGE_META[tier];
  const Icon = meta.Icon;
  return (
    <span
      className={cn(
 "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-extrabold leading-none",
        meta.className,
        className,
      )}
      title={
        tier === "ADMIN"
          ? "حساب مرخص — صلاحيات إدارية كاملة"
          : tier === "LICENSED"
            ? "حساب مرخص"
            : tier === "SUSPENDED"
              ? "الحساب موقوف مؤقتًا بقرار الإدارة"
            : tier === "LOADING"
              ? "جارٍ التحقق من حالة الترخيص"
              : "حساب مجاني — الترخيص يفتح المزايا المتقدمة"
      }
    >
      <Icon className={cn("size-3", tier === "LOADING" && "animate-spin")} aria-hidden />
      {!compact && (
        <span aria-hidden className="opacity-60">
          [
        </span>
      )}
      <span>{meta.label}</span>
      {!compact && (
        <span aria-hidden className="opacity-60">
          ]
        </span>
      )}
    </span>
  );
}
