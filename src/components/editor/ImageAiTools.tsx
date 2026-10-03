import { useState } from "react";
import { Loader2, ScanText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { analyzeImageFn } from "@/lib/ai/image-functions";
import type { ImageAnalysis } from "@/lib/ai/image-contract";
import type { CanvasEl } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";

async function rasterDataUrl(src: string): Promise<string> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = src;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("image_load"));
  });
  if (!image.naturalWidth || !image.naturalHeight)
    throw new Error("image_load");
  const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("image_encode");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  let quality = 0.82;
  let data = canvas.toDataURL("image/jpeg", quality);
  while (data.length > 2_000_000 && quality > 0.46) {
    quality -= 0.08;
    data = canvas.toDataURL("image/jpeg", quality);
  }
  canvas.width = 0;
  canvas.height = 0;
  if (data.length > 2_000_000) throw new Error("image_size");
  return data;
}

export function ImageAiTools({
  el,
  pageId,
}: {
  el: CanvasEl;
  pageId: string;
}) {
  const addElementAt = useEditor((s) => s.addElementAt);
  const select = useEditor((s) => s.select);
  const entitlements = useEditor((s) => s.entitlements);
  const entitlementsResolved = useEditor((s) => s.entitlementsResolved);
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = entitlementsResolved && !entitlements.ai_report;

  const analyze = async () => {
    if (busy || !el.src) return;
    setBusy(true);
    try {
      const imageData = await rasterDataUrl(el.src);
      const result = await analyzeImageFn({
        data: { imageData, language: "ar" },
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setAnalysis(result.analysis);
      toast.success("اكتمل تحليل الصورة؛ راجع النص قبل إدراجه.");
    } catch {
      toast.error("تعذر تجهيز الصورة أو الاتصال بخدمة التحليل.");
    } finally {
      setBusy(false);
    }
  };

  const insertText = () => {
    const content = analysis?.recognizedText.trim();
    if (!content) return;
    const height = Math.min(120, Math.max(12, content.split("\n").length * 6));
    const inserted = addElementAt(
      "text",
      {
        name: "نص مستخرج من الصورة",
        content,
        w: Math.max(25, el.w),
        h: height,
        style: {
          fontFamily: "Tajawal",
          fontSize: 12,
          textBoxMode: "autoHeight",
          overflowVisible: true,
        },
      },
      { x: el.x + el.w / 2, y: el.y + el.h + height / 2 + 8 },
      pageId,
    );
    if (inserted) {
      select(inserted.id);
      toast.success("أُضيف النص كعنصر قابل للتحرير.");
    }
  };

  return (
    <div className="editor-subgroup">
      <h4 className="editor-subgroup-title">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-brand-hover" />
          قراءة الصورة
        </span>
      </h4>
      <p className="text-[10px] leading-4 text-muted">
        عند الطلب تُرسل نسخة مضغوطة للتحليل. تعرّف على النص والعناصر المرئية، ولا
        يتغير المستند حتى تدرج النص.
      </p>
      <button
        type="button"
        disabled={busy || locked || !el.src}
        onClick={() => void analyze()}
        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-[8px] border border-line text-[11px] font-extrabold disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ScanText className="size-4" />}
        {busy ? "جارٍ تحليل الصورة…" : "استخراج النص والتعرّف على العناصر"}
      </button>
      {locked && (
        <p className="text-[10px] leading-4 text-muted">
          تتطلب هذه الميزة ترخيصًا يتضمن أدوات الذكاء الاصطناعي.
        </p>
      )}
      {analysis && (
        <div className="grid gap-2">
          {analysis.description && (
            <p className="rounded-[8px] bg-surface-2 p-2 text-[11px] leading-5 text-ink">
              {analysis.description}
            </p>
          )}
          {analysis.objects.length > 0 && (
            <p className="text-[10px] leading-4 text-muted">
              العناصر: {analysis.objects.join("، ")}
            </p>
          )}
          {analysis.recognizedText && (
            <>
              <label className="grid gap-1 text-[10px] font-extrabold text-muted">
                النص المستخرج — قابل للمراجعة
                <textarea
                  rows={4}
                  value={analysis.recognizedText}
                  onChange={(event) =>
                    setAnalysis({ ...analysis, recognizedText: event.target.value })
                  }
                  className="w-full rounded-[8px] border border-line bg-surface px-2 py-1.5 text-[12px] font-semibold leading-5 text-ink"
                />
              </label>
              <button
                type="button"
                onClick={insertText}
                className="h-9 rounded-[8px] bg-navy text-[11px] font-extrabold text-white"
              >
                إدراج كنص قابل للتحرير
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
