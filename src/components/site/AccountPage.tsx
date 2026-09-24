import { useCallback, useEffect, useState } from "react";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { amIAdmin } from "@/lib/commercial/admin-functions";
import {
  cancelMyPaymentRequest,
  getMyAccountPage,
  submitPayment,
} from "@/lib/commercial/functions";
import {
  ACCOUNT_STATUS_MESSAGE,
  ACCOUNT_STATUS_META,
  PAYMENT_STATUS_META,
  formatDate,
  formatPrice,
} from "@/lib/commercial/format";
import type {
  CustomerAccount,
  CustomerPaymentRequest,
  PaymentInstructions,
  Plan,
} from "@/lib/commercial/types";
import { cn } from "@/lib/utils";
import { SiteFooter, SiteHeader } from "./SiteChrome";

type AccountData = {
  account: CustomerAccount;
  requests: CustomerPaymentRequest[];
  instructions: PaymentInstructions;
  plans: Plan[];
  hasPending: boolean;
};

/**
 * Customer dashboard: account state, plan selection, and the manual payment flow.
 *
 * The status shown here is whatever the SERVER reported. This component holds no
 * opinion about entitlement and cannot grant access — it renders `account.status`
 * and posts a payment reference for an administrator to review.
 */
export function AccountPage() {
  const { user, isPending } = useCurrentUserState();
  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await getMyAccountPage();
      setData(result);
      // Only decides whether to show the admin link. Every admin action
      // re-verifies server-side, so a tampered value here grants nothing.
      const admin = await amIAdmin();
      setIsAdmin(admin.isAdmin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر تحميل بيانات الحساب.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isPending || !user) return;
    void load();
  }, [isPending, user, load]);

  if (isPending) return <AccountShell />;
  if (!user) return <RedirectToSignIn />;

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader current="/account" />
      <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold">حسابي</h1>
            <p className="mt-1 text-[13px] text-muted">
              {user.displayName ?? user.primaryEmail ?? "—"}
            </p>
          </div>
          {isAdmin && (
            <a
              href="/admin"
              className="inline-flex h-10 items-center rounded-[10px] border border-line bg-surface px-4 text-[12px] font-extrabold dark:border-white/10"
            >
              لوحة الإدارة
            </a>
          )}
        </div>

        {loading && <p className="text-[13px] text-muted">جارٍ التحميل…</p>}

        {error && (
          <p
            role="alert"
            className="rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-[12px] text-danger"
          >
            {error}
          </p>
        )}

        {data && !loading && (
          <div className="grid gap-6">
            <StatusCard account={data.account} />

            {data.hasPending && (
              <p className="rounded-[12px] border border-gold/40 bg-gold/10 p-4 text-[13px] leading-6">
                لديك طلب دفع قيد التحقق من الإدارة. سيتم تفعيل الباقة بعد الاعتماد.
              </p>
            )}

            {!data.hasPending && (
              <PlanSection
                plans={data.plans}
                instructions={data.instructions}
                account={data.account}
                onSubmitted={load}
              />
            )}

            <RequestsSection requests={data.requests} onChanged={load} />

            <AccountSettingsCard
              email={user.primaryEmail}
              status={data.account.status}
            />
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function AccountShell() {
  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader current="/account" />
      <main className="mx-auto w-full max-w-4xl px-4 py-24">
        <p className="text-[13px] text-muted">جارٍ التحقق من الجلسة…</p>
      </main>
    </div>
  );
}

function StatusCard({ account }: { account: CustomerAccount }) {
  const meta = ACCOUNT_STATUS_META[account.status] ?? ACCOUNT_STATUS_META.FREE;
  return (
    <section className="rounded-[14px] border border-line bg-surface p-5 dark:border-white/10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[13px] font-extrabold text-muted">حالة الحساب</h2>
          <span
            className={cn(
              "mt-2 inline-block rounded-full px-3 py-1 text-[12px] font-extrabold",
              meta.className,
            )}
          >
            {meta.label}
          </span>
          <p className="mt-3 max-w-xl text-[13px] leading-6">
            {ACCOUNT_STATUS_MESSAGE[account.status]}
          </p>
        </div>
        <dl className="grid gap-3 text-[12px]">
          <div>
            <dt className="text-muted">الباقة الحالية</dt>
            <dd className="font-extrabold">
              {account.planArabicName ?? account.planName ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">تاريخ التفعيل</dt>
            <dd className="font-extrabold">{formatDate(account.activatedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted">تاريخ الانتهاء</dt>
            <dd className="font-extrabold">{formatDate(account.expiresAt)}</dd>
          </div>
          {account.status === "ACTIVE" && account.daysRemaining !== null && (
            <div>
              <dt className="text-muted">المتبقي</dt>
              <dd className="font-extrabold tabular-nums">
                {account.daysRemaining} يوم
              </dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}

function PlanSection({
  plans,
  instructions,
  account,
  onSubmitted,
}: {
  plans: Plan[];
  instructions: PaymentInstructions;
  account: CustomerAccount;
  onSubmitted: () => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = plans.find((p) => p.id === selected) ?? null;
  // Frame the offer as a renewal when access already exists, so the customer
  // understands their new period extends the current one rather than replacing it.
  const isRenewal = account.status === "ACTIVE" || account.status === "EXPIRED";

  async function handleSubmit() {
    if (!plan) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await submitPayment({
        data: {
          planId: plan.id,
          paymentReference: reference,
          customerNote: note || undefined,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Truthful wording: nothing has been verified yet.
      setMessage("تم إرسال طلب الدفع. الحالة: قيد التحقق من الإدارة.");
      setReference("");
      setNote("");
      setSelected(null);
      await onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر إرسال الطلب.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-[14px] border border-line bg-surface p-5 dark:border-white/10">
      <h2 className="text-[13px] font-extrabold text-muted">
        {isRenewal ? "تجديد الباقة" : "اختر باقة"}
      </h2>
      {isRenewal && (
        <p className="mt-2 text-[12px] leading-6 text-muted">
          التجديد قبل الانتهاء يُضاف إلى مدتك الحالية، فلا تفقد الأيام المتبقية.
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {plans.map((p) => {
          const active = selected === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelected(active ? null : p.id)}
              aria-pressed={active}
              className={cn(
                "cursor-pointer rounded-[12px] border p-4 text-right transition",
                active
                  ? "border-navy bg-navy/5 ring-2 ring-navy/30"
                  : "border-line hover:border-navy/40 dark:border-white/10",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <strong className="text-[15px] font-extrabold">{p.arabicName}</strong>
                <span className="text-[12px] text-muted">{p.durationDays} يوم</span>
              </div>
              <div className="mt-1 text-[12px] text-muted">{p.name}</div>
              <div className="mt-2 text-[17px] font-extrabold tabular-nums">
                {formatPrice(p.price, p.currency)}
              </div>
              {p.description && (
                <p className="mt-2 text-[12px] leading-6 text-muted">{p.description}</p>
              )}
              {p.features.length > 0 && (
                <ul className="mt-3 grid gap-1.5">
                  {p.features.map((feature) => (
                    <li key={feature} className="flex gap-2 text-[12px] leading-6">
                      <span aria-hidden className="text-ok">
                        ✓
                      </span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              )}
            </button>
          );
        })}
      </div>

      {plan && (
        <div className="mt-5 grid gap-4 rounded-[12px] border border-line-2 bg-paper/60 p-4 dark:border-white/10">
          <div>
            <h3 className="text-[13px] font-extrabold">تعليمات الدفع</h3>
            <p className="mt-1 text-[12px] leading-6 text-muted">
              حوّل مبلغ الباقة إلى الحساب التالي، ثم أدخل رقم مرجع الحوالة.
            </p>
            <dl className="mt-3 grid gap-2 text-[12px]">
              <InfoRow label="البنك" value={instructions.bankName} />
              <InfoRow label="اسم الحساب" value={instructions.accountName} />
              <InfoRow label="IBAN" value={instructions.iban} ltr />
              <InfoRow
                label="المبلغ"
                value={formatPrice(plan.price, plan.currency)}
              />
            </dl>
            {instructions.instructionsAr && (
              <p className="mt-3 text-[12px] leading-6 text-muted">
                {instructions.instructionsAr}
              </p>
            )}
          </div>

          <div className="grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-[12px] font-extrabold">
                رقم مرجع الحوالة <span className="text-danger">*</span>
              </span>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={120}
                dir="ltr"
                placeholder="مثال: 2026-000123"
                className="h-10 rounded-[10px] border border-line bg-surface px-3 text-[13px] dark:border-white/10"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[12px] font-extrabold">ملاحظة (اختياري)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                rows={2}
                className="rounded-[10px] border border-line bg-surface p-3 text-[13px] dark:border-white/10"
              />
            </label>
            <p className="text-[11px] leading-5 text-muted">
              لا نطلب أبداً بيانات البطاقة أو الرقم السري. أدخل رقم المرجع فقط.
            </p>
            <button
              type="button"
              disabled={submitting || !reference.trim()}
              onClick={() => void handleSubmit()}
              className="h-11 cursor-pointer rounded-[10px] bg-navy text-[13px] font-extrabold text-white transition hover:bg-navy-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "جارٍ الإرسال…" : "إرسال طلب الدفع"}
            </button>
          </div>
        </div>
      )}

      {message && (
        <p
          role="status"
          className="mt-4 rounded-[10px] border border-ok/30 bg-ok/5 p-3 text-[12px] leading-6 text-ok"
        >
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-[12px] leading-6 text-danger"
        >
          {error}
        </p>
      )}
    </section>
  );
}

function InfoRow({
  label,
  value,
  ltr,
}: {
  label: string;
  value: string;
  ltr?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-extrabold" dir={ltr ? "ltr" : undefined}>
        {value || "—"}
      </dd>
    </div>
  );
}

function RequestsSection({
  requests,
  onChanged,
}: {
  requests: CustomerPaymentRequest[];
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  if (requests.length === 0) return null;

  async function cancel(id: string) {
    setBusy(id);
    try {
      await cancelMyPaymentRequest({ data: { requestId: id } });
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-[14px] border border-line bg-surface p-5 dark:border-white/10">
      <h2 className="text-[13px] font-extrabold text-muted">طلبات الدفع</h2>
      <ul className="mt-3 grid gap-2">
        {requests.map((request) => {
          const meta =
            PAYMENT_STATUS_META[request.status] ?? PAYMENT_STATUS_META.PENDING;
          return (
            <li
              key={request.id}
              className="rounded-[10px] border border-line-2 p-3 dark:border-white/10"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] font-extrabold">{request.planId}</span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-extrabold",
                    meta.className,
                  )}
                >
                  {meta.label}
                </span>
              </div>
              <dl className="mt-2 grid gap-1 text-[11px] text-muted">
                <div className="flex justify-between gap-3">
                  <dt>المبلغ</dt>
                  <dd className="tabular-nums">
                    {formatPrice(request.amount, request.currency)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>رقم المرجع</dt>
                  <dd dir="ltr">{request.paymentReference}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>تاريخ الإرسال</dt>
                  <dd>{formatDate(request.createdAt)}</dd>
                </div>
                {request.reviewedAt && (
                  <div className="flex justify-between gap-3">
                    <dt>تاريخ المراجعة</dt>
                    <dd>{formatDate(request.reviewedAt)}</dd>
                  </div>
                )}
              </dl>
              {request.adminNote && (
                <p className="mt-2 rounded-[8px] bg-paper p-2 text-[11px] leading-5">
                  ملاحظة الإدارة: {request.adminNote}
                </p>
              )}
              {request.status === "PENDING" && (
                <button
                  type="button"
                  disabled={busy === request.id}
                  onClick={() => void cancel(request.id)}
                  className="mt-2 cursor-pointer text-[11px] font-bold text-danger underline-offset-4 hover:underline disabled:cursor-wait"
                >
                  {busy === request.id ? "جارٍ الإلغاء…" : "إلغاء الطلب"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AccountSettingsCard({
  email,
  status,
}: {
  email: string | null;
  status: string;
}) {
  return (
    <section className="rounded-[14px] border border-line bg-surface p-5 dark:border-white/10">
      <h2 className="text-[13px] font-extrabold text-muted">إعدادات الحساب</h2>
      <dl className="mt-3 grid gap-2 text-[12px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">البريد الإلكتروني</dt>
          <dd className="font-extrabold" dir="ltr">
            {email ?? "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">حالة الاشتراك</dt>
          <dd className="font-extrabold">{status}</dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] leading-5 text-muted">
        مشاريعك وتصاميمك وملفاتك محفوظة في حسابك ولا تُحذف عند انتهاء الاشتراك.
      </p>
      <a
        href="/projects"
        className="mt-3 inline-flex h-9 items-center rounded-[8px] border border-line px-3 text-[12px] font-bold dark:border-white/10"
      >
        مشاريعي
      </a>
    </section>
  );
}