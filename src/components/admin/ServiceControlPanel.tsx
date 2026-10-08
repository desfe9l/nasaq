/**
 * Owner operational control. One table inside the existing admin console.
 * The server re-checks the owner on every save; this panel does not decide.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getServiceControlFn, updateServiceControlFn } from "@/lib/control-plane/functions";
import {
  EXTERNAL_CONSTRAINTS,
  SERVICE_IDS,
  type ControlPatch,
  type ControlPlaneDocument,
  type ServiceId,
  type ServiceStatus,
} from "@/lib/control-plane/schema";
import type { ServiceHealth } from "@/lib/control-plane/decisions";

const LABELS: Record<ServiceId, string> = {
  authentication: "المصادقة",
  database: "قاعدة البيانات",
  storage: "التخزين",
  documents: "المستندات",
  templates: "القوالب",
  editor: "المحرر",
  ai: "الذكاء الاصطناعي",
  image_processing: "معالجة الصور",
  uploads: "الرفع",
  import_export: "الاستيراد والتصدير",
  admin: "الإدارة",
  background: "المعالجة الخلفية",
  polling: "الاستعلام الدوري",
  api: "واجهة البرمجة",
  users_teams: "المستخدمون والفرق",
};

const STATUS_LABEL: Record<ServiceStatus, string> = {
  enabled: "يعمل",
  disabled: "متوقف",
  degraded: "متدهور",
  unavailable: "غير متاح",
  provider_limited: "حد المزوّد",
  maintenance: "صيانة",
};

const LOCKED = new Set<ServiceId>(["authentication", "admin"]);

type View = {
  plane: ControlPlaneDocument;
  health: Record<ServiceId, ServiceHealth>;
  usage: { storageBytes: number | null };
  databaseUnavailable: boolean;
};

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

function limitOf(plane: ControlPlaneDocument, id: ServiceId): string {
  if (id === "ai") return `${plane.operations["ai:report"].userPerMinute}/د`;
  if (id === "image_processing") return `${plane.operations["ai:image"].userPerMinute}/د`;
  if (id === "uploads") return `${plane.operations["storage:upload"].userPerMinute}/د`;
  if (id === "storage" || id === "api") return `${plane.operations["storage:read"].userPerMinute}/د`;
  if (id === "polling") return `${Math.round(plane.pollingIntervalMs / 1000)} ث`;
  if (id === "background") return `${plane.backgroundConcurrency} معًا`;
  if (id === "documents" || id === "users_teams") return `${plane.projectLimit} مشاريع`;
  if (id === "editor") return `${plane.pageLimit} صفحات`;
  return `${plane.services[id].concurrency} معًا`;
}

function quotaOf(plane: ControlPlaneDocument, id: ServiceId): string {
  if (id === "storage" || id === "uploads") return formatBytes(plane.storageQuotaBytes);
  if (id === "ai" || id === "image_processing") return `${plane.aiDailyRequestBudget}/يوم`;
  if (id === "documents" || id === "editor" || id === "users_teams") return `${plane.projectLimit} / ${plane.pageLimit} ص`;
  if (id === "import_export") return formatBytes(plane.maxUploadBytes);
  return "—";
}

function usageOf(view: View, id: ServiceId): string {
  if (id === "storage" || id === "uploads") return formatBytes(view.usage.storageBytes);
  return "—";
}

export function ServiceControlPanel() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [projectLimit, setProjectLimit] = useState("");
  const [pageLimit, setPageLimit] = useState("");
  const [storageMiB, setStorageMiB] = useState("");
  const [aiPerMinute, setAiPerMinute] = useState("");

  const applyView = useCallback((next: View) => {
    setView(next);
    setProjectLimit(String(next.plane.projectLimit));
    setPageLimit(String(next.plane.pageLimit));
    setStorageMiB(String(Math.round(next.plane.storageQuotaBytes / (1024 * 1024))));
    setAiPerMinute(String(next.plane.operations["ai:report"].userPerMinute));
  }, []);

  const load = useCallback(async () => {
    const result = await getServiceControlFn();
    if (!result.ok) {
      setError("لا تملك صلاحية تعديل سياسة التشغيل.");
      return;
    }
    applyView(result);
  }, [applyView]);

  useEffect(() => {
    let alive = true;
    void load().catch(() => {
      if (alive) setError("تعذّر قراءة حالة الخدمات.");
    });
    return () => {
      alive = false;
    };
  }, [load]);

  async function save(key: string, patch: ControlPatch) {
    setBusy(key);
    try {
      const result = await updateServiceControlFn({ data: patch });
      if (!result.ok) {
        toast.error(result.reason === "database_unavailable" ? result.error : "رُفض التعديل.");
        return;
      }
      if (result.rejected.length) toast.message(`لم يُقبل: ${result.rejected.join("، ")}`);
      else toast.success("حُفظت سياسة التشغيل.");
      applyView(result);
    } catch {
      toast.error("تعذّر الحفظ. قاعدة البيانات لم تؤكد التغيير.");
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return <p className="text-[13px] text-error">{error}</p>;
  }
  if (!view) {
    return <p className="text-[13px] text-muted">جارٍ قراءة حالة الخدمات…</p>;
  }

  return (
    <div className="grid gap-4">
      {view.databaseUnavailable ? (
        <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] leading-6 text-ink">
          قاعدة البيانات غير متاحة. الحالة ظاهرة صراحة، وبقية الخدمات لم تُوقَف بسبب ذلك.
        </p>
      ) : null}

      <div className="grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-[11px] font-bold text-muted">
          حد المشاريع
          <input
            value={projectLimit}
            onChange={(event) => setProjectLimit(event.target.value)}
            inputMode="numeric"
            className="h-9 rounded-lg border border-line bg-paper px-2 text-[13px] font-extrabold text-ink"
          />
        </label>
        <label className="grid gap-1 text-[11px] font-bold text-muted">
          حد الصفحات
          <input
            value={pageLimit}
            onChange={(event) => setPageLimit(event.target.value)}
            inputMode="numeric"
            className="h-9 rounded-lg border border-line bg-paper px-2 text-[13px] font-extrabold text-ink"
          />
        </label>
        <label className="grid gap-1 text-[11px] font-bold text-muted">
          حصة التخزين (م.ب)
          <input
            value={storageMiB}
            onChange={(event) => setStorageMiB(event.target.value)}
            inputMode="numeric"
            className="h-9 rounded-lg border border-line bg-paper px-2 text-[13px] font-extrabold text-ink"
          />
        </label>
        <label className="grid gap-1 text-[11px] font-bold text-muted">
          طلبات الذكاء / دقيقة
          <input
            value={aiPerMinute}
            onChange={(event) => setAiPerMinute(event.target.value)}
            inputMode="numeric"
            className="h-9 rounded-lg border border-line bg-paper px-2 text-[13px] font-extrabold text-ink"
          />
        </label>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void save("scalars", {
              projectLimit: Number(projectLimit),
              pageLimit: Number(pageLimit),
              storageQuotaBytes: Number(storageMiB) * 1024 * 1024,
              operation: { id: "ai:report", userPerMinute: Number(aiPerMinute) },
            })
          }
          className="h-9 self-end rounded-lg bg-navy px-3 text-[12px] font-extrabold text-on-brand disabled:opacity-60 sm:col-span-2 lg:col-span-4"
        >
          حفظ الحدود
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-right text-[12.5px]">
          <thead className="bg-paper text-[10px] font-black tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 font-black">الخدمة</th>
              <th className="px-3 py-2 font-black">الحالة</th>
              <th className="px-3 py-2 font-black">الحد</th>
              <th className="px-3 py-2 font-black">الحصة</th>
              <th className="px-3 py-2 font-black">الاستخدام</th>
              <th className="px-3 py-2 font-black">الإجراء</th>
            </tr>
          </thead>
          <tbody>
            {SERVICE_IDS.map((id) => {
              const status = view.health[id]?.status ?? "enabled";
              const service = view.plane.services[id];
              return (
                <tr key={id} className="border-t border-line">
                  <td className="px-3 py-2 font-extrabold text-ink">{LABELS[id]}</td>
                  <td className="px-3 py-2 text-muted">{STATUS_LABEL[status]}</td>
                  <td className="px-3 py-2 text-ink" dir="ltr">{limitOf(view.plane, id)}</td>
                  <td className="px-3 py-2 text-ink" dir="ltr">{quotaOf(view.plane, id)}</td>
                  <td className="px-3 py-2 text-muted" dir="ltr">{usageOf(view, id)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {LOCKED.has(id) ? null : (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void save(id, { service: { id, enabled: !service.enabled } })}
                          className="h-8 rounded-lg border border-line px-2 text-[11px] font-extrabold text-ink"
                        >
                          {service.enabled ? "إيقاف" : "تشغيل"}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void save(`${id}-m`, { service: { id, maintenance: !service.maintenance } })}
                        className="h-8 rounded-lg border border-line px-2 text-[11px] font-extrabold text-ink"
                      >
                        {service.maintenance ? "إنهاء الصيانة" : "صيانة"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] leading-6 text-muted">
        حدود المزوّدين تبقى خارج نَسَق ولا تُطفئ خدمة أخرى:
        {EXTERNAL_CONSTRAINTS.map((item) => ` ${item.summary}`).join("")}
      </p>
    </div>
  );
}
