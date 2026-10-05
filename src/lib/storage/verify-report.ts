/**
 * Presentational mapping for the admin object-storage verification card.
 *
 * Client-safe by construction: it imports nothing and mirrors the result shape
 * of `verifyObjectStorage` (`src/lib/storage/functions.ts`) structurally. The
 * card feeds it whatever that server function returned over its RPC and this
 * module decides how it is displayed — so the mapping is unit-testable without
 * a server, a bucket or a credential in sight.
 *
 * The mapping never invents content: every string it returns is either a fixed
 * label or copied verbatim from the report, which by design carries statuses,
 * counts and variable NAMES only — never a credential, an endpoint value, an
 * account id or an object key.
 */

/** One step of a verification report, exactly as the server function returns it. */
export interface StorageVerifyStepInput {
  step: string;
  ok: boolean;
  detail?: string;
}

/** Fixed labels for the step ids `verify.server.ts` emits (fallback: the id). */
const STEP_LABELS: Record<string, string> = {
  configured: "التهيئة",
  upload: "الرفع (PUT)",
  "signed-url-read": "قراءة عبر رابط موقّع",
  read: "قراءة مباشرة (GET)",
  delete: "الحذف والتحقق من الاختفاء",
  "db-tables": "جداول قاعدة البيانات",
  "db-metadata-insert+read": "إدراج صف البيانات الوصفية وقراءته بملكية المستخدم",
  "db-metadata-delete": "حذف صف البيانات الوصفية",
  "db-metadata": "تدفق البيانات الوصفية",
  "metadata-round-trip": "تدفق البيانات الوصفية",
  "ownership-prefix": "تأكيد بادئة الملكية",
};

/** How the active endpoint was derived — a source label, never the value. */
const ENDPOINT_SOURCE_LABELS: Record<"R2_ENDPOINT" | "R2_ACCOUNT_ID" | "none", string> = {
  R2_ENDPOINT: "من R2_ENDPOINT (صريح)",
  R2_ACCOUNT_ID: "مشتق من R2_ACCOUNT_ID",
  none: "غير متوفر",
};

/** The result shape of `verifyObjectStorage`, mirrored for the client side. */
export type StorageVerifyResultInput =
  | {
      ok: true;
      configured: boolean;
      report: {
        configured: boolean;
        provider: string | null;
        bucketDefault: boolean;
        endpointSource: "R2_ENDPOINT" | "R2_ACCOUNT_ID" | "none";
        missingVariables: string[];
        steps: StorageVerifyStepInput[];
        ok: boolean;
      };
      metadata: { ok: boolean; steps: StorageVerifyStepInput[] };
    }
  | { ok: false; reason: string; missingVariables?: string[] };

export interface StorageVerifyRowView {
  /** Stable key for list rendering (the raw step id). */
  key: string;
  /** Human label, Arabic for the known steps. */
  label: string;
  ok: boolean;
  detail?: string;
}

export interface StorageVerifySummaryChip {
  label: string;
  value: string;
}

export interface StorageVerifyView {
  state: "ready" | "failed" | "not_configured";
  headline: string;
  summary: StorageVerifySummaryChip[];
  rows: StorageVerifyRowView[];
  /** Variable NAMES still missing (only ever populated when not configured). */
  missingVariables: string[];
}

/**
 * Map a verification result to its card view.
 *
 * `ready` requires every step of BOTH halves to have passed: the object round
 * trip (upload → presigned read → direct read → delete) and the metadata round
 * trip. Anything less is `failed`, so a partial pass can never read as healthy.
 */
export function storageVerifyView(result: StorageVerifyResultInput): StorageVerifyView {
  if (!result.ok) {
    const notConfigured = result.reason === "not_configured";
    return {
      state: "not_configured",
      headline: notConfigured
        ? "التخزين السحابي غير مهيأ في هذا الـ runtime — المحرر يعمل بوضعه المحلي الأول كما هو مصمم."
        : `تعذر تشغيل الفحص (${result.reason}).`,
      summary: [],
      rows: [],
      missingVariables: notConfigured ? [...(result.missingVariables ?? [])] : [],
    };
  }

  const rows: StorageVerifyRowView[] = [...result.report.steps, ...result.metadata.steps].map(
    (step) => ({
      key: step.step,
      label: STEP_LABELS[step.step] ?? step.step,
      ok: step.ok,
      detail: step.detail,
    }),
  );
  const ready = result.report.ok && result.metadata.ok;
  return {
    state: ready ? "ready" : "failed",
    headline: ready
      ? "الدورة الكاملة نجحت داخل هذا النشر: رفع ← قراءة برابط موقّع ← قراءة مباشرة ← حذف."
      : "فشل جزء من الفحص داخل هذا النشر — راجع الخطوة الفاشلة أدناه.",
    summary: [
      { label: "المزوّد", value: result.report.provider ?? "-" },
      { label: "الـ endpoint", value: ENDPOINT_SOURCE_LABELS[result.report.endpointSource] },
      {
        label: "الحاوية",
        value: result.report.bucketDefault
          ? "nasaq-sa (الافتراضي في الكود)"
          : "اسم مضبوط عبر R2_BUCKET_NAME",
      },
    ],
    rows,
    missingVariables: [],
  };
}
