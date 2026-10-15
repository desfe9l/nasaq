/**
 * «الحساب والاشتراك» — the persistent subscription section.
 *
 * One component, two densities: the identity card opens with the compact form
 * (`variant="menu"`) so an author sees their standing without leaving the
 * toolbar, and `/account` gets the full form (`variant="page"`). Both render the
 * SAME derived facts in the SAME order, from `@/lib/account/subscription` —
 * never a second opinion about what the account is entitled to.
 *
 * Why this is its own component rather than markup copied into each surface:
 * the section used to grow a row (and lose the countdown) the moment the server
 * answered, which is what made it visibly jump. Every variant here therefore
 * keeps one box:
 *
 *   • `subscriptionDetail` always returns FOUR fields, in a fixed order, with a
 *     dash or «بدون نهاية» where a plan has nothing to say;
 *   • while the answer is not in yet the section paints the SAME four rows as
 *     static skeletons — no spinner swapping for a table, no height change;
 *   • the meter row exists in all three of its states at the same height;
 *   • nothing ticks: the day count is calendar arithmetic, so the only repaint
 *     is the licence's own background revalidation.
 *
 * The state is read, never decided: `useLicense` resolves it on the server
 * (`getLicenseStatusFn`) and this component displays it, including for the
 * administrator/owner view, which only adds links and a system line.
 */

import type { ReactNode } from "react";
import { CalendarClock, Hourglass, Infinity as InfinityIcon, KeyRound, ShieldCheck } from "lucide-react";
import { useLicense } from "@/lib/license/client";
import { documentBuildId } from "@/lib/app-update";
import type { AppUser } from "@/lib/auth/use-current-user";
import { ADMIN_ROUTES } from "@/lib/site-routes";
import {
  SUBSCRIPTION_OPEN_ENDED,
  subscriptionDetail,
  type SubscriptionDetail,
} from "@/lib/account/subscription";
import { cn } from "@/lib/utils";

export type AccountSubscriptionVariant = "menu" | "page";

/** The licence answer this account has, shaped for the section. */
export function useAccountSubscription(user: AppUser | null) {
  const { isLoading, hasLicense, isAdmin, isOwner, isSuspended, license, trial } = useLicense(
    user?.id,
    user?.primaryEmail ?? null,
  );
  return subscriptionDetail({
    isLoading,
    hasLicense,
    isAdmin,
    isOwner: Boolean(isOwner),
    isSuspended,
    license,
    trial,
    accountCreatedAt: user?.createdAt ?? null,
  });
}

/** A value line, or the same-height skeleton while the server is unanswered. */
function FieldValue({ loading, children }: { loading: boolean; children: ReactNode }) {
  if (loading) return <span className="subscription-skeleton" aria-hidden />;
  return <>{children}</>;
}

function FieldGrid({ detail }: { detail: SubscriptionDetail }) {
  const loading = detail.phase === "LOADING";
  return (
    <dl className="subscription-fields">
      {detail.fields.map((item) => (
        <div key={item.key} className="subscription-field" data-field={item.key}>
          <dt className="subscription-field-label">{item.label}</dt>
          <dd className="subscription-field-value">
            <FieldValue loading={loading}>
              {/* A date or a key fragment keeps LTR order inside the RTL row. */}
              {item.key === "activatedAt" || item.key === "expiresAt" ? (
                <bdi dir="ltr">{item.value}</bdi>
              ) : (
                item.value
              )}
            </FieldValue>
          </dd>
          {/* The hint line always occupies its row, hint or no hint. */}
          <p className="subscription-field-hint">{loading ? "" : (item.hint ?? "")}</p>
        </div>
      ))}
    </dl>
  );
}

/**
 * The countdown block: the number, its words, and the meter.
 *
 * `countdown` draws a filled track, `open` a full track in the neutral tone
 * (lifetime/admin — nothing is running out), `none` the empty track. All three
 * are the same box, so switching between them cannot resize the section.
 */
