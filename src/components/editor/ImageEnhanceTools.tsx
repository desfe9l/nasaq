import { useState } from "react";
import { Eraser, Loader2, Maximize2, RotateCcw, Sparkles, Waves } from "lucide-react";
import { toast } from "sonner";
import type { CanvasEl } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import {
  describeEnhanceError,
  enhanceElementImage,
} from "@/lib/editor/image-enhance/enhance";
import type { EnhanceOp, EnhanceProgress, EnhanceStage } from "@/lib/editor/image-enhance/types";

interface ToolDef {
  op: EnhanceOp;
  label: string;
  hint: string;
  done: string;
  Icon: typeof Eraser;
}

const TOOLS: ToolDef[] = [
  {
    op: "background",
    label: "إزالة الخلفية",
    hint: "شفافية حقيقية حول الموضوع والشعر والحواف",
    done: "أُزيلت الخلفية وأصبحت الصورة شفافة",
    Icon: Eraser,
  },
  {
    op: "denoise",
    label: "إزالة الضجيج",
    hint: "تنعيم الحبيبات مع الحفاظ على التفاصيل",
    done: "أُزيل الضجيج من الصورة",
    Icon: Waves,
  },
  {
    op: "upscale",
    label: "ترقية الدقة ×4",
    hint: "مضاعفة أبعاد الصورة الفعلية أربع مرات",
    done: "رُقيت دقة الصورة",
    Icon: Maximize2,
  },
];

const STAGE_LABEL: Record<EnhanceStage, string> = {
  prepare: "تجهيز الصورة…",
  download: "تنزيل نموذج المعالجة…",
  model: "تحميل النموذج…",
  process: "معالجة الصورة…",
  encode: "حفظ النتيجة…",
};

type JobState =
  | { status: "running"; op: EnhanceOp; progress: EnhanceProgress }
  | { status: "error"; op: EnhanceOp; message: string };

/** Raster sources the engines accept (PNG/JPEG/WebP) — SVG stays out. */
function isRasterSrc(src: string | undefined): boolean {
  if (!src) return false;
  if (/^data:image\/(png|jpeg|jpg|webp)/i.test(src)) return true;
  if (/^(blob:|https?:\/\/)/i.test(src)) return true;
  return false;
}

export function ImageEnhanceTools({ el, pageId }: { el: CanvasEl; pageId: string }) {
  const patchElementOnPage = useEditor((s) => s.patchElementOnPage);
  const [job, setJob] = useState<JobState | null>(null);
  const running = job?.status === "running" ? job.op : null;
  const raster = isRasterSrc(el.src);
  const disabledBase = el.locked || !raster;

  const run = (tool: ToolDef) => {
    if (running || disabledBase || !el.src) return;
    const elementId = el.id;
    const source = el.src;
    const targetPage = pageId;
    const { op } = tool;
    setJob({ status: "running", op, progress: { stage: "prepare", value: 0 } });
    enhanceElementImage(op, elementId, source, (progress) => {
      setJob((current) =>
        current && current.status === "running" && current.op === op
          ? { ...current, progress }
          : current,
      );
    })
      .then(({ dataUrl }) => {
        const applied = patchElementOnPage(targetPage, elementId, { src: dataUrl });
        setJob(null);
        if (applied) {
          toast.success(`${tool.done} — التراجع (Undo) يعيد الصورة الأصلية.`);
        } else {
          toast.error("تعذر تطبيق النتيجة: العنصر لم يعد موجودًا في الصفحة.");
        }
      })
      .catch((err) => {
        setJob({ status: "error", op, message: describeEnhanceError(err) });
      });
  };

  const percent =
    job?.status === "running"
      ? Math.round(Math.min(1, Math.max(0, job.progress.value)) * 100)
      : 0;

  return (
    <div className="editor-subgroup">
      <h4 className="editor-subgroup-title">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-brand-hover" />
          تحسين الصورة الذكي
        </span>
      </h4>
      {!raster && el.src ? (
        <p className="text-[10px] leading-4 text-muted">
          المعالجة متاحة لصور PNG وJPEG وWebP فقط.
        </p>
      ) : (
        <p className="text-[10px] leading-4 text-muted">
          تُعالج الصور محليًا داخل متصفحك ولا تُرفع إلى أي خادم. النتيجة نسخة
          جديدة فوق الأصل، والتراجع يعيدها.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {TOOLS.map((tool) => {
          const isRunning = running === tool.op;
          const failed = job?.status === "error" && job.op === tool.op;
          return (
            <div key={tool.op} className="flex flex-col gap-1.5">
              <button
                type="button"
                disabled={disabledBase || running !== null}
                onClick={() => run(tool)}
                title={disabledBase ? "غير متاح لهذا العنصر" : tool.hint}
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-[8px] border border-line text-[11px] font-extrabold disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRunning ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <tool.Icon className="size-4" />
                )}
                {isRunning ? STAGE_LABEL[job?.status === "running" ? job.progress.stage : "prepare"] : tool.label}
                {isRunning ? ` ${percent}٪` : ""}
              </button>

              {isRunning && job?.status === "running" && (
                <div
                  role="progressbar"
                  aria-label={`تقدم ${tool.label}`}
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1.5 w-full overflow-hidden rounded-full bg-line"
                >
                  <div
                    className="h-full rounded-full bg-brand transition-[width] duration-200"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              )}

              {failed && job?.status === "error" && (
                <div className="flex flex-col gap-1 rounded-[8px] border border-error/30 bg-error/5 p-2">
                  <p className="text-[10px] leading-4 text-error">
                    {job.message}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => run(tool)}
                      className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-line px-2 text-[10px] font-bold"
                    >
                      <RotateCcw className="size-3" />
                      إعادة المحاولة
                    </button>
                    <button
                      type="button"
                      onClick={() => setJob(null)}
                      className="inline-flex h-7 items-center rounded-[6px] border border-line px-2 text-[10px] font-bold text-muted"
                    >
                      إخفاء
                    </button>
                  </div>
                </div>
              )}

            </div>
          );
        })}
      </div>
    </div>
  );
}
