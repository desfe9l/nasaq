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

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminCreateLicenseFn,
  adminListLicensesFn,
  adminReactivateLicenseFn,
  adminRevokeLicenseFn,
  extendLicenseFn,
  superAdminAssignLicenseFn,
  superAdminSetLicenseExpiryFn,
} from "@/lib/license/functions";
import { adminBootstrapOwnerFn, adminLicenseAccessFn } from "@/lib/admin/functions";
import { LICENSE_TYPE_LABELS, type License, type LicenseType } from "@/lib/license/types";
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

export default function AdminLicensePanel() {
  const [checking, setChecking] = useState(true);
  const [access, setAccess] = useState<Access | null>(null);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<LicenseType>("PRO");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [trialDays, setTrialDays] = useState(30);
  const [proExpiry, setProExpiry] = useState<"none" | "year">("none");

  const [query, setQuery] = useState("");
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
    const result = await adminListLicensesFn({ data: { offset: 0, limit: 200 } });
    if (result.error) {
      setError(String(result.error));
    } else {
      setLicenses(result.licenses as License[]);
      setTotal(result.total);
      setError(null);
    }
    setLoading(false);
  }, []);

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

  useEffect(() => {
    void loadAccess();
  }, [loadAccess]);

  useEffect(() => {
    if (access?.isAdmin) void loadLicenses();
  }, [access, loadLicenses]);

  const bootstrap = async () => {
    setBusyId("bootstrap");
    try {
      const result = await adminBootstrapOwnerFn();
      await loadAccess();
      if (!result.ok && result.reason === "not_owner") {
        setError(
          "هذا الحساب غير مُعلن كمالك في إعدادات النشر. أضف NASAQ_OWNER_EMAIL أو NASAQ_SUPER_ADMIN_IDS ثم أعد المحاولة.",
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const computeExpiresAt = (): string | undefined => {
    if (createType === "TRIAL" && trialDays > 0) {
      return new Date(Date.now() + trialDays * 86400000).toISOString();
    }
    if (createType === "PRO" && proExpiry === "year") {
      return new Date(Date.now() + 365 * 86400000).toISOString();
    }
    return undefined;
  };

  const handleCreate = async () => {
    const result = await adminCreateLicenseFn({
      data: { type: createType, expiresAt: computeExpiresAt() },
    });
    if (result.plainKey && typeof result.plainKey === "string") {
      setNewKey(result.plainKey);
      setShowCreate(false);
      void loadLicenses();
    } else if (result.error) {
      setError(String(result.error));
    }
  };

  const handleCopyKey = () => {
    if (newKey) {
      void navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const withBusy = async (id: string, run: () => Promise<void>) => {
    setBusyId(id);
    try {
      await run();
    } finally {
      setBusyId(null);
      void loadLicenses();
    }
  };

  const handleRevoke = (id: string) =>
    withBusy(id, async () => {
      await adminRevokeLicenseFn({ data: { licenseId: id } });
    });

  const handleReactivate = (id: string) =>
    withBusy(id, async () => {
      await adminReactivateLicenseFn({ data: { licenseId: id } });
    });

  const handleExtend = (id: string, days: number) =>
    withBusy(id, async () => {
      await extendLicenseFn({ data: { licenseId: id, daysToAdd: days } });
      setExtendState((prev) => ({ ...prev, [id]: { open: false, days: 30 } }));
    });

  const handleSetExpiry = (id: string, value: string) =>
    withBusy(id, async () => {
      const iso = value ? new Date(`${value}T23:59:59.000Z`).toISOString() : null;
      await superAdminSetLicenseExpiryFn({ data: { licenseId: id, expiresAt: iso } });
      setExpiryState((prev) => ({ ...prev, [id]: { open: false, value } }));
    });

  /**
   * Assignment accepts an EMAIL or a user id.
   *
   * The operator's mental object is "the person who paid", not "row 47 in
   * `user`"; making them leave this screen to look up an id is how manual
   * activations get applied to the wrong account.
   */
  const handleAssign = (id: string, user: string) =>
    withBusy(id, async () => {
      const result = await superAdminAssignLicenseFn({
        data: { licenseId: id, user, activate: true },
      });
      if (result.error) {
        setError(String(result.error));
        return;
      }
      setAssignState((prev) => ({ ...prev, [id]: { open: false, user: "" } }));
    });

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return licenses.filter((lic) => {
      if (statusFilter !== "ALL" && lic.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        lic.keyPrefix.toLowerCase().includes(needle) ||
        (lic.userId ?? "").toLowerCase().includes(needle) ||
        lic.type.toLowerCase().includes(needle) ||
        (lic.metadata?.source ?? "").toLowerCase().includes(needle)
      );
    });
  }, [licenses, query, statusFilter]);

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

  const formatExpiry = (lic: License) => {
    if (!lic.expiresAt) return <span className="text-muted">مدى الحياة</span>;
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
                  لوحة المالك — {total} ترخيص مسجل في منصة نَسَق
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
                    : "صلاحيات إدارية — لا تشمل إنشاء التراخيص"
                }
              >
                {access.isSuperAdmin ? (
                  <Crown className="size-3" aria-hidden />
                ) : (
                  <ShieldCheck className="size-3" aria-hidden />
                )}
                {access.isSuperAdmin ? "مالك (SUPER_ADMIN)" : "مدير (ADMIN)"}
              </span>
              <button
                type="button"
                onClick={() => void loadLicenses()}
                disabled={loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-line px-3 text-[12px] font-bold hover:bg-line-2 disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/5"
              >
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden />
                تحديث
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-emerald-600 px-3 text-[12px] font-extrabold text-white hover:bg-emerald-700"
              >
                <Plus className="size-4" aria-hidden />
                إنشاء ترخيص
              </button>
            </div>
          </div>
        </header>

        {error && (
          <p className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
            {error}
          </p>
        )}

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
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بالبادئة أو المستخدم أو المصدر…"
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
                onClick={() => setStatusFilter(value)}
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
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted">
                    لا توجد تراخيص مطابقة.
                  </td>
                </tr>
              )}
              {!loading &&
                visible.map((lic) => (
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
                    </td>
                    <td className="p-3 text-[11px] text-muted">
                      {lic.metadata?.source === "keygen" ? "Keygen" : "يدوي"}
                    </td>
                    <td className="p-3">
                      {assignState[lic.id]?.open ? (
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
                              [lic.id]: { open: true, user: lic.userId ?? "" },
                            }))
                          }
                          className="max-w-[190px] truncate text-[11px] text-muted hover:text-emerald-700 hover:underline"
                          title="تعيين الترخيص لمستخدم (بالبريد أو المعرّف)"
                        >
                          {lic.userId ?? "— غير معيّن —"}
                        </button>
                      )}
                    </td>
                    <td className="p-3">
                      {expiryState[lic.id]?.open ? (
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
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
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
                <label className="mb-2 block text-[12px] font-extrabold">المدة (اختياري)</label>
                <select
                  value={proExpiry}
                  onChange={(e) => setProExpiry(e.target.value as "none" | "year")}
                  className="mb-4 h-10 w-full rounded-[9px] border border-line bg-transparent px-3 text-[12px] font-bold outline-none focus:border-emerald-600 dark:border-white/10"
                >
                  <option value="none">بدون انتهاء (غير محدود)</option>
                  <option value="year">سنة واحدة</option>
                </select>
              </>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleCreate()}
                className="h-10 flex-1 rounded-[9px] bg-emerald-600 text-[13px] font-extrabold text-white hover:bg-emerald-700"
              >
                إنشاء
              </button>
              <button
                type="button"
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
