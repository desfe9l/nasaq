/**
 * NASAQ License — Admin license management panel.
 *
 * Protected by ADMIN_SECRET (server-side verification).
 * Create / view / revoke / reactivate / extend / assign licenses.
 */

import { useState, useCallback, useEffect } from "react";
import {
  adminCreateLicenseFn,
  adminListLicensesFn,
  adminRevokeLicenseFn,
  adminReactivateLicenseFn,
  extendLicenseFn,
  assignLicenseFn,
} from "@/lib/license/functions";
import type { License, LicenseType } from "@/lib/license/types";
import {
  Shield,
  Plus,
  Copy,
  Check,
  Ban,
  RotateCcw,
  Clock,
  User,
  RefreshCw,
} from "lucide-react";

const DURATIONS = [
  { label: "30 يوم", days: 30 },
  { label: "90 يوم", days: 90 },
  { label: "180 يوم", days: 180 },
  { label: "سنة (365 يوم)", days: 365 },
];

export default function AdminLicensePanel() {
  const [secret, setSecret] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<LicenseType>("PRO");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Trial creation duration (days)
  const [trialDays, setTrialDays] = useState(30);
  // PRO optional expiry (none or 1 year)
  const [proExpiry, setProExpiry] = useState<"none" | "year">("none");

  // Inline extend / assign state per license id
  const [extendState, setExtendState] = useState<Record<string, { open: boolean; days: number }>>({});
  const [assignState, setAssignState] = useState<Record<string, { open: boolean; userId: string }>>({});

  const loadLicenses = useCallback(async () => {
    if (!secret) return;
    setLoading(true);
    const result = await adminListLicensesFn({ data: { adminSecret: secret, offset: 0, limit: 100 } });
    if (result.error) {
      setError(String(result.error));
    } else {
      setLicenses(result.licenses as License[]);
      setTotal(result.total);
      setError(null);
    }
    setLoading(false);
  }, [secret]);

  useEffect(() => {
    if (authenticated) loadLicenses();
  }, [authenticated, loadLicenses]);

  const handleAuth = () => {
    if (secret.trim()) {
      setAuthenticated(true);
      setError(null);
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
    const expiresAt = computeExpiresAt();
    const result = await adminCreateLicenseFn({
      data: { adminSecret: secret, type: createType, expiresAt },
    });
    if (result.plainKey && typeof result.plainKey === "string") {
      setNewKey(result.plainKey);
      loadLicenses();
    } else if (result.error) {
      setError(String(result.error));
    }
  };

  const handleCopyKey = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRevoke = async (id: string) => {
    await adminRevokeLicenseFn({ data: { adminSecret: secret, licenseId: id } });
    loadLicenses();
  };

  const handleReactivate = async (id: string) => {
    await adminReactivateLicenseFn({ data: { adminSecret: secret, licenseId: id } });
    loadLicenses();
  };

  const handleExtend = async (id: string, days: number) => {
    await extendLicenseFn({ data: { adminSecret: secret, licenseId: id, daysToAdd: days } });
    loadLicenses();
    setExtendState((prev) => ({ ...prev, [id]: { open: false, days: 30 } }));
  };

  const handleAssign = async (id: string, userId: string) => {
    await assignLicenseFn({ data: { adminSecret: secret, licenseId: id, userId, activate: true } });
    loadLicenses();
    setAssignState((prev) => ({ ...prev, [id]: { open: false, userId: "" } }));
  };

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

  // Auth screen
  if (!authenticated) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-6">
        <div className="flex items-center gap-3">
          <Shield className="size-6 text-emerald-600" />
          <h1 className="text-xl font-bold">إدارة التراخيص</h1>
        </div>
        <div className="rounded-xl border border-line p-6 dark:border-white/10">
          <label className="mb-2 block text-sm font-bold">Admin Secret</label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="mb-3 w-full rounded-lg border border-line bg-transparent px-4 py-2.5 text-sm outline-none focus:border-emerald-500 dark:border-white/10"
            placeholder="أدخل مفتاح الإدارة"
            onKeyDown={(e) => e.key === "Enter" && handleAuth()}
          />
          <button
            type="button"
            onClick={handleAuth}
            disabled={!secret.trim()}
            className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            دخول الإدارة
          </button>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
        <p className="text-[11px] text-muted">
          أضف متغير البيئة <code>ADMIN_SECRET</code> في Vercel لتفعيل إدارة التراخيص.
        </p>
      </div>
    );
  }

  // Helpers
  const formatExpiry = (lic: License): React.ReactNode => {
    if (!lic.expiresAt) return <span className="text-muted">مدى الحياة</span>;
    const d = new Date(lic.expiresAt);
    const now = new Date();
    const expired = d < now;
    return (
      <span className={expired ? "text-red-700 font-bold" : "text-muted"}>
        {d.toLocaleDateString("ar")}
        {expired ? " (منتهي)" : ""}
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="size-6 text-emerald-600" />
          <div>
            <h1 className="text-xl font-bold">إدارة التراخيص</h1>
            <p className="text-sm text-muted">{total} ترخيص</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadLicenses}
            className="rounded-lg border border-line p-2 hover:bg-accent dark:border-white/10"
          >
            <RefreshCw className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
          >
            <Plus className="size-4" />
            إنشاء ترخيص
          </button>
        </div>
      </div>

      {/* New Key Display */}
      {newKey && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
              ✅ تم إنشاء الترخيص — انسخ المفتاح الآن (لن يظهر مرة أخرى)
            </p>
            <button
              type="button"
              onClick={() => setNewKey(null)}
              className="text-emerald-600 hover:text-emerald-800"
            >
              ✕
            </button>
          </div>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 rounded bg-white px-3 py-2 font-mono text-sm font-bold tracking-wider dark:bg-emerald-950"
              dir="ltr"
            >
              {newKey}
            </code>
            <button
              type="button"
              onClick={handleCopyKey}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Create Dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-line bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-[#1a2332]">
            <h3 className="mb-4 text-lg font-bold">إنشاء ترخيص جديد</h3>

            <label className="mb-2 block text-sm font-bold">نوع الترخيص</label>
            <select
              value={createType}
              onChange={(e) => setCreateType(e.target.value as LicenseType)}
              className="mb-4 min-w-0 rounded-lg border border-line bg-transparent px-4 py-2.5 text-sm outline-none dark:border-white/10"
            >
              <option value="FREE">مجاني (FREE)</option>
              <option value="TRIAL">تجريبي (TRIAL)</option>
              <option value="PRO">احترافي (PRO)</option>
              <option value="LIFETIME">مدى الحياة (LIFETIME)</option>
            </select>

            {createType === "TRIAL" && (
              <>
                <label className="mb-2 block text-sm font-bold">مدة التجربة</label>
                <select
                  value={trialDays}
                  onChange={(e) => setTrialDays(Number(e.target.value))}
                  className="mb-4 min-w-0 rounded-lg border border-line bg-transparent px-4 py-2.5 text-sm outline-none dark:border-white/10"
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
                <label className="mb-2 block text-sm font-bold">المدة (اختياري)</label>
                <select
                  value={proExpiry}
                  onChange={(e) => setProExpiry(e.target.value as "none" | "year")}
                  className="mb-4 min-w-0 rounded-lg border border-line bg-transparent px-4 py-2.5 text-sm outline-none dark:border-white/10"
                >
                  <option value="none">بدون انتهاء (غير محدود)</option>
                  <option value="year">سنة واحدة</option>
                </select>
              </>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCreate}
                className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
              >
                إنشاء
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-line px-4 py-2.5 text-sm font-bold hover:bg-accent dark:border-white/10"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Licenses Table */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted">جارٍ التحميل...</div>
      ) : licenses.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted">لا توجد تراخيص.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line dark:border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-accent/50 dark:border-white/10">
                <th className="px-4 py-3 text-right font-bold">المفتاح</th>
                <th className="px-4 py-3 text-right font-bold">النوع</th>
                <th className="px-4 py-3 text-right font-bold">الحالة</th>
                <th className="px-4 py-3 text-right font-bold">المستخدم</th>
                <th className="px-4 py-3 text-right font-bold">ينتهي</th>
                <th className="px-4 py-3 text-right font-bold">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {licenses.map((lic) => (
                <tr key={lic.id} className="border-b border-line last:border-0 dark:border-white/10">
                  <td className="px-4 py-3 font-mono text-xs font-bold" dir="ltr">
                    {lic.keyPrefix}-****
                  </td>
                  <td className="px-4 py-3 font-bold">{lic.type}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${statusBadgeClass(lic.status)}`}>
                      {lic.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{lic.userId ?? "—"}</td>
                  <td className="px-4 py-3">{formatExpiry(lic)}</td>
                  <td className="px-4 py-3">
                    {/* Extend */}
                    {extendState[lic.id]?.open ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={1}
                          value={extendState[lic.id].days}
                          onChange={(e) =>
                            setExtendState((p) => ({
                              ...p,
                              [lic.id]: { ...p[lic.id]!, days: Number(e.target.value) || 30 },
                            }))
                          }
                          className="h-8 w-16 rounded border border-line bg-transparent px-2 text-center text-[11px] font-bold outline-none dark:border-white/10"
                        />
                        <button
                          type="button"
                          onClick={() => handleExtend(lic.id, extendState[lic.id]!.days)}
                          className="text-[11px] text-emerald-700 dark:text-emerald-400"
                          title="تمديد"
                        >
                          تمديد +{extendState[lic.id]!.days} يوم
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setExtendState((p) => ({ ...p, [lic.id]: { open: false, days: 30 } }))
                          }
                          className="text-[11px] text-muted"
                        >
                          إلغاء
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setExtendState((p) => ({ ...p, [lic.id]: { open: true, days: 30 } }))
                        }
                        className="text-[11px] text-muted hover:underline"
                        title="تمديد الترخيص"
                      >
                        <Clock className="inline size-3 mr-0.5" />
                        تمديد
                      </button>
                    )}

                    {/* Assign */}
                    {assignState[lic.id]?.open ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={assignState[lic.id].userId}
                          onChange={(e) =>
                            setAssignState((p) => ({
                              ...p,
                              [lic.id]: { ...p[lic.id]!, userId: e.target.value },
                            }))
                          }
                          placeholder="user id"
                          className="h-8 min-w-[110px] rounded border border-line bg-transparent px-2 text-[11px] font-mono outline-none dark:border-white/10"
                          dir="ltr"
                        />
                        <button
                          type="button"
                          disabled={!assignState[lic.id]!.userId.trim()}
                          onClick={() => handleAssign(lic.id, assignState[lic.id]!.userId)}
                          className="disabled:text-muted text-[11px] text-emerald-700 dark:text-emerald-400"
                          title="تعيين لمستخدم"
                        >
                          <User className="inline size-3 mr-0.5" />
                          تعيين
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setAssignState((p) => ({ ...p, [lic.id]: { open: false, userId: "" } }))
                          }
                          className="text-[11px] text-muted"
                        >
                          إلغاء
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setAssignState((p) => ({ ...p, [lic.id]: { open: true, userId: "" } }))
                        }
                        className="text-[11px] text-muted hover:underline"
                        title="تعيين لمستخدم"
                      >
                        <User className="inline size-3 mr-0.5" />
                        تعيين
                      </button>
                    )}

                    {/* Revoke / Reactivate */}
                    {lic.status === "ACTIVE" && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(lic.id)}
                        className="flex items-center gap-0.5 text-[11px] text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                        title="إلغاء"
                      >
                        <Ban className="size-3" />
                        إلغاء
                      </button>
                    )}
                    {(lic.status === "REVOKED" || lic.status === "EXPIRED") && (
                      <button
                        type="button"
                        onClick={() => handleReactivate(lic.id)}
                        className="flex items-center gap-0.5 text-[11px] text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded"
                        title="إعادة تفعيل"
                      >
                        <RotateCcw className="size-3" />
                        إعادة تفعيل
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
