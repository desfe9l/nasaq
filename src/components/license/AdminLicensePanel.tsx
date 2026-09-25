/**
 * NASAQ License — Owner & Super-Admin licence administration.
 *
 * The institutional console for licences: create, assign, extend, set an exact
 * expiry, suspend and reinstate. Every action is resolved on the server from the
 * verified session, so nothing here can be talked into granting access.
 *
 * ## The owner bypass
 *
 * This panel used to open with a single gate — `adminVerifyFn` — and answered
 * «هذا الحساب لا يملك صلاحية إدارة التراخيص» to the one person it exists for
 * whenever the database had no `admin_users` row for them. Being told "no" by
 * your own product, with no stated reason, is unfixable from the UI.
 *
 * Two changes repair it:
 *   1. the gate now reports a **diagnosis** (which signal recognised the
 *      identity, and which is missing) instead of a bare refusal;
 *   2. when the deployment already declares this identity as the owner, the
 *      panel offers «تفعيل صلاحيات المالك», which writes the missing
 *      `SUPER_ADMIN` row. The server refuses that for anyone else.
 */

import { useCallback, useEffect, useState } from "react";
import {
  adminCheckLicenseConnectionsFn,
  adminLicenseIntegrationsFn,
  adminCreateLicenseFn,
  adminListLicensesFn,
  adminReactivateLicenseFn,
  adminRevokeLicenseFn,
  extendLicenseFn,
  superAdminAssignLicenseFn,
  superAdminSetLicenseExpiryFn,
} from "@/lib/license/functions";
import { adminBootstrapOwnerFn, adminLicenseAccessFn } from "@/lib/admin/functions";
import { LICENSE_TYPE_LABELS, type AdminLicenseRow, type LicensePlan, type LicenseType } from "@/lib/license/types";
import { getCatalogPlan, listCatalogPlans } from "@/lib/commercial/catalog";
import {
  Ban,
  CalendarClock,
  Check,
  Copy,
  Crown,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Link2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const DURATIONS = [
  { label: "30 يوم", days: 30 },
  { label: "90 يوم", days: 90 },
  { label: "180 يوم", days: 180 },
  { label: "سنة (365 يوم)", days: 365 },
];

/** ISO date (yyyy-mm-dd) for an `<input type="date">` value. */
function toDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

type Access = Awaited<ReturnType<typeof adminLicenseAccessFn>>;
type Readiness = NonNullable<Awaited<ReturnType<typeof adminLicenseIntegrationsFn>>["readiness"]>;
const PAGE_SIZE = 50;

export default function AdminLicensePanel() {
  const [checking, setChecking] = useState(true);
  const [access, setAccess] = useState<Access | null>(null);
  const [licenses, setLicenses] = useState<AdminLicenseRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [connections, setConnections] = useState<{ keygen: boolean; paylink: boolean } | null>(null);
  const [checkingConnections, setCheckingConnections] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<LicenseType>("PRO");
  const [createPlan, setCreatePlan] = useState<LicensePlan>("individual-monthly");
  const [createUser, setCreateUser] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [trialDays, setTrialDays] = useState(30);

  const [query, setQuery] = useState(() => typeof window === "undefined" ? "" :
    new URLSearchParams(window.location.search).get("search")?.slice(0, 100) || "");
  const [search, setSearch] = useState(query);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "EXPIRED" | "REVOKED">(
    "ALL",
  );

  const [extendState, setExtendState] = useState<Record<string, { open: boolean; days: number }>>({});
  const [assignState, setAssignState] = useState<Record<string, { open: boolean; user: string }>>({});
  const [expiryState, setExpiryState] = useState<
    Record<string, { open: boolean; value: string }>
  >({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadLicenses = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminListLicensesFn({ data: {
        offset: page * PAGE_SIZE, limit: PAGE_SIZE, search, status: statusFilter,
      } });
      if (result.error) setError(result.error);
      else {
        setLicenses(result.licenses);
        setTotal(result.total);
      }
    } catch {
      setError("تعذر تحميل التراخيص. تحقق من اتصال قاعدة البيانات وأعد المحاولة.");
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  const loadAccess = useCallback(async () => {
    setChecking(true);
    try {
      setAccess(await adminLicenseAccessFn());
    } catch {
      setAccess(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { void loadAccess(); }, [loadAccess]);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (access?.isAdmin) void loadLicenses();
  }, [access?.isAdmin, loadLicenses]);
  useEffect(() => {
    if (!access?.isAdmin) return;
    void adminLicenseIntegrationsFn().then((result) => {
      if (result.readiness) setReadiness(result.readiness);
    }).catch(() => setReadiness(null));
  }, [access?.isAdmin]);

  const checkConnections = async () => {
    setCheckingConnections(true);
    setConnections(null);
    try {
      const result = await adminCheckLicenseConnectionsFn();
      if (result.error) setError(result.error);
      else setConnections({ keygen: result.keygen, paylink: result.paylink });
    } catch {
      setError("تعذر الاتصال بمزوّدي التفعيل. حاول مجددًا.");
    } finally {
      setCheckingConnections(false);
    }
  };

  const bootstrap = async () => {
    setBusyId("bootstrap");
    try {
      const result = await adminBootstrapOwnerFn();
      await loadAccess();
      if (!result.ok) setError("تعذر تفعيل صلاحيات المالك. تأكد من هوية الحساب في إعدادات النشر.");
    } catch {
      setError("تعذر التحقق من صلاحيات المالك. حاول مجددًا.");
    } finally {
      setBusyId(null);
    }
  };

  const computeExpiresAt = (): string | undefined => {
    const days = createType === "TRIAL" ? trialDays
      : createType === "PRO" ? getCatalogPlan(createPlan)?.durationDays : null;
    return days ? new Date(Date.now() + days * 86400000).toISOString() : undefined;
  };

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const result = await adminCreateLicenseFn({ data: {
        type: createType, plan: createType === "PRO" ? createPlan : undefined,
        user: createUser.trim() || undefined, expiresAt: computeExpiresAt(),
      } });
      if (result.plainKey) {
        setNewKey(result.plainKey);
        setCopied(false);
        setShowCreate(false);
        setNotice(createUser.trim()
          ? createType === "FREE" ? "تم إصدار الترخيص المجاني وربطه بحساب المستخدم."
            : "تم إصدار الترخيص وربطه بالمستخدم بعد التحقق لدى Keygen."
          : "تم إصدار الترخيص. انسخ المفتاح قبل مغادرة الصفحة.");
        setPage(0); setQuery(""); setSearch(""); setStatusFilter("ALL");
        void loadLicenses();
      } else setError(result.error || "تعذر إصدار الترخيص.");
    } catch {
      setError("تعذر إصدار الترخيص. تحقق من الاتصال وأعد المحاولة.");
    } finally {
      setCreating(false);
    }
  };

  const handleCopyKey = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("تعذر النسخ تلقائيًا؛ حدد المفتاح وانسخه يدويًا.");
    }
  };

  const withBusy = async (
    id: string, run: () => Promise<{ error: string | null }>,
    success: string, onSuccess?: () => void,
  ) => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const result = await run();
      if (result.error) {
        setError(result.error);
        return;
      }
      onSuccess?.();
      setNotice(success);
      await loadLicenses();
    } catch {
      setError("تعذر تنفيذ الإجراء. لم نؤكد التغيير لدى Keygen؛ أعد المحاولة بعد التحقق.");
    } finally {
      setBusyId(null);
    }
  };

  const handleRevoke = (id: string) =>
    withBusy(id, () => adminRevokeLicenseFn({ data: { licenseId: id } }), "تم إيقاف الترخيص لدى Keygen وفي المنصة.");

  const handleReactivate = (id: string) =>
    withBusy(id, () => adminReactivateLicenseFn({ data: { licenseId: id } }), "تمت إعادة تفعيل الترخيص.");

  const handleExtend = (id: string, days: number) =>
    withBusy(id, () => extendLicenseFn({ data: { licenseId: id, daysToAdd: days } }),
      "تم تمديد الترخيص ومزامنة Keygen.",
      () => setExtendState((prev) => ({ ...prev, [id]: { open: false, days: 30 } })));

  const handleSetExpiry = (id: string, value: string) =>
    withBusy(id, () => superAdminSetLicenseExpiryFn({
      data: { licenseId: id, expiresAt: value ? new Date(`${value}T23:59:59.000Z`).toISOString() : null },
    }), "تم تحديث تاريخ الانتهاء لدى Keygen وفي المنصة.",
    () => setExpiryState((prev) => ({ ...prev, [id]: { open: false, value } })));

  const handleAssign = (id: string, user: string) =>
    withBusy(id, () => superAdminAssignLicenseFn({
      data: { licenseId: id, user, activate: true },
    }), "تم ربط الترخيص بالحساب والتحقق من التفعيل.",
    () => setAssignState((prev) => ({ ...prev, [id]: { open: false, user: "" } })));

  const statusBadgeClass = (status: string): string => {
    switch (status) {
      case "ACTIVE":
        return "text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400";
      case "EXPIRED":
        return "text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400";
      case "REVOKED":
        return "text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-400";
      default:
        return "text-gray-600 bg-gray-100 dark:bg-gray-800 dark:text-gray-400";
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        جارٍ التحقق من صلاحيات المالك…
      </div>
    );
  }

  // ── Not authorized: explain WHY, and offer the one repair that is legal. ──
  if (!access?.isAdmin) {
    return (
      <div className="mx-auto max-w-2xl p-6" dir="rtl">
        <div className="rounded-[14px] border border-red-200 bg-red-50 p-6 dark:border-red-900/40 dark:bg-red-950/20">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="size-5 text-red-700 dark:text-red-300" aria-hidden />
            <h1 className="text-[15px] font-extrabold text-red-800 dark:text-red-200">
              هذا الحساب لا يملك صلاحية إدارة التراخيص
            </h1>
          </div>
          <ul className="mt-4 grid gap-1.5 text-[12px] leading-6 text-red-800/90 dark:text-red-200/90">
            <li>
              • المالك مُعرَّف في إعدادات النشر:{" "}
              <strong>{access?.ownerConfigured ? "نعم" : "لا"}</strong>
            </li>
            <li>
              • قائمة صلاحيات المالك (SUPER_ADMIN):{" "}
              <strong>{access?.superAdminConfigured ? "مهيأة" : "غير مهيأة"}</strong>
            </li>
            <li>
              • قائمة الإدارة العامة:{" "}
              <strong>{access?.adminConfigured ? "مهيأة" : "غير مهيأة"}</strong>
            </li>
            <li>
              • سجل في جدول admin_users:{" "}
              <strong>{access?.hasRow ? `نعم (${access.role ?? "ADMIN"})` : "لا"}</strong>
            </li>
          </ul>
          <p className="mt-4 text-[12px] leading-6 text-red-800/80 dark:text-red-200/80">
            أضف <code dir="ltr">NASAQ_OWNER_EMAIL</code> أو{" "}
            <code dir="ltr">NASAQ_SUPER_ADMIN_IDS</code> إلى متغيرات البيئة ثم أعد نشر
            المشروع، أو استخدم الزر أدناه إذا كان هذا الحساب هو المالك المُعلن بالفعل.
          </p>
          {access?.canBootstrap && (
            <button
              type="button"
              onClick={() => void bootstrap()}
              disabled={busyId === "bootstrap"}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-[9px] bg-red-700 px-4 text-[13px] font-extrabold text-white hover:bg-red-800 disabled:opacity-60"
            >
              {busyId === "bootstrap" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ShieldCheck className="size-4" aria-hidden />
              )}
              تفعيل صلاحيات المالك
            </button>
          )}
        </div>
      </div>
    );
  }

  const formatExpiry = (lic: AdminLicenseRow) => {
    if (!lic.expiresAt) return <span className="text-muted">{lic.type === "LIFETIME" ? "مدى الحياة" : "بدون تاريخ انتهاء"}</span>;
    const d = new Date(lic.expiresAt);
    const expired = d.getTime() < Date.now();
    return (
      <span className={expired ? "font-bold text-red-700 dark:text-red-400" : "text-muted"}>
        {d.toLocaleDateString("ar")}
        {expired ? " (منتهي)" : ""}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-paper px-4 py-6 dark:bg-[#111722] sm:px-6" dir="rtl">
      <div className="mx-auto max-w-6xl space-y-4">
        {/* Institutional header */}
        <header className="rounded-[14px] border border-line bg-white p-4 dark:border-white/10 dark:bg-[#161c26]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-[10px] bg-emerald-600/10 text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="size-5" aria-hidden />
              </span>
              <div>
                <h1 className="text-[17px] font-extrabold">إدارة التراخيص</h1>
                <p className="text-[11px] text-muted">
                  {total} ترخيص مطابق · Paylink → Keygen → حساب العميل
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-extrabold",
                  access.isSuperAdmin
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "border-line bg-surface text-muted dark:border-white/10",
                )}
                title={
                  access.isSuperAdmin
                    ? "صلاحيات مالك كاملة: إنشاء وتفعيل وتعيين التراخيص يدويًا"
                    : "صلاحية اطلاع فقط؛ إصدار وتعديل التراخيص للمالك"
                }
              >
                {access.isSuperAdmin ? (
                  <Crown className="size-3" aria-hidden />
                ) : (
                  <ShieldCheck className="size-3" aria-hidden />
                )}
                {access.isSuperAdmin ? "مالك (SUPER_ADMIN)" : "مدير — عرض فقط"}
              </span>
              <a href="/admin" className="inline-flex h-9 items-center rounded-[9px] border border-line px-3 text-[12px] font-bold hover:bg-line-2 dark:border-white/10 dark:hover:bg-white/5">لوحة الإدارة</a>
              <button
                type="button"
                onClick={() => void loadLicenses()}
                disabled={loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-line px-3 text-[12px] font-bold hover:bg-line-2 disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/5"
              >
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden />
                تحديث
              </button>
              {access.isSuperAdmin && (
                <button
                  type="button"
                  onClick={() => { setError(null); setShowCreate(true); }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-emerald-600 px-3 text-[12px] font-extrabold text-white hover:bg-emerald-700"
                >
                  <Plus className="size-4" aria-hidden />
                  إصدار ترخيص
                </button>
              )}
            </div>
          </div>
        </header>

        <section className="rounded-[14px] border border-line bg-white p-4 dark:border-white/10 dark:bg-[#161c26]" aria-label="جاهزية تكامل التراخيص">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link2 className="size-4 text-emerald-700" aria-hidden />
              <h2 className="text-[13px] font-extrabold">جاهزية التفعيل والربط</h2>
            </div>
            <button type="button" onClick={() => void checkConnections()} disabled={checkingConnections}
              className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-line px-3 text-[12px] font-bold hover:bg-line-2 disabled:opacity-50 dark:border-white/10">
              <RefreshCw className={cn("size-3.5", checkingConnections && "animate-spin")} aria-hidden />
              {checkingConnections ? "جارٍ اختبار الاتصال…" : "اختبار الاتصال دون إصدار أو دفع"}
            </button>
          </div>
          {readiness ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[10px] border border-line bg-paper/50 p-3 text-[12px] dark:border-white/10 dark:bg-white/[0.03]">
                <p className="font-extrabold">Keygen · جهة التفعيل</p>
                <p className="mt-2 text-muted">رمز API: {readiness.keygen.token ? "مضبوط" : "ناقص (KEYGEN_API_TOKEN)"} · توقيع Webhook: {readiness.keygen.webhookSignature ? "مضبوط" : "ناقص (KEYGEN_PUBLIC_KEY)"}</p>
                <p className="mt-1 text-muted">سياسات الباقات: {readiness.keygen.missingPolicies.length ? `تنقص ${readiness.keygen.missingPolicies.map((key) => getCatalogPlan(key)?.arabicName || key).join("، ")}` : "مهيأة"}</p>
                {connections && <p className={cn("mt-2 font-extrabold", connections.keygen ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>اتصال API: {connections.keygen ? "تم التحقق" : "فشل أو لم يُضبط"}</p>}
              </div>
              <div className="rounded-[10px] border border-line bg-paper/50 p-3 text-[12px] dark:border-white/10 dark:bg-white/[0.03]">
                <p className="font-extrabold">Paylink · بوابة الدفع</p>
                <p className="mt-2 text-muted">مفاتيح API: {readiness.paylink.credentials ? "مضبوطة" : "ناقصة (PAYLINK_API_ID / PAYLINK_SECRET_KEY)"}</p>
                <p className="mt-1 text-muted">رمز Webhook: {readiness.paylink.webhookToken ? "مضبوط" : "ناقص (PAYLINK_WEBHOOK_TOKEN)"} · رابط العودة: {readiness.paylink.publicUrl ? "مضبوط" : "غير مهيأ"}</p>
                {connections && <p className={cn("mt-2 font-extrabold", connections.paylink ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>اتصال API: {connections.paylink ? "تم التحقق" : "فشل أو لم يُضبط"}</p>}
              </div>
            </div>
          ) : <p className="mt-3 text-[12px] text-muted">جارٍ قراءة إعدادات التكامل…</p>}
          <p className="mt-3 text-[11px] leading-6 text-muted">
            {readiness?.checkoutConfigured ? "متغيرات الدفع والإصدار مكتملة." : "بعض متغيرات الدفع أو التفعيل ناقصة؛ تظل التراخيص اليدوية المحلية قابلة للإدارة."}
            {" "}اختبار الاتصال لا يثبت تسجيل Webhook لدى المزوّدين؛ سجّل
            <code dir="ltr"> /api/webhooks/paylink </code> (V2) و<code dir="ltr"> /api/webhooks/keygen </code>
            في لوحتي Paylink وKeygen. <a href="/owner-vault" className="font-bold text-emerald-700 underline dark:text-emerald-300">دليل إعدادات المالك</a>
          </p>
        </section>

        {error && <p role="alert" className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">{error}</p>}
        {notice && <p role="status" className="rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">{notice}</p>}

        {newKey && (
          <div className="rounded-[12px] border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[13px] font-bold text-emerald-700 dark:text-emerald-400">
                <Check className="size-4" aria-hidden />
                تم إنشاء الترخيص — انسخ المفتاح الآن (لن يظهر مرة أخرى)
              </p>
              <button
                type="button"
                onClick={() => setNewKey(null)}
                aria-label="إغلاق"
                className="text-emerald-600 hover:text-emerald-800"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 overflow-x-auto rounded-[8px] bg-white px-3 py-2 font-mono text-[13px] font-bold tracking-wider dark:bg-emerald-950"
                dir="ltr"
              >
                {newKey}
              </code>
              <button
                type="button"
                onClick={handleCopyKey}
                className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-emerald-600 text-white hover:bg-emerald-700"
                aria-label="نسخ المفتاح"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[200px] flex-1">
            <Search
              className="pointer-events-none absolute end-3 top-1/2 size-3.5 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              placeholder="ابحث بالمفتاح أو البريد أو رقم Paylink…"
              aria-label="بحث في كل التراخيص"
              className="h-9 w-full rounded-[9px] border border-line bg-white pe-9 ps-3 text-[12px] font-bold outline-none focus:border-emerald-600 dark:border-white/10 dark:bg-[#161c26]"
            />
          </label>
          <div className="flex items-center gap-1 rounded-[9px] border border-line p-1 dark:border-white/10">
            {(
              [
                ["ALL", "الكل"],
                ["ACTIVE", "نشط"],
                ["EXPIRED", "منتهي"],
                ["REVOKED", "موقوف"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => { setStatusFilter(value); setPage(0); }}
                className={cn(
                  "h-7 rounded-[7px] px-2.5 text-[11px] font-extrabold transition",
                  statusFilter === value
                    ? "bg-emerald-600 text-white"
                    : "text-muted hover:bg-line-2 dark:hover:bg-white/5",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Licences */}
        <div className="overflow-x-auto rounded-[14px] border border-line bg-white dark:border-white/10 dark:bg-[#161c26]">
          <table className="w-full min-w-[980px] text-right text-[12px]">
            <thead className="border-b border-line bg-paper/60 text-[11px] text-muted dark:border-white/10">
              <tr>
                <th className="p-3">المفتاح</th>
                <th className="p-3">النوع</th>
                <th className="p-3">الحالة</th>
                <th className="p-3">المصدر</th>
                <th className="p-3">المستخدم</th>
                <th className="p-3">ينتهي</th>
                <th className="p-3">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted">
                    جارٍ التحميل…
                  </td>
                </tr>
              )}
              {!loading && licenses.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted">
                    لا توجد تراخيص مطابقة.
                  </td>
                </tr>
              )}
              {!loading &&
                licenses.map((lic) => (
                  <tr
                    key={lic.id}
                    className="border-b border-line last:border-0 hover:bg-black/[0.02] dark:border-white/10 dark:hover:bg-white/[0.02]"
                  >
                    <td className="p-3 font-mono text-[11px] font-bold" dir="ltr">
                      {lic.keyPrefix}-****
                    </td>
                    <td className="p-3 font-bold">
                      {LICENSE_TYPE_LABELS[lic.type] ?? lic.type}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-extrabold ${statusBadgeClass(lic.status)}`}
                      >
                        {lic.status === "ACTIVE"
                          ? "نشط"
                          : lic.status === "EXPIRED"
                            ? "منتهي"
                            : "موقوف"}
                      </span>
                      {lic.metadata?.source === "keygen" && lic.userId && !lic.metadata.userScopeVerified && (
                        <span className="mt-1 block text-[10px] font-bold text-amber-700 dark:text-amber-300">بانتظار ربط Keygen</span>
                      )}
                    </td>
                    <td className="p-3 text-[11px] text-muted">
                      {lic.metadata?.source === "keygen" ? "Keygen" : "يدوي"}
                      {lic.metadata?.paylinkTransactionNo && <span className="mt-1 block max-w-[130px] truncate font-mono" dir="ltr" title={lic.metadata.paylinkTransactionNo}>{lic.metadata.paylinkTransactionNo}</span>}
                    </td>
                    <td className="p-3">
                      {!access.isSuperAdmin || (lic.metadata?.source === "keygen" && lic.userId && lic.metadata.userScopeVerified === lic.userId) ? (
                        <span className="max-w-[190px] truncate text-[11px]" title={lic.userEmail || lic.userId || "غير معيّن"}>{lic.userEmail || lic.userId || "— غير معيّن —"}</span>
                      ) : assignState[lic.id]?.open ? (
                        <div className="flex items-center gap-1">
                          <input
                            value={assignState[lic.id]!.user}
                            onChange={(e) =>
                              setAssignState((prev) => ({
                                ...prev,
                                [lic.id]: {
                                  open: true,
                                  user: e.target.value,
                                },
                              }))
                            }
                            placeholder="البريد أو معرّف المستخدم"
                            className="h-8 min-w-[150px] rounded-[7px] border border-line bg-transparent px-2 text-[11px] outline-none focus:border-emerald-600 dark:border-white/10"
                          />
                          <button
                            type="button"
                            disabled={!assignState[lic.id]!.user.trim() || busyId === lic.id}
                            onClick={() => void handleAssign(lic.id, assignState[lic.id]!.user)}
                            className="inline-flex h-8 items-center gap-1 rounded-[7px] bg-emerald-600 px-2 text-[11px] font-extrabold text-white disabled:opacity-50"
                          >
                            <UserPlus className="size-3" aria-hidden />
                            تعيين
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setAssignState((prev) => ({
                                ...prev,
                                [lic.id]: { open: false, user: "" },
                              }))
                            }
                            className="text-[11px] text-muted hover:underline"
                          >
                            إلغاء
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setAssignState((prev) => ({
                              ...prev,
                              [lic.id]: { open: true, user: lic.userEmail ?? lic.userId ?? "" },
                            }))
                          }
                          className="max-w-[190px] truncate text-[11px] text-muted hover:text-emerald-700 hover:underline"
                          title="تعيين الترخيص لمستخدم (بالبريد أو المعرّف)"
                        >
                          {lic.userEmail || lic.userId || "— غير معيّن —"}
                        </button>
                      )}
                    </td>
                    <td className="p-3">
                      {!access.isSuperAdmin ? formatExpiry(lic) : expiryState[lic.id]?.open ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="date"
                            value={expiryState[lic.id]!.value}
                            onChange={(e) =>
                              setExpiryState((prev) => ({
                                ...prev,
                                [lic.id]: { open: true, value: e.target.value },
                              }))
                            }
                            className="h-8 rounded-[7px] border border-line bg-transparent px-2 text-[11px] outline-none focus:border-emerald-600 dark:border-white/10"
                          />
                          <button
                            type="button"
                            disabled={busyId === lic.id}
                            onClick={() => void handleSetExpiry(lic.id, expiryState[lic.id]!.value)}
                            className="inline-flex h-8 items-center gap-1 rounded-[7px] bg-emerald-600 px-2 text-[11px] font-extrabold text-white disabled:opacity-50"
                          >
                            <CalendarClock className="size-3" aria-hidden />
                            حفظ
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setExpiryState((prev) => ({
                                ...prev,
                                [lic.id]: { open: false, value: "" },
                              }))
                            }
                            className="text-[11px] text-muted hover:underline"
                          >
                            إلغاء
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setExpiryState((prev) => ({
                              ...prev,
                              [lic.id]: { open: true, value: toDateInput(lic.expiresAt) },
                            }))
                          }
                          className="text-[11px] hover:underline"
                          title="تحديد تاريخ انتهاء دقيق"
                        >
                          {formatExpiry(lic)}
                        </button>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {!access.isSuperAdmin ? <span className="text-[11px] text-muted">للمالك فقط</span> : <>
                        {extendState[lic.id]?.open ? (
                          <div className="flex items-center gap-1">
                            <select
                              value={extendState[lic.id]!.days}
                              onChange={(e) =>
                                setExtendState((prev) => ({
                                  ...prev,
                                  [lic.id]: {
                                    open: true,
                                    days: Number(e.target.value) || 30,
                                  },
                                }))
                              }
                              className="h-8 rounded-[7px] border border-line bg-transparent px-2 text-[11px] font-bold outline-none dark:border-white/10"
                            >
                              {DURATIONS.map((d) => (
                                <option key={d.days} value={d.days}>
                                  {d.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={busyId === lic.id}
                              onClick={() => void handleExtend(lic.id, extendState[lic.id]!.days)}
                              className="h-8 rounded-[7px] bg-emerald-600 px-2 text-[11px] font-extrabold text-white disabled:opacity-50"
                            >
                              تمديد
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setExtendState((prev) => ({
                                  ...prev,
                                  [lic.id]: { open: false, days: 30 },
                                }))
                              }
                              className="text-[11px] text-muted hover:underline"
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setExtendState((prev) => ({
                                ...prev,
                                [lic.id]: { open: true, days: 30 },
                              }))
                            }
                            className="text-[11px] text-muted hover:text-emerald-700 hover:underline"
                          >
                            تمديد
                          </button>
                        )}
                        {lic.status === "ACTIVE" && (
                          <button
                            type="button"
                            disabled={busyId === lic.id}
                            onClick={() => void handleRevoke(lic.id)}
                            className="inline-flex items-center gap-1 text-[11px] text-red-700 hover:underline disabled:opacity-50 dark:text-red-400"
                          >
                            <Ban className="size-3" aria-hidden />
                            إيقاف
                          </button>
                        )}
                        {(lic.status === "REVOKED" || lic.status === "EXPIRED") && (
                          <button
                            type="button"
                            disabled={busyId === lic.id}
                            onClick={() => void handleReactivate(lic.id)}
                            className="inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400"
                          >
                            <RotateCcw className="size-3" aria-hidden />
                            إعادة تفعيل
                          </button>
                        )}
                        </>}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
          <span>عرض {total ? page * PAGE_SIZE + 1 : 0}–{Math.min((page + 1) * PAGE_SIZE, total)} من {total} ترخيص مطابق</span>
          <div className="flex gap-2">
            <button type="button" disabled={loading || page === 0} onClick={() => setPage((p) => p - 1)}
              className="h-9 rounded-[8px] border border-line px-3 font-bold disabled:opacity-40 dark:border-white/10">السابق</button>
            <button type="button" disabled={loading || (page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}
              className="h-9 rounded-[8px] border border-line px-3 font-bold disabled:opacity-40 dark:border-white/10">التالي</button>
          </div>
        </div>
      </div>

      {showCreate && access.isSuperAdmin && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="إنشاء ترخيص جديد"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreate(false);
          }}
        >
          <div className="w-full max-w-sm rounded-[14px] border border-line bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-[#1a2332]">
            <h3 className="mb-4 text-[14px] font-extrabold">إنشاء ترخيص جديد</h3>
            <label className="mb-2 block text-[12px] font-extrabold">نوع الترخيص</label>
            <select
              value={createType}
              onChange={(e) => setCreateType(e.target.value as LicenseType)}
              className="mb-4 h-10 w-full rounded-[9px] border border-line bg-transparent px-3 text-[12px] font-bold outline-none focus:border-emerald-600 dark:border-white/10"
            >
              {(Object.keys(LICENSE_TYPE_LABELS) as LicenseType[]).map((t) => (
                <option key={t} value={t}>
                  {LICENSE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>

            {createType === "TRIAL" && (
              <>
                <label className="mb-2 block text-[12px] font-extrabold">مدة التجربة</label>
                <select
                  value={trialDays}
                  onChange={(e) => setTrialDays(Number(e.target.value))}
                  className="mb-4 h-10 w-full rounded-[9px] border border-line bg-transparent px-3 text-[12px] font-bold outline-none focus:border-emerald-600 dark:border-white/10"
                >
                  {DURATIONS.map((d) => (
                    <option key={d.days} value={d.days}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </>
            )}

            {createType === "PRO" && (
              <>
                <label htmlFor="license-plan" className="mb-2 block text-[12px] font-extrabold">سياسة الترخيص وفترته</label>
                <select id="license-plan" value={createPlan} onChange={(e) => setCreatePlan(e.target.value as LicensePlan)}
                  className="mb-2 h-10 w-full rounded-[9px] border border-line bg-transparent px-3 text-[12px] font-bold outline-none focus:border-emerald-600 dark:border-white/10">
                  {listCatalogPlans().map((plan) => <option key={plan.key} value={plan.key}>{plan.arabicName} — {plan.durationDays} يومًا</option>)}
                </select>
                {readiness?.keygen.missingPolicies.includes(createPlan) &&
                  <p className="mb-3 text-[11px] font-bold text-amber-700">معرّف سياسة Keygen لهذه الباقة ناقص؛ أضفه لإصدار الترخيص.</p>}
              </>
            )}
            <label htmlFor="license-target" className="mb-2 block text-[12px] font-extrabold">حساب المستخدم (اختياري)</label>
            <input id="license-target" type="text" value={createUser} onChange={(e) => setCreateUser(e.target.value)}
              placeholder="البريد الإلكتروني أو معرّف الحساب" dir="auto" autoComplete="off"
              className="mb-2 h-10 w-full rounded-[9px] border border-line bg-transparent px-3 text-[12px] outline-none focus:border-emerald-600 dark:border-white/10" />
            <p className="mb-3 text-[11px] leading-5 text-muted">{createType === "FREE"
              ? "يربط الترخيص المجاني بالحساب محليًا، ولا يتطلب Keygen."
              : "تحديد حساب يربط الترخيص به لدى Keygen ويفعّله بعد التحقق. بدونه يُصدر مفتاح غير مخصص ويُفعّله صاحبه من صفحة الترخيص."}</p>
            {error && <p role="alert" className="mb-3 rounded-[8px] bg-red-50 p-2 text-[11px] font-bold text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={creating || (createType === "PRO" && readiness?.keygen.missingPolicies.includes(createPlan))}
                className="h-10 flex-1 rounded-[9px] bg-emerald-600 text-[13px] font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {creating ? "جارٍ الإصدار…" : createUser.trim() ? "إصدار وربط الترخيص" : "إصدار مفتاح"}
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => setShowCreate(false)}
                className="h-10 rounded-[9px] border border-line px-4 text-[13px] font-bold hover:bg-line-2 dark:border-white/10"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
