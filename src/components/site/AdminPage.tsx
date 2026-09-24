import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  adminActivateCustomer,
  adminApprovePayment,
  adminChangePlan,
  adminExtendSubscription,
  adminGrantAdmin,
  adminRejectPayment,
  adminRestoreCustomer,
  adminSetExpiration,
  adminSuspendCustomer,
  adminUpdatePaymentSettings,
  adminUpdatePlan,
  amIAdmin,
  getAdminAuditLog,
  getAdminCustomers,
  getAdminPaymentRequests,
  getAdminPlans,
} from "@/lib/commercial/admin-functions";
import {
  ACCOUNT_STATUS_META,
  PAYMENT_STATUS_META,
  formatDate,
  formatPrice,
} from "@/lib/commercial/format";
import type {
  AdminAuditEntry,
  AdminCustomer,
  AdminPaymentRequest,
  PaymentInstructions,
  PaymentRequestStatus,
  Plan,
} from "@/lib/commercial/types";
import { getAdminPaylinkTransactions } from "@/lib/paylink/admin-functions";
import { getCatalogPlan } from "@/lib/commercial/catalog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Copy,
  CreditCard,
  KeyRound,
  LayoutDashboard,
  Package,
  ReceiptText,
  RefreshCw,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  PAYLINK_PAYMENT_TYPE_LABELS,
  PAYLINK_WEBHOOK_PATH,
} from "@/lib/paylink/contract";
import { SiteFooter, SiteHeader } from "./SiteChrome";

type PaylinkRow = Awaited<ReturnType<typeof getAdminPaylinkTransactions>>[number];

/** Arabic label + tone for the gateway settlement status. */
const PAYLINK_STATUS_META: Record<string, { label: string; className: string }> = {
  PAID: {
    label: "مدفوعة",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  PENDING: {
    label: "قيد الانتظار",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
  PROCESSING: {
    label: "قيد المعالجة",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  },
  FAILED: {
    label: "فاشلة",
    className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  CANCELED: {
    label: "ملغاة",
    className: "bg-line-2 text-muted dark:bg-white/10",
  },
};


function paylinkStatusMeta(status: string) {
  return (
    PAYLINK_STATUS_META[status] ?? {
      label: status,
      className: "bg-line-2 text-muted dark:bg-white/10",
    }
  );
}

/**
 * «عمليات Paylink» — the settlement ledger.
 *
 * This is the reconciliation surface: for every invoice NASAQ created, what
 * Paylink says happened to it and which licence it produced. It reads from
 * `paylink_transactions` joined to the licence, so the transaction number, the
 * gateway status, the plan, the customer, the licence key and the date are all
 * on one row — an operator should never have to open three screens to answer
 * "did this customer's payment turn into a licence?".
 */
function PaylinkTab() {
  const [rows, setRows] = useState<PaylinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PAID" | "PENDING" | "FAILED">(
    "ALL",
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getAdminPaylinkTransactions());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل عمليات Paylink.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter === "PAID" && row.status !== "PAID") return false;
      if (statusFilter === "PENDING" && !["PENDING", "PROCESSING"].includes(row.status))
        return false;
      if (statusFilter === "FAILED" && !["FAILED", "CANCELED"].includes(row.status))
        return false;
      if (!needle) return true;
      return [
        row.transactionNo,
        row.orderNumber,
        row.planKey,
        row.userEmail,
        row.userName,
        row.licenseKey,
        row.licenseId,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [rows, query, statusFilter]);

  const summary = useMemo(() => {
    const paid = rows.filter((row) => row.status === "PAID");
    return {
      count: rows.length,
      paid: paid.length,
      pending: rows.filter((row) => ["PENDING", "PROCESSING"].includes(row.status)).length,
      failed: rows.filter((row) => ["FAILED", "CANCELED"].includes(row.status)).length,
      revenue: paid.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      currency: paid[0]?.currency ?? "SAR",
    };
  }, [rows]);

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value);
    toast.success("تم النسخ");
  };

  return (
    <div className="grid gap-4">
      {/* KPI strip — the four numbers an operator scans first. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="إجمالي العمليات" value={String(summary.count)} />
        <StatCard
          label="عمليات مكتملة"
          value={String(summary.paid)}
          tone="ok"
        />
        <StatCard
          label="قيد الانتظار"
          value={String(summary.pending)}
          tone="warn"
        />
        <StatCard
          label="الإيراد المحصّل"
          value={`${summary.revenue.toFixed(2)} ${summary.currency}`}
          tone="ok"
        />
      </div>

      <Panel
        title="سجل معاملات Paylink وتراخيص Keygen"
        actions={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[11px] font-bold hover:bg-line-2 disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/5"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden />
            {loading ? "جارٍ التحديث…" : "تحديث السجلات"}
          </button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute end-3 top-1/2 size-3.5 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث برقم المعاملة أو الطلب أو العميل أو المفتاح…"
              className="h-9 w-full rounded-[8px] border border-line bg-white pe-9 ps-3 text-[12px] font-bold outline-none focus:border-navy dark:border-white/10 dark:bg-[#161c26]"
            />
          </label>
          <div className="flex items-center gap-1 rounded-[8px] border border-line p-1 dark:border-white/10">
            {(
              [
                ["ALL", "الكل"],
                ["PAID", "مدفوعة"],
                ["PENDING", "معلّقة"],
                ["FAILED", "فاشلة"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                className={cn(
                  "h-7 rounded-[6px] px-2.5 text-[11px] font-extrabold transition",
                  statusFilter === value
                    ? "bg-navy text-white"
                    : "text-muted hover:bg-line-2 dark:hover:bg-white/5",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-[10px] border border-line dark:border-white/10">
          <table className="w-full min-w-[1180px] text-right text-[11px]">
            <thead className="border-b border-line bg-paper/60 text-muted dark:border-white/10">
              <tr>
                <th className="p-2.5">رقم المعاملة</th>
                <th className="p-2.5">حالة الدفع</th>
                <th className="p-2.5">طريقة الدفع</th>
                <th className="p-2.5">الباقة</th>
                <th className="p-2.5">المبلغ</th>
                <th className="p-2.5">المستخدم</th>
                <th className="p-2.5">مفتاح الترخيص</th>
                <th className="p-2.5">حالة الترخيص</th>
                <th className="p-2.5">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const catalog = getCatalogPlan(row.planKey);
                const meta = paylinkStatusMeta(row.status);
                return (
                  <tr
                    key={row.id}
                    className="border-t border-line transition hover:bg-black/[0.02] dark:border-white/10 dark:hover:bg-white/[0.02]"
                  >
                    <td className="p-2.5">
                      <button
                        type="button"
                        onClick={() => copy(row.transactionNo || row.orderNumber)}
                        title="نسخ رقم المعاملة"
                        className="inline-flex items-center gap-1 font-mono text-[11px] font-bold hover:text-navy"
                        dir="ltr"
                      >
                        {row.transactionNo || "—"}
                        <Copy className="size-3 opacity-50" aria-hidden />
                      </button>
                      <div className="mt-0.5 font-mono text-[9px] text-muted" dir="ltr">
                        {row.orderNumber}
                      </div>
                    </td>
                    <td className="p-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold",
                          meta.className,
                        )}
                      >
                        {meta.label}
                      </span>
                      {row.paylinkOrderStatus && row.paylinkOrderStatus !== row.status && (
                        <div className="mt-0.5 text-[9px] text-muted" dir="ltr">
                          {row.paylinkOrderStatus}
                        </div>
                      )}
                      {row.lastError && (
                        <div className="mt-0.5 max-w-[180px] truncate text-[9px] text-danger">
                          {row.lastError}
                        </div>
                      )}
                    </td>
                    <td className="p-2.5 text-[10px] font-bold">
                      {row.paymentType
                        ? PAYLINK_PAYMENT_TYPE_LABELS[row.paymentType] ?? row.paymentType
                        : "—"}
                      {row.apiVersion && (
                        <span className="ms-1 rounded bg-line-2 px-1 py-0.5 text-[9px] font-extrabold text-muted dark:bg-white/10">
                          {row.apiVersion.toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td className="p-2.5">
                      <span className="font-bold">{catalog?.arabicName || row.planKey}</span>
                      <div className="mt-0.5 text-[9px] text-muted" dir="ltr">
                        {row.planKey}
                      </div>
                    </td>
                    <td className="p-2.5 font-bold tabular-nums">
                      {row.amount} {row.currency}
                    </td>
                    <td className="p-2.5">
                      <div className="flex flex-col">
                        <span className="font-bold">{row.userName || "عميل نَسَق"}</span>
                        <span className="text-[10px] text-muted" dir="ltr">
                          {row.userEmail || row.clientEmail || row.userId}
                        </span>
                      </div>
                    </td>
                    <td className="p-2.5">
                      {row.licenseKey ? (
                        <button
                          type="button"
                          onClick={() => copy(row.licenseKey as string)}
                          title="نسخ بادئة مفتاح الترخيص"
                          className="inline-flex items-center gap-1 font-mono text-[11px] font-bold hover:text-navy"
                          dir="ltr"
                        >
                          {row.licenseKey}-****
                          <Copy className="size-3 opacity-50" aria-hidden />
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                      {row.keygenLicenseId && (
                        <div
                          className="mt-0.5 max-w-[140px] truncate font-mono text-[9px] text-muted"
                          dir="ltr"
                          title={row.keygenLicenseId}
                        >
                          {row.keygenLicenseId}
                        </div>
                      )}
                    </td>
                    <td className="p-2.5">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-bold",
                          row.licenseStatus === "ACTIVE"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                            : "text-muted",
                        )}
                      >
                        {row.licenseStatus ||
                          (row.status === "PAID" ? "ACTIVE" : "—")}
                      </span>
                    </td>
                    <td className="p-2.5 text-muted">
                      {formatDate(row.createdAt)}
                      {row.paidAt && (
                        <div className="mt-0.5 text-[9px] text-emerald-700 dark:text-emerald-400">
                          سُدّدت {formatDate(row.paidAt)}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {loading && <p className="py-4 text-[12px] text-muted">جارٍ التحميل…</p>}
        {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
        {!loading && rows.length === 0 && <Empty>لا توجد عمليات Paylink بعد.</Empty>}
        {!loading && rows.length > 0 && filtered.length === 0 && (
          <Empty>لا توجد عمليات مطابقة للبحث.</Empty>
        )}
      </Panel>
    </div>
  );
}

/** Compact KPI card used by the Paylink ledger header. */
function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  return (
    <div className="rounded-[12px] border border-line bg-surface p-3 dark:border-white/10">
      <p className="text-[10px] font-bold text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-[18px] font-extrabold tabular-nums",
          tone === "ok" && "text-emerald-700 dark:text-emerald-400",
          tone === "warn" && "text-amber-700 dark:text-amber-400",
        )}
      >
        {value}
      </p>
    </div>
  );
}