function Countdown({ detail, size }: { detail: SubscriptionDetail; size: "compact" | "full" }) {
  const loading = detail.phase === "LOADING";
  const percent = detail.elapsedPercent;
  const fill = detail.meter === "open" ? 100 : (percent ?? 0);
  const Icon = detail.isAdmin ? ShieldCheck : detail.meter === "open" ? InfinityIcon : Hourglass;
  const words =
    detail.meter === "open"
      ? SUBSCRIPTION_OPEN_ENDED
      : detail.meter === "none"
        ? "لا توجد مدة جارية"
        : (detail.daysLabel ?? "—");
  return (
    <div className={cn("subscription-countdown", size === "full" && "subscription-countdown-full")}>
      <div className="subscription-countdown-head">
        <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
        <span className="subscription-countdown-label">
          {detail.meter === "open" ? "مدة الوصول" : "المتبقي من المدة"}
        </span>
      </div>
      {loading ? (
        <span className="subscription-skeleton subscription-skeleton-wide" aria-hidden />
      ) : (
        <p className="subscription-countdown-value">
          {detail.meter === "countdown" && detail.daysRemaining !== null && detail.daysRemaining > 0 ? (
            <span className="subscription-days">{detail.daysRemaining}</span>
          ) : null}
          <span>{words}</span>
        </p>
      )}
      <div
        className={cn(
          "subscription-meter",
          detail.meter === "open" && "subscription-meter-open",
          detail.meter === "none" && "subscription-meter-empty",
          detail.tone === "lapsed" && "subscription-meter-lapsed",
        )}
        role="progressbar"
        aria-label="نسبة استهلاك مدة الاشتراك"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={loading ? undefined : Math.round(fill)}
      >
        <i style={{ width: `${loading ? 0 : fill}%` }} />
      </div>
    </div>
  );
}

/** The management affordances a verified administrator/owner is offered. */
function AdminBlock({ detail, variant }: { detail: SubscriptionDetail; variant: AccountSubscriptionVariant }) {
  if (!detail.isAdmin) return null;
  return (
    <div className="subscription-admin">
      <p className="subscription-admin-note">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
        {detail.isOwner
          ? "حالة المنصة تُدار من هذا الحساب: الاشتراكات، التراخيص، ومحتوى الموقع."
          : "صلاحية الإدارة موثّقة على الخادم؛ لا باقة مطلوبة لهذا الحساب."}
      </p>
      <div className="subscription-admin-links">
        <a href={ADMIN_ROUTES.dashboard} className="subscription-admin-link">
          لوحة الإدارة
        </a>
        <a href={ADMIN_ROUTES.licenses} className="subscription-admin-link">
          إدارة التراخيص
        </a>
        {variant === "page" && (
          <>
            <a href={ADMIN_ROUTES.plans} className="subscription-admin-link">
              الباقات والأسعار
            </a>
            <a href={ADMIN_ROUTES.users} className="subscription-admin-link">
              حالة الحسابات
            </a>
            {/* Which build this account is looking at — support's first question,
                and the one system fact the browser can state truthfully. */}
            <span className="subscription-admin-build" title="إصدار المنصة المعروض الآن">
              الإصدار <bdi dir="ltr">{documentBuildId()}</bdi>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function AccountSubscriptionCard({
  user,
  variant = "page",
}: {
  user: AppUser | null;
  variant?: AccountSubscriptionVariant;
}) {
  const detail = useAccountSubscription(user);
  const loading = detail.phase === "LOADING";
  return (
    <section
      className={cn(
        "subscription-summary",
        variant === "menu" ? "subscription-summary-compact" : "subscription-summary-page",
      )}
      aria-label="الحساب والاشتراك"
      aria-busy={loading}
      data-subscription-phase={detail.phase}
    >
      <header className="subscription-head">
        <h3 className="subscription-title">الحساب والاشتراك</h3>
        <span className={`subscription-status subscription-status-${detail.tone}`}>
          {loading ? <span className="subscription-skeleton" aria-hidden /> : detail.statusLabel}
        </span>
      </header>

      <p className="subscription-plan">
        <CalendarClock className="size-3.5 shrink-0 opacity-70" aria-hidden />
        <FieldValue loading={loading}>{detail.planLabel}</FieldValue>
      </p>

      <FieldGrid detail={detail} />
      <Countdown detail={detail} size={variant === "page" ? "full" : "compact"} />
      {!loading && detail.note && <p className="subscription-note">{detail.note}</p>}

      {!loading && detail.keyPrefix && (
        <p className="subscription-key" title="آخر أربع خانات من مفتاح الترخيص">
          المفتاح <bdi dir="ltr">•••• {detail.keyPrefix}</bdi>
        </p>
      )}

      <AdminBlock detail={detail} variant={variant} />

      {variant === "page" && (
        <div className="subscription-actions">
          <a href="/license" className="subscription-action subscription-cta">
            <KeyRound className="size-3.5 shrink-0" aria-hidden />
            ترخيصي وتفعيله
          </a>
          <a href="/purchase" className="subscription-action">
            {detail.daysRemaining !== null && detail.daysRemaining <= 7 ? "تجديد الباقة" : "الخطط والأسعار"}
          </a>
        </div>
      )}
    </section>
  );
}
