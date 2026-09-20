/**
 * NASAQ License — License management page.
 *
 * Shows current plan, license status, and allows activation.
 * Fully consistent with NASAQ's existing design system.
 */

import { useState } from "react";
import { useLicense, getCachedLicenseKey } from "@/lib/license/client";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { BRAND } from "@/lib/brand";
import {
  Shield,
  CheckCircle2,
  XCircle,
  Clock,
  Key,
  ArrowLeft,
  Crown,
  Zap,
  Lock,
  Unlock,
} from "lucide-react";
import type { LicenseType, FeatureId } from "@/lib/license/types";
import { LICENSE_ENTITLEMENTS, FEATURE_LABELS } from "@/lib/license/types";

// ── Plan Display Config ────────────────────────────────────────────────────

const PLAN_CONFIG: Record<LicenseType, { name: string; icon: typeof Shield; color: string; bg: string }> = {
  FREE: { name: "مجاني", icon: Lock, color: "text-gray-600", bg: "bg-gray-100 dark:bg-gray-800" },
  TRIAL: { name: "تجريبي", icon: Zap, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/30" },
  PRO: { name: "PRO", icon: Crown, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/30" },
  LIFETIME: { name: "مدى الحياة", icon: Crown, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-900/30" },
};

// ── Component ──────────────────────────────────────────────────────────────

export default function LicensePage() {
  const user = useCurrentUser();
  const { hasLicense, license, entitlements, activate, deactivate, isLoading, error } = useLicense(user?.id);
  const [showActivate, setShowActivate] = useState(false);
  const [activateKey, setActivateKey] = useState("");
  const [activating, setActivating] = useState(false);
  const [activateMessage, setActivateMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const currentType: LicenseType = license?.type ?? "FREE";
  const config = PLAN_CONFIG[currentType];
  const PlanIcon = config.icon;

  const handleActivate = async () => {
    if (!activateKey.trim()) return;
    setActivating(true);
    setActivateMessage(null);
    const result = await activate(activateKey.trim());
    setActivateMessage({ type: result.success ? "success" : "error", text: result.message });
    setActivating(false);
    if (result.success) {
      setActivateKey("");
      setTimeout(() => setShowActivate(false), 1500);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
          <p className="text-sm text-muted">جارٍ تحميل بيانات الترخيص...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <a href="/" className="rounded-lg border border-line p-2 hover:bg-accent dark:border-white/10">
          <ArrowLeft className="size-4" />
        </a>
        <div>
          <h1 className="text-xl font-bold">الترخيص</h1>
          <p className="text-sm text-muted">إدارة ترخيص {BRAND.platform}</p>
        </div>
      </div>

      {/* Current Plan Card */}
      <div className={`rounded-xl border border-line p-6 dark:border-white/10 ${config.bg}`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`rounded-lg p-2 ${config.color}`}>
              <PlanIcon className="size-6" />
            </div>
            <div>
              <p className="text-sm text-muted">الخطة الحالية</p>
              <p className="text-lg font-bold">{config.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasLicense && license?.status === "ACTIVE" ? (
              <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                <CheckCircle2 className="size-3" />
                نشط
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                مجاني
              </span>
            )}
          </div>
        </div>

        {/* License Details */}
        {license && (
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {license.keyPrefix && (
              <div>
                <p className="text-muted">المفتاح</p>
                <p className="font-mono font-bold">{license.keyPrefix}-****</p>
              </div>
            )}
            {license.activatedAt && (
              <div>
                <p className="text-muted">تاريخ التفعيل</p>
                <p className="font-bold">{new Date(license.activatedAt).toLocaleDateString("ar")}</p>
              </div>
            )}
            {license.expiresAt && (
              <div>
                <p className="text-muted">تاريخ الانتهاء</p>
                <p className="font-bold">{new Date(license.expiresAt).toLocaleDateString("ar")}</p>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 flex gap-2">
          {!hasLicense && (
            <button
              type="button"
              onClick={() => setShowActivate(true)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
            >
              <Key className="mr-2 inline size-4" />
              تفعيل ترخيص
            </button>
          )}
          {hasLicense && (
            <button
              type="button"
              onClick={deactivate}
              className="rounded-lg border border-line px-4 py-2 text-sm font-bold hover:bg-accent dark:border-white/10"
            >
              إلغاء التفعيل المحلي
            </button>
          )}
        </div>
      </div>

      {/* Features Grid */}
      <div className="rounded-xl border border-line p-6 dark:border-white/10">
        <h2 className="mb-4 text-lg font-bold">الميزات</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(FEATURE_LABELS) as FeatureId[]).map((featureId) => {
            const feature = FEATURE_LABELS[featureId];
            const enabled = entitlements[featureId];
            return (
              <div
                key={featureId}
                className={`flex items-start gap-3 rounded-lg border p-3 ${
                  enabled
                    ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/10"
                    : "border-line bg-gray-50/50 opacity-60 dark:border-white/10 dark:bg-white/5"
                }`}
              >
                {enabled ? (
                  <Unlock className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <Lock className="mt-0.5 size-4 shrink-0 text-gray-400" />
                )}
                <div>
                  <p className="text-sm font-bold">{feature.name}</p>
                  <p className="text-xs text-muted">{feature.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Activation Dialog */}
      {showActivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-xl border border-line bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-[#1a2332]">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-lg bg-emerald-100 p-2 dark:bg-emerald-900/30">
                <Key className="size-5 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold">تفعيل الترخيص</h3>
                <p className="text-sm text-muted">أدخل مفتاح الترخيص لتفعيل الميزات المتقدمة.</p>
              </div>
            </div>

            <input
              type="text"
              value={activateKey}
              onChange={(e) => setActivateKey(e.target.value)}
              placeholder="NASAQ-XXXX-XXXX-XXXX-XXXX"
              className="mb-4 w-full rounded-lg border border-line bg-transparent px-4 py-3 text-center font-mono text-sm font-bold tracking-wider outline-none focus:border-emerald-500 dark:border-white/10"
              dir="ltr"
              onKeyDown={(e) => e.key === "Enter" && handleActivate()}
              autoFocus
            />

            {activateMessage && (
              <div
                className={`mb-4 rounded-lg p-3 text-sm font-bold ${
                  activateMessage.type === "success"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                    : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                }`}
              >
                {activateMessage.text}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleActivate}
                disabled={!activateKey.trim() || activating}
                className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {activating ? "جارٍ التفعيل..." : "تفعيل الترخيص"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowActivate(false);
                  setActivateKey("");
                  setActivateMessage(null);
                }}
                className="rounded-lg border border-line px-4 py-2.5 text-sm font-bold hover:bg-accent dark:border-white/10"
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