type Tab = "requests" | "paylink" | "customers" | "plans" | "settings" | "audit";

const TABS: Array<{ id: Tab; label: string; icon: typeof Users }> = [
  { id: "requests", label: "طلبات الدفع اليدوية", icon: ReceiptText },
  { id: "paylink", label: "عمليات Paylink", icon: CreditCard },
  { id: "customers", label: "العملاء", icon: Users },
  { id: "plans", label: "الباقات", icon: Package },
  { id: "settings", label: "إعدادات الدفع", icon: Settings },
  { id: "audit", label: "سجل الإجراءات", icon: ScrollText },
];

/**
 * Administrative dashboard.
 *
 * Access is decided by the server twice over: `amIAdmin` gates what renders, and
 * every action below re-verifies authorization inside its server function. So a
 * customer who navigates straight to /admin sees the denial screen, and a
 * customer who calls an admin server function directly gets a 403 — the UI is
 * never the thing standing between them and customer data.
 */
export function AdminPage() {
  const { user, isPending } = useCurrentUserState();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("requests");

  useEffect(() => {
    if (isPending || !user) return;
    void amIAdmin()
      .then((result) => setAllowed(result.isAdmin))
      .catch(() => setAllowed(false));
  }, [isPending, user]);

  if (isPending || allowed === null) {
    return (
      <div className="min-h-screen bg-paper">
        <SiteHeader current="/admin" />
        <main className="mx-auto w-full max-w-6xl px-4 py-24">
          <p className="text-[13px] text-muted">جارٍ التحقق من الصلاحيات…</p>
        </main>
      </div>
    );
  }

  if (!user) return <RedirectToSignIn />;

  if (!allowed) {
    return (
      <div className="min-h-screen bg-paper">
        <SiteHeader current="/admin" />
        <main className="mx-auto w-full max-w-2xl px-4 py-24">
          <div className="rounded-[14px] border border-danger/30 bg-danger/5 p-6">
            <h1 className="text-lg font-extrabold text-danger">لا تملك صلاحية الوصول</h1>
            <p className="mt-2 text-[13px] leading-6">
              هذه الصفحة مخصّصة لإدارة المنصة فقط. إذا كنت تعتقد أن هذا خطأ، تواصل مع
              الإدارة.
            </p>
            <a
              href="/account"
              className="mt-4 inline-flex h-9 items-center rounded-[8px] border border-line bg-surface px-3 text-[12px] font-bold dark:border-white/10"
            >
              العودة إلى حسابي
            </a>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper dark:bg-[#111722]">
      <SiteHeader current="/admin" />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        {/*
         * Institutional masthead.
         *
         * An operations console should open by stating where you are and who is
         * signed in — the two facts an operator needs before approving anything
         * that spends the company's money. The licence console is a separate
         * route because minting a licence is a different authority from
         * approving a payment, and the two must never share a tab bar by
         * accident.
         */}
        <header className="overflow-hidden rounded-[14px] border border-line bg-white dark:border-white/10 dark:bg-[#161c26]">
          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-[10px] bg-navy/10 text-navy dark:bg-white/10 dark:text-gold-2">
                <LayoutDashboard className="size-5" aria-hidden />
              </span>
              <div>
                <p className="text-[10px] font-extrabold tracking-[0.18em] text-muted">
                  NASAQ · CONSOLE
                </p>
                <h1 className="text-[19px] font-extrabold">لوحة التحكم المؤسسية</h1>
                <p className="mt-0.5 text-[11px] text-muted">
                  مراجعة المدفوعات، إدارة العملاء والباقات، وسجل الإجراءات.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex max-w-[240px] items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[10px] font-bold text-muted dark:border-white/10">
                <ShieldCheck className="size-3 text-emerald-600" aria-hidden />
                <span className="truncate" dir="ltr">
                  {user.primaryEmail || user.displayName || user.id}
                </span>
              </span>
              <a
                href="/admin-licenses"
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-navy px-3 text-[12px] font-extrabold text-white"
              >
                <KeyRound className="size-3.5" aria-hidden />
                إدارة التراخيص
              </a>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-line bg-paper/60 px-5 py-2 text-[10px] text-muted dark:border-white/10">
            <span>
              مزوّد الدفع: <strong className="font-extrabold text-ink dark:text-white">Paylink</strong>
            </span>
            <span>
              Webhook:{" "}
              <code dir="ltr" className="font-bold">
                {PAYLINK_WEBHOOK_PATH}
              </code>{" "}
              (V2)
            </span>
            <span>
              جهة إصدار التراخيص:{" "}
              <strong className="font-extrabold text-ink dark:text-white">Keygen</strong>
            </span>
          </div>
        </header>

        <nav className="mt-5 flex flex-wrap gap-2 border-b border-line pb-3 dark:border-white/10">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={tab === item.id}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-[12px] font-extrabold transition",
                  tab === item.id
                    ? "bg-navy text-white"
                    : "text-muted hover:bg-line-2 dark:hover:bg-white/5",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="mt-5">
          {tab === "requests" && <RequestsTab />}
          {tab === "paylink" && <PaylinkTab />}
          {tab === "customers" && <CustomersTab />}
          {tab === "plans" && <PlansTab />}
          {tab === "settings" && <SettingsTab />}
          {tab === "audit" && <AuditTab />}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Panel({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-line bg-surface p-5 dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-extrabold text-muted">{title}</h2>
        {actions}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-[12px] text-muted">{children}</p>;
}

function Notice({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (!error && !ok) return null;
  return (
    <p
      role={error ? "alert" : "status"}
      className={cn(
        "mt-3 rounded-[10px] p-3 text-[12px] leading-6",
        error
          ? "border border-danger/30 bg-danger/5 text-danger"
          : "border border-ok/30 bg-ok/5 text-ok",
      )}
    >
      {error ?? ok}
    </p>
  );
}

// ── Requests ────────────────────────────────────────────────────────────────

function RequestsTab() {
  const [status, setStatus] = useState<PaymentRequestStatus | "ALL">("PENDING");
  const [rows, setRows] = useState<AdminPaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const result = await getAdminPaymentRequests({
        data: status === "ALL" ? {} : { status },
      });
      setRows(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر تحميل الطلبات.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(
    id: string,
    action: "approve" | "reject",
  ) {
    setBusy(id);
    setError(null);
    setOk(null);
    try {
      const adminNote = note[id]?.trim() || undefined;
      const result =
        action === "approve"
          ? await adminApprovePayment({ data: { requestId: id, adminNote } })
          : await adminRejectPayment({ data: { requestId: id, adminNote } });
      if (!result.ok) {
        setError(result.error ?? "تعذّر تنفيذ الإجراء.");
        return;
      }
      setOk(action === "approve" ? "تم اعتماد الدفعة وتفعيل الباقة." : "تم رفض الطلب.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      title="طلبات الدفع"
      actions={
        <div className="flex gap-1">
          {(["PENDING", "APPROVED", "REJECTED", "CANCELLED", "ALL"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                "cursor-pointer rounded-[8px] border px-2.5 py-1 text-[11px] font-bold",
                status === s
                  ? "border-navy bg-navy text-white"
                  : "border-line text-muted dark:border-white/10",
              )}
            >
              {s === "ALL" ? "الكل" : (PAYMENT_STATUS_META[s]?.label ?? s)}
            </button>
          ))}
        </div>
      }
    >
      {loading && <p className="text-[12px] text-muted">جارٍ التحميل…</p>}
      <Notice error={error} ok={ok} />
      {!loading && rows.length === 0 && <Empty>لا توجد طلبات في هذه الحالة.</Empty>}

      <ul className="grid gap-3">
        {rows.map((row) => {
          const meta = PAYMENT_STATUS_META[row.status] ?? PAYMENT_STATUS_META.PENDING;
          return (
            <li
              key={row.id}
              className="rounded-[12px] border border-line-2 p-4 dark:border-white/10"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <strong className="text-[13px] font-extrabold">
                    {row.userName ?? "—"}{" "}
                    <span dir="ltr" className="text-[11px] font-normal text-muted">
                      {row.userEmail ?? row.userId}
                    </span>
                  </strong>
                  <p className="mt-1 text-[11px] text-muted">
                    {row.isRenewal ? "تجديد — لديه وصول فعلي" : "أول اشتراك"}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-extrabold",
                    meta.className,
                  )}
                >
                  {meta.label}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                <Cell label="الباقة" value={row.planId} />
                <Cell label="المبلغ" value={formatPrice(row.amount, row.currency)} />
                <Cell label="طريقة الدفع" value={row.paymentMethod} />
                <Cell label="تاريخ الإرسال" value={formatDate(row.createdAt)} />
              </dl>

              <div className="mt-3 rounded-[8px] bg-paper p-2.5 text-[11px]">
                <div className="flex justify-between gap-3">
                  <span className="text-muted">رقم مرجع الحوالة</span>
                  <span dir="ltr" className="font-extrabold">
                    {row.paymentReference}
                  </span>
                </div>
                {row.customerNote && (
                  <p className="mt-1.5 border-t border-line-2 pt-1.5 dark:border-white/10">
                    ملاحظة العميل: {row.customerNote}
                  </p>
                )}
              </div>

              {row.status === "PENDING" ? (
                <div className="mt-3 grid gap-2">
                  <input
                    value={note[row.id] ?? ""}
                    onChange={(e) =>
                      setNote((prev) => ({ ...prev, [row.id]: e.target.value }))
                    }
                    maxLength={500}
                    placeholder="ملاحظة داخلية للعميل (اختياري)"
                    className="h-9 rounded-[8px] border border-line bg-surface px-3 text-[12px] dark:border-white/10"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy === row.id}
                      onClick={() => void act(row.id, "approve")}
                      className="h-9 cursor-pointer rounded-[8px] bg-ok px-4 text-[12px] font-extrabold text-white disabled:cursor-wait disabled:opacity-60"
                    >
                      {busy === row.id ? "…" : "اعتماد وتفعيل"}
                    </button>
                    <button
                      type="button"
                      disabled={busy === row.id}
                      onClick={() => void act(row.id, "reject")}
                      className="h-9 cursor-pointer rounded-[8px] border border-danger px-4 text-[12px] font-extrabold text-danger disabled:cursor-wait disabled:opacity-60"
                    >
                      رفض
                    </button>
                  </div>
                </div>
              ) : (
                row.adminNote && (
                  <p className="mt-3 text-[11px] text-muted">ملاحظة الإدارة: {row.adminNote}</p>
                )
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-extrabold">{value}</dd>
    </div>
  );
}

// ── Customers ───────────────────────────────────────────────────────────────

function CustomersTab() {
  const [rows, setRows] = useState<AdminCustomer[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const [customers, planList] = await Promise.all([
        getAdminCustomers(),
        getAdminPlans(),
      ]);
      setRows(customers);
      setPlans(planList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر تحميل العملاء.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(
    userId: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
  ) {
    setBusy(userId);
    setError(null);
    setOk(null);
    try {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "تعذّر تنفيذ الإجراء.");
        return;
      }
      setOk(successMessage);
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="العملاء">
      {loading && <p className="text-[12px] text-muted">جارٍ التحميل…</p>}
      <Notice error={error} ok={ok} />
      {!loading && rows.length === 0 && <Empty>لا يوجد عملاء بعد.</Empty>}

      <ul className="grid gap-3">
        {rows.map((row) => {
          const meta = ACCOUNT_STATUS_META[row.status] ?? ACCOUNT_STATUS_META.FREE;
          const busyRow = busy === row.userId;
          return (
            <li
              key={row.userId}
              className="rounded-[12px] border border-line-2 p-4 dark:border-white/10"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <strong className="text-[13px] font-extrabold">
                  {row.name ?? "—"}{" "}
                  <span dir="ltr" className="text-[11px] font-normal text-muted">
                    {row.email ?? row.userId}
                  </span>
                </strong>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-extrabold",
                    meta.className,
                  )}
                >
                  {meta.label}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                <Cell label="الباقة" value={row.planId ?? "—"} />
                <Cell label="ينتهي في" value={formatDate(row.expiresAt)} />
                <Cell label="طلب معلّق" value={String(row.pendingPayments)} />
                <Cell label="مسجّل منذ" value={formatDate(row.createdAt)} />
              </dl>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  disabled={busyRow}
                  defaultValue=""
                  onChange={(e) => {
                    const planId = e.target.value;
                    if (!planId) return;
                    e.target.value = "";
                    void run(
                      row.userId,
                      () =>
                        adminActivateCustomer({ data: { userId: row.userId, planId } }),
                      "تم تفعيل الباقة.",
                    );
                  }}
                  className="h-9 cursor-pointer rounded-[8px] border border-line bg-surface px-2 text-[12px] dark:border-white/10"
                >
                  <option value="">تفعيل / منح باقة…</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.arabicName} — {plan.durationDays} يوم
                    </option>
                  ))}
                </select>

                {row.planId && (
                  <button
                    type="button"
                    disabled={busyRow}
                    onClick={() =>
                      void run(
                        row.userId,
                        () =>
                          adminExtendSubscription({ data: { userId: row.userId, days: 30 } }),
                        "تم تمديد الاشتراك ٣٠ يوماً.",
                      )
                    }
                    className="h-9 cursor-pointer rounded-[8px] border border-line px-3 text-[12px] font-bold dark:border-white/10 disabled:cursor-wait"
                  >
                    تمديد ٣٠ يوم
                  </button>
                )}

                {row.status === "SUSPENDED" ? (
                  <button
                    type="button"
                    disabled={busyRow}
                    onClick={() =>
                      void run(
                        row.userId,
                        () => adminRestoreCustomer({ data: { userId: row.userId } }),
                        "تمت استعادة الوصول.",
                      )
                    }
                    className="h-9 cursor-pointer rounded-[8px] border border-ok px-3 text-[12px] font-bold text-ok disabled:cursor-wait"
                  >
                    استعادة
                  </button>
                ) : (
                  row.status !== "FREE" && (
                    <button
                      type="button"
                      disabled={busyRow}
                      onClick={() =>
                        void run(
                          row.userId,
                          () => adminSuspendCustomer({ data: { userId: row.userId } }),
                          "تم إيقاف الوصول.",
                        )
                      }
                      className="h-9 cursor-pointer rounded-[8px] border border-danger px-3 text-[12px] font-bold text-danger disabled:cursor-wait"
                    >
                      إيقاف
                    </button>
                  )
                )}

                <button
                  type="button"
                  disabled={busyRow}
                  onClick={() => {
                    const days = window.prompt("عدد أيام التمديد الإضافية:", "90");
                    if (!days) return;
                    const parsed = Number(days);
                    if (!Number.isInteger(parsed) || parsed <= 0) return;
                    void run(
                      row.userId,
                      () =>
                        adminExtendSubscription({
                          data: { userId: row.userId, days: parsed },
                        }),
                      "تم التمديد.",
                    );
                  }}
                  className="h-9 cursor-pointer rounded-[8px] border border-line px-3 text-[12px] font-bold dark:border-white/10 disabled:cursor-wait"
                >
                  تمديد مخصص
                </button>

                <button
                  type="button"
                  disabled={busyRow}
                  onClick={() => {
                    const date = window.prompt("تاريخ الانتهاء (YYYY-MM-DD):");
                    if (!date) return;
                    void run(
                      row.userId,
                      () =>
                        adminSetExpiration({
                          data: { userId: row.userId, expiresAt: `${date}T23:59:59Z` },
                        }),
                      "تم تحديث تاريخ الانتهاء.",
                    );
                  }}
                  className="h-9 cursor-pointer rounded-[8px] border border-line px-3 text-[12px] font-bold dark:border-white/10 disabled:cursor-wait"
                >
                  تحديد تاريخ الانتهاء
                </button>

                {plans.length > 0 && row.planId && (
                  <select
                    disabled={busyRow}
                    defaultValue=""
                    onChange={(e) => {
                      const planId = e.target.value;
                      if (!planId) return;
                      e.target.value = "";
                      void run(
                        row.userId,
                        () => adminChangePlan({ data: { userId: row.userId, planId } }),
                        "تم تغيير الباقة.",
                      );
                    }}
                    className="h-9 cursor-pointer rounded-[8px] border border-line bg-surface px-2 text-[12px] dark:border-white/10"
                  >
                    <option value="">تغيير الباقة…</option>
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.arabicName}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  type="button"
                  disabled={busyRow}
                  onClick={() =>
                    void run(
                      row.userId,
                      () =>
                        adminGrantAdmin({
                          data: { userId: row.userId, note: "مُنح من لوحة الإدارة" },
                        }),
                      "تم منح صلاحية الإدارة.",
                    )
                  }
                  className="h-9 cursor-pointer rounded-[8px] border border-line px-3 text-[12px] font-bold text-muted dark:border-white/10 disabled:cursor-wait"
                >
                  منح صلاحية إدارة
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ── Plans ───────────────────────────────────────────────────────────────────

function PlansTab() {
  const [rows, setRows] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { price: string; durationDays: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      setRows(await getAdminPlans());
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر تحميل الباقات.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(plan: Plan) {
    const d = draft[plan.id];
    const price = d?.price ?? plan.price;
    const durationDays = Number(d?.durationDays ?? plan.durationDays);
    setBusy(plan.id);
    setError(null);
    setOk(null);
    try {
      const result = await adminUpdatePlan({
        data: { planId: plan.id, price, durationDays },
      });
      if (!result.ok) {
        setError(result.error ?? "تعذّر الحفظ.");
        return;
      }
      setOk("تم حفظ الباقة.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled(plan: Plan) {
    setBusy(plan.id);
    setError(null);
    setOk(null);
    try {
      const result = await adminUpdatePlan({
        data: { planId: plan.id, enabled: !plan.enabled },
      });
      if (!result.ok) {
        setError(result.error ?? "تعذّر التحديث.");
        return;
      }
      setOk(plan.enabled ? "تم تعطيل الباقة." : "تم تفعيل الباقة.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="الباقات">
      {loading && <p className="text-[12px] text-muted">جارٍ التحميل…</p>}
      <Notice error={error} ok={ok} />
      <ul className="grid gap-3">
        {rows.map((plan) => {
          const d = draft[plan.id];
          return (
            <li
              key={plan.id}
              className="rounded-[12px] border border-line-2 p-4 dark:border-white/10"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-[13px] font-extrabold">
                  {plan.arabicName}{" "}
                  <span className="text-[11px] font-normal text-muted">({plan.name})</span>
                </strong>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-extrabold",
                    plan.enabled ? "bg-ok/15 text-ok" : "bg-line-2 text-muted",
                  )}
                >
                  {plan.enabled ? "متاحة" : "معطّلة"}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="grid gap-1">
                  <span className="text-[11px] text-muted">السعر ({plan.currency})</span>
                  <input
                    dir="ltr"
                    defaultValue={plan.price}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        [plan.id]: { durationDays: d?.durationDays ?? String(plan.durationDays), price: e.target.value },
                      }))
                    }
                    className="h-9 w-28 rounded-[8px] border border-line bg-surface px-2 text-[12px] tabular-nums dark:border-white/10"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] text-muted">المدة (يوم)</span>
                  <input
                    dir="ltr"
                    defaultValue={plan.durationDays}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        [plan.id]: { price: d?.price ?? plan.price, durationDays: e.target.value },
                      }))
                    }
                    className="h-9 w-24 rounded-[8px] border border-line bg-surface px-2 text-[12px] tabular-nums dark:border-white/10"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy === plan.id}
                  onClick={() => void save(plan)}
                  className="h-9 cursor-pointer rounded-[8px] bg-navy px-4 text-[12px] font-extrabold text-white disabled:cursor-wait disabled:opacity-60"
                >
                  {busy === plan.id ? "…" : "حفظ"}
                </button>
                <button
                  type="button"
                  disabled={busy === plan.id}
                  onClick={() => void toggleEnabled(plan)}
                  className="h-9 cursor-pointer rounded-[8px] border border-line px-3 text-[12px] font-bold dark:border-white/10 disabled:cursor-wait"
                >
                  {plan.enabled ? "تعطيل" : "تفعيل"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ── Payment settings ────────────────────────────────────────────────────────

function SettingsTab() {
  const [form, setForm] = useState<PaymentInstructions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        // Read through the customer-facing reader — the same values a customer
        // is shown, so the admin edits exactly what the customer will see.
        const { getPaymentInstructionsPublic } = await import(
          "@/lib/commercial/functions"
        );
        setForm(await getPaymentInstructionsPublic());
      } catch (err) {
        setError(err instanceof Error ? err.message : "تعذّر تحميل الإعدادات.");
      }
    })();
  }, []);

  if (!form) {
    return (
      <Panel title="إعدادات الدفع">
        <p className="text-[12px] text-muted">جارٍ التحميل…</p>
        <Notice error={error} />
      </Panel>
    );
  }

  const field = (
    key: keyof PaymentInstructions,
    label: string,
    dir?: "ltr",
  ) => (
    <label className="grid gap-1.5">
      <span className="text-[12px] font-extrabold">{label}</span>
      <input
        dir={dir}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="h-10 rounded-[10px] border border-line bg-surface px-3 text-[13px] dark:border-white/10"
      />
    </label>
  );

  return (
    <Panel title="إعدادات الدفع">
      <p className="text-[12px] leading-6 text-muted">
        هذه التعليمات تظهر للعميل عند اختيار الباقة. لا تُدخل أي بيانات سرية أو كلمات
        مرور — فقط بيانات الحساب البنكي المستلم.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {field("bankName", "اسم البنك")}
        {field("accountName", "اسم الحساب")}
        {field("iban", "IBAN", "ltr")}
      </div>
      <div className="mt-3 grid gap-3">
        <label className="grid gap-1.5">
          <span className="text-[12px] font-extrabold">التعليمات (عربي)</span>
          <textarea
            rows={3}
            value={form.instructionsAr}
            onChange={(e) => setForm({ ...form, instructionsAr: e.target.value })}
            className="rounded-[10px] border border-line bg-surface p-3 text-[13px] dark:border-white/10"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[12px] font-extrabold">التعليمات (English)</span>
          <textarea
            rows={3}
            dir="ltr"
            value={form.instructionsEn}
            onChange={(e) => setForm({ ...form, instructionsEn: e.target.value })}
            className="rounded-[10px] border border-line bg-surface p-3 text-[13px] dark:border-white/10"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void (async () => {
            setBusy(true);
            setError(null);
            setOk(null);
            try {
              const result = await adminUpdatePaymentSettings({ data: form });
              if (!result.ok) {
                setError(result.error ?? "تعذّر الحفظ.");
                return;
              }
              setOk("تم حفظ الإعدادات.");
            } finally {
              setBusy(false);
            }
          })()
        }
        className="mt-4 h-10 cursor-pointer rounded-[10px] bg-navy px-5 text-[12px] font-extrabold text-white disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
      </button>
      <Notice error={error} ok={ok} />
    </Panel>
  );
}

// ── Audit log ───────────────────────────────────────────────────────────────

function AuditTab() {
  const [rows, setRows] = useState<AdminAuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getAdminAuditLog()
      .then((entries) => setRows(entries))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "تعذّر تحميل السجل."),
      );
  }, []);

  return (
    <Panel title="سجل الإجراءات الحساسة">
      <Notice error={error} />
      {rows.length === 0 && !error && <Empty>لا توجد إجراءات مسجّلة.</Empty>}
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line-2 p-3 text-[11px] dark:border-white/10"
          >
            <span className="font-extrabold">{row.action}</span>
            <span className="text-muted">
              {row.targetType}: {row.targetId ?? "—"}
            </span>
            <span className="text-muted">بواسطة {row.adminUserId}</span>
            <span className="text-muted">{formatDate(row.createdAt)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}