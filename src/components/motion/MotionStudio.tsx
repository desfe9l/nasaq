/**
 * NASAQ Motion Studio.
 *
 * ## The one rule this component follows
 *
 * The preview canvas and the exported video are drawn by the **same**
 * `renderFrame()` call on the **same** `seek()` output. There is no separate
 * "preview renderer", no CSS-animated mock-up, and no placeholder timeline.
 *
 * That rule exists because the failure it prevents is specific and common: a
 * studio where the preview animates and the export is black. Here, if a frame
 * looks right on screen it is right in the file, because it is literally the
 * same pixels from the same function.
 *
 * ## Playback
 *
 * Playback advances a clock and re-seeks from scratch every frame. It does not
 * step an animation forward, because the engine has no internal state — so
 * scrubbing, jumping and resuming are all the same operation, and none of them
 * can drift out of sync with each other.
 *
 * ## Export
 *
 * Two real outputs, no fake buttons:
 *
 *  - **HTML composition** — a self-contained, seekable file, produced by
 *    `emitCompositionHtml()` in the browser. Downloads immediately.
 *  - **MP4** — rendered by `scripts/render-motion.mjs`, which needs ffmpeg and
 *    runs outside the browser. The button copies the exact command rather than
 *    pretending a browser can mux H.264.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  Download,
  Film,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Square,
} from "lucide-react";
import { toast } from "sonner";

import { renderFrame } from "@/lib/motion/canvas-render";
import { splitClusters } from "@/lib/motion/arabic-type";
import { emitCompositionHtml } from "@/lib/motion/html";
import { seek } from "@/lib/motion/render-frame";
import { periodOriginProblem, type TextMeasure } from "@/lib/motion/period-origin";
import {
  arabicLaunchTemplate,
  periodOriginTemplate,
  MOTION_TEMPLATES,
} from "@/lib/motion/templates";
import {
  compositionDuration,
  compositionFrameCount,
  compositionHeight,
} from "@/lib/motion/types";

/** Motion faces, scoped to the studio so no other surface pays for them. */
const MOTION_FONT_CSS = `
@font-face{font-family:"Tajawal";font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/motion/Tajawal-Regular.ttf) format("truetype")}
@font-face{font-family:"Tajawal";font-style:normal;font-weight:700;font-display:swap;src:url(/fonts/motion/Tajawal-Bold.ttf) format("truetype")}
@font-face{font-family:"Noto Naskh Arabic";font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/motion/NotoNaskhArabic-Regular.ttf) format("truetype")}
@font-face{font-family:"Noto Naskh Arabic";font-style:normal;font-weight:700;font-display:swap;src:url(/fonts/motion/NotoNaskhArabic-Bold.ttf) format("truetype")}
`;

const FONT_SOURCES = [
  { family: "Tajawal", weight: 400, src: "url(/fonts/motion/Tajawal-Regular.ttf)" },
  { family: "Tajawal", weight: 700, src: "url(/fonts/motion/Tajawal-Bold.ttf)" },
  {
    family: "Noto Naskh Arabic",
    weight: 400,
    src: "url(/fonts/motion/NotoNaskhArabic-Regular.ttf)",
  },
  {
    family: "Noto Naskh Arabic",
    weight: 700,
    src: "url(/fonts/motion/NotoNaskhArabic-Bold.ttf)",
  },
];

const formatTime = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 100) / 10);
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
};

/**
 * A canvas-backed text measure.
 *
 * Created once per canvas and reused for both the preview and the anchor
 * lookup, so the period-origin iris lands on exactly the glyph the browser
 * actually drew — not on an estimate.
 */
const useCanvasMeasure = (): TextMeasure => {
  const ref = useRef<CanvasRenderingContext2D | null>(null);
  return useCallback((text: string, fontSizePx: number) => {
    let ctx = ref.current;
    if (!ctx) {
      const probe = document.createElement("canvas");
      probe.width = 8;
      probe.height = 8;
      ctx = probe.getContext("2d");
      ref.current = ctx;
    }
    if (!ctx) return splitClusters(text).length * fontSizePx * 0.5;
    ctx.font = `700 ${fontSizePx}px "Tajawal", "Alexandria", sans-serif`;
    return ctx.measureText(text).width;
  }, []);
};

export function MotionStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const measure = useCanvasMeasure();

  const [templateId, setTemplateId] = useState(MOTION_TEMPLATES[0].id);
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);

  const template = useMemo(
    () => MOTION_TEMPLATES.find((t) => t.id === templateId) ?? MOTION_TEMPLATES[0],
    [templateId],
  );

  const [wordmark, setWordmark] = useState("نَسَق.");

  const composition = useMemo(() => {
    if (template.id === "period-origin") {
      return periodOriginTemplate({ wordmark, aspect: "square" });
    }
    if (template.id === "arabic-launch-square") {
      return arabicLaunchTemplate({ aspect: "square" });
    }
    return arabicLaunchTemplate({ aspect: "portrait" });
  }, [template.id, wordmark]);

  const anchorProblem =
    template.id === "period-origin" ? periodOriginProblem(wordmark) : null;

  const durationMs = composition ? compositionDuration(composition) : 0;
  const frameCount = composition ? compositionFrameCount(composition) : 0;

  // Reset the playhead when the composition changes, so the timeline never
  // points past the end of a newly selected template.
  useEffect(() => {
    setTimeMs(0);
    setPlaying(false);
  }, [composition]);

  /** Paint the current frame. Shared by playback, scrubbing and first paint. */
  const paint = useCallback(
    (at: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !composition) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const frame = seek(composition, at, { measure });
      renderFrame(ctx, frame);
    },
    [composition, measure],
  );

  useEffect(() => {
    paint(timeMs);
  }, [paint, timeMs]);

  // Playback loop. rAF drives a wall-clock offset and re-seeks each frame;
  // the engine stays stateless so nothing can drift.
  useEffect(() => {
    if (!playing || !composition) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      setTimeMs((prev) => {
        const next = prev + delta;
        if (next >= durationMs) {
          if (loop) return next % durationMs;
          setPlaying(false);
          return durationMs;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, durationMs, loop, composition]);

  const handleExportHtml = useCallback(() => {
    if (!composition) return;
    const html = emitCompositionHtml(composition, {
      title: composition.name,
      fonts: FONT_SOURCES,
      notes: `${composition.width}x${compositionHeight(composition)} @ ${composition.fps}fps — NASAQ Motion Studio`,
    });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${composition.id}.html`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("تم تنزيل ملف التكوين.");
  }, [composition]);

  const handleCopyRenderCommand = useCallback(async () => {
    if (!composition) return;
    const command = `node --experimental-strip-types scripts/render-motion.mjs --template ${template.id} --out ${composition.id}.mp4`;
    try {
      await navigator.clipboard.writeText(command);
      toast.success("نُسخ أمر إخراج الفيديو.");
    } catch {
      toast.error("تعذّر النسخ إلى الحافظة.");
    }
  }, [composition, template.id]);

  if (!composition || anchorProblem) {
    return (
      <section className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="flex items-start gap-3 rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-5">
          <CircleAlert
            aria-hidden
            className="mt-0.5 size-5 shrink-0 text-[var(--color-danger)]"
          />
          <div>
            <h2 className="text-base font-bold text-[var(--color-ink)]">
              لا يمكن بناء هذا القالب
            </h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">{anchorProblem}</p>
          </div>
        </div>
      </section>
    );
  }

  const width = composition.width;
  const height = compositionHeight(composition);
  const progress = durationMs > 0 ? Math.min(1, timeMs / durationMs) : 0;

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8">
      <style>{MOTION_FONT_CSS}</style>

      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--color-ink)]">
          <Film aria-hidden className="size-6 text-[var(--color-brand)]" />
          استوديو الحركة العربية
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-muted)]">
          استوديو الموشن في نَسَق يبني المقاطع بنفس دالة الرسم التي تُصدَّر بها،
          فما تراه في المعاينة هو ما يصل في الملف النهائي.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* ------------------------------------------------ template picker */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <h2 className="mb-3 text-sm font-bold text-[var(--color-ink)]">
              القوالب
            </h2>
            <div className="space-y-2" role="radiogroup" aria-label="قوالب الموشن">
              {MOTION_TEMPLATES.map((entry) => {
                const active = entry.id === templateId;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTemplateId(entry.id)}
                    className={`w-full rounded-lg border p-3 text-right transition ${
                      active
                        ? "border-[var(--color-brand)] bg-[var(--color-brand)]/5"
                        : "border-[var(--color-line-2)] hover:border-[var(--color-line)]"
                    }`}
                  >
                    <span className="block text-sm font-semibold text-[var(--color-ink)]">
                      {entry.name}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-[var(--color-muted)]">
                      {entry.description}
                    </span>
                    <span className="mt-2 inline-block rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] text-[var(--color-muted)]">
                      {entry.aspect === "square" ? "مربّع 1:1" : "عمودي 9:16"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {template.id === "period-origin" && (
            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
              <label
                htmlFor="motion-wordmark"
                className="mb-2 block text-sm font-bold text-[var(--color-ink)]"
              >
                الاسم (ينتهي بنقطة)
              </label>
              <input
                id="motion-wordmark"
                value={wordmark}
                onChange={(event) => setWordmark(event.target.value)}
                dir="rtl"
                className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-page)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]"
              />
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-muted)]">
                التأثير ينبثق من النقطة الأخيرة في الاسم؛ إن لم تكن موجودة لن
                يُستبدل بدائرة عامة.
              </p>
            </div>
          )}

          <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <h2 className="mb-3 text-sm font-bold text-[var(--color-ink)]">
              الإخراج
            </h2>
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleExportHtml}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-brand)] px-3 py-2 text-sm font-semibold text-[var(--color-on-brand)] hover:bg-[var(--color-brand-hover)]"
              >
                <Download aria-hidden className="size-4" />
                تنزيل تكوين HTML
              </button>
              <button
                type="button"
                onClick={handleCopyRenderCommand}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
              >
                <Sparkles aria-hidden className="size-4" />
                نسخ أمر إخراج MP4
              </button>
            </div>
            <dl className="mt-4 space-y-1 text-xs text-[var(--color-muted)]">
              <div className="flex justify-between">
                <dt>الإطار</dt>
                <dd className="tabular-nums">
                  {width}×{height}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>معدّل الإطارات</dt>
                <dd className="tabular-nums">{composition.fps} إطار/ث</dd>
              </div>
              <div className="flex justify-between">
                <dt>عدد الإطارات</dt>
                <dd className="tabular-nums">{frameCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt>المشاهد</dt>
                <dd className="tabular-nums">{composition.scenes.length}</dd>
              </div>
            </dl>
          </div>
        </aside>

        {/* ------------------------------------------------------- preview */}
        <div className="space-y-4">
          <div className="flex items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <canvas
              ref={canvasRef}
              width={width}
              height={height}
              role="img"
              aria-label={`معاينة ${composition.name}`}
              className="max-h-[62vh] w-auto rounded-lg shadow-sm"
              style={{ aspectRatio: `${width} / ${height}` }}
            />
          </div>

          {/* timeline */}
          <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (playing) setPlaying(false);
                  else {
                    if (timeMs >= durationMs) setTimeMs(0);
                    setPlaying(true);
                  }
                }}
                aria-label={playing ? "إيقاف مؤقت" : "تشغيل"}
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand)] text-[var(--color-on-brand)] hover:bg-[var(--color-brand-hover)]"
              >
                {playing ? (
                  <Pause aria-hidden className="size-5" />
                ) : (
                  <Play aria-hidden className="size-5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setTimeMs(0);
                }}
                aria-label="إعادة إلى البداية"
                className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
              >
                <RotateCcw aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setLoop((value) => !value)}
                aria-pressed={loop}
                className={`flex size-11 shrink-0 items-center justify-center rounded-full border ${
                  loop
                    ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10 text-[var(--color-brand)]"
                    : "border-[var(--color-line)] text-[var(--color-ink)]"
                }`}
                aria-label="تكرار"
              >
                <Square aria-hidden className="size-4" />
              </button>

              <span className="tabular-nums text-sm text-[var(--color-muted)]">
                {formatTime(timeMs)} / {formatTime(durationMs)}
              </span>

              <input
                type="range"
                min={0}
                max={Math.max(durationMs, 1)}
                step={16}
                value={timeMs}
                onChange={(event) => {
                  setPlaying(false);
                  setTimeMs(Number(event.target.value));
                }}
                aria-label="موضع التشغيل"
                className="h-11 flex-1 accent-[var(--color-brand)]"
                style={{
                  background: `linear-gradient(to left, var(--color-brand) ${progress * 100}%, var(--color-line-2) ${progress * 100}%)`,
                  borderRadius: 999,
                }}
              />
            </div>

            {/* scene strip */}
            <ol className="mt-3 flex gap-1">
              {composition.scenes.map((scene) => (
                <li key={scene.id} className="flex-1" title={scene.name}>
                  <button
                    type="button"
                    onClick={() => {
                      setPlaying(false);
                      const index = composition.scenes.indexOf(scene);
                      const before = composition.scenes
                        .slice(0, index)
                        .reduce((sum, s) => sum + s.durationMs, 0);
                      setTimeMs(before);
                    }}
                    className="w-full truncate rounded-md bg-[var(--color-surface-2)] px-2 py-1.5 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-line-2)]"
                  >
                    {scene.name}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

export default MotionStudio;