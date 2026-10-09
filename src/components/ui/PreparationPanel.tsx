import { Loader2, CheckCircle2, XCircle, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type PrepStatus =
  | "preparing"
  | "processing"
  | "synchronizing"
  | "completed"
  | "failed";

const STATUS_ICONS: Record<
  PrepStatus,
  React.ComponentType<{ className?: string }>
> = {
  preparing: PauseCircle,
  processing: Loader2,
  synchronizing: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
};

const STATUS_TONES: Record<
  PrepStatus,
  "pending" | "ok" | "danger" | "warn"
> = {
  preparing: "pending",
  processing: "pending",
  synchronizing: "pending",
  completed: "ok",
  failed: "danger",
};

const STATUS_LABELS: Record<PrepStatus, { title: string; text: string }> = {
  preparing: {
    title: "جارٍ التحضير",
    text: "يتم إعداد الملف وتهيئته للمعالجة.",
  },
  processing: {
    title: "جارٍ المعالجة",
    text: "يعمل المحرر على إنشاء المستند الخاص بك.",
  },
  synchronizing: {
    title: "جارٍ المزامنة",
    text: "يتم حفظ المستند محليًا ومزامنته مع الخادم.",
  },
  completed: {
    title: "مكتمل",
    text: "اكتمل العمل بنجاح.",
  },
  failed: {
    title: "خطأ",
    text: "تعذر إكمال العملية. يرج إعادة المحاولة.",
  },
};

/**
 * Balanced preparation / processing status panel.
 *
 * Shows a calm icon, a concise Arabic title, supporting text, and optional
 * measurable progress (never a fake percentage). Distinct visual states for
 * each phase per the document-status contract.
 */
export function PreparationPanel({
  status = "processing",
  title,
  text,
  progress,
  progressLabel,
  retry,
  className,
}: {
  status?: PrepStatus;
  title?: string;
  text?: string;
  /** 0–100, or `null` for indeterminate (spinner only). */
  progress?: number | null;
  progressLabel?: string;
  retry?: () => void;
  className?: string;
}) {
  const Icon = STATUS_ICONS[status];
  const tone = STATUS_TONES[status];
  const labels = STATUS_LABELS[status];
  const resolvedTitle = title ?? labels.title;
  const resolvedText = text ?? labels.text;

  return (
    <div
      className={cn(
        "nsq-prep",
        `is-${tone}`,
        status === "processing" || status === "synchronizing"
          ? "animate-pulse-subtle"
          : "",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy={status === "processing" || status === "synchronizing"}
    >
      <div
        className={cn(
          "nsq-prep-icon",
          status === "failed" && "bg-error/10 text-error",
          status === "completed" && "bg-ok/10 text-success",
        )}
      >
        {Icon && (
          <Icon
            className={cn(
              "size-5 shrink-0",
              status === "processing" || status === "synchronizing"
                ? "animate-spin"
                : "",
            )}
            aria-hidden
          />
        )}
      </div>
      <h3 className="nsq-prep-title">{resolvedTitle}</h3>
      <p className="nsq-prep-text">{resolvedText}</p>

      {progress != null && (
        <>
          <div className="nsq-prep-progress">
            <span
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
          {progressLabel && (
            <span className="text-[0.7rem] font-bold text-muted">
              {progressLabel}
            </span>
          )}
        </>
      )}

      {status === "failed" && retry && (
        <button
          type="button"
          onClick={retry}
          className="nsq-btn nsq-btn-ghost nsq-btn-sm mt-2"
        >
          إعادة المحاولة
        </button>
      )}
    </div>
  );
}
