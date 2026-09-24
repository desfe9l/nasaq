import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Onboarding tour — a first-visit walkthrough of the editor shell.
 *
 * Deliberately light: no dependency, no portal library, no backdrop that blocks
 * the app. It highlights one control at a time by *measuring* the real DOM node
 * (a selector, never a hard-coded rectangle), dims everything else with four
 * overlay panels, and lets the author keep editing — every control outside the
 * cut-out stays clickable because the overlay is `pointer-events: none`.
 *
 * Why a selector and not a wrapper component: the tour describes controls that
 * already exist and are already laid out by the shell. Wrapping them would mean
 * restyling the toolbar, which is exactly the sort of edit that breaks a
 * one-line header at tablet width.
 *
 * Seen-once state lives in `localStorage` per browser, so the tour returns for a
 * new device but never nags on reload.
 */

const STORAGE_KEY = "nasaq.onboarding.v1";

export interface TourStep {
  /** CSS selector of the control to highlight. */
  target: string;
  title: string;
  body: string;
  /** Preferred side for the tooltip when there is room. */
  placement?: "bottom" | "top";
}

export const EDITOR_TOUR_STEPS: TourStep[] = [
  {
    target: "[data-editor-obstacle='header']",
    title: "شريط الأدوات العلوي",
    body: "كل ما تحتاجه في سطر واحد: الأدوات المثبتة (أدوات التقرير، المكتبة، أضف مكتبة، عناوين الفقرات) تظهر هنا دائمًا، ثم التراجع والتكبير، وأخيرًا الحفظ والتصدير.",
    placement: "bottom",
  },
  {
    target: "[data-tour='report-tools']",
    title: "أدوات التقرير",
    body: "بطاقات المؤشرات، الختم والتوقيع، الترويسة والتذييل، ومراجعة ما قبل الطباعة — مثبتة هنا بشكل دائم.",
    placement: "bottom",
  },
  {
    target: "[data-tour='library-toggle']",
    title: "المكتبة",
    body: "صورك وشعاراتك وأشكالك المحفوظة. استخدم «أضف مكتبة» لتحويل أي مجلد من جهازك إلى رفوف بنمط نَسَق.",
    placement: "bottom",
  },
  {
    target: "[data-tour='left-panel']",
    title: "لوحة المكونات",
    body: "العناصر، الأشكال، المكتبة، القوالب، الصفحات، السمة والخطوط. تبويباتها تنكمش إلى أيقونات عند ضيق المساحة ولا تختفي أبدًا.",
    placement: "bottom",
  },
  {
    target: ".editor-canvas-stage, [data-tour='canvas']",
    title: "مساحة العمل",
    body: "اسحب العناصر لتحريكها، واستخدم المقابض لتغيير الحجم. اضغط مرتين على نص لتحريره مباشرة.",
    placement: "top",
  },
];

/** Read/put the seen flag defensively: private mode must not throw. */
export function hasSeenTour(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === "done";
  } catch {
    return true;
  }
}

export function markTourSeen(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, "done");
  } catch {
    /* private mode: the tour simply shows again next visit */
  }
}

type Rect = { top: number; left: number; width: number; height: number };

const GUTTER = 6;
const TOOLTIP_WIDTH = 300;

export function OnboardingTour({
  steps = EDITOR_TOUR_STEPS,
  onFinish,
}: {
  steps?: TourStep[];
  onFinish: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;

  const measure = useCallback(() => {
    const node = document.querySelector<HTMLElement>(step?.target ?? "");
    if (!node) {
      setRect(null);
      return;
    }
    const box = node.getBoundingClientRect();
    setRect({
      top: box.top - GUTTER,
      left: box.left - GUTTER,
      width: box.width + GUTTER * 2,
      height: box.height + GUTTER * 2,
    });
  }, [step?.target]);

  useLayoutEffect(() => {
    measure();
    // Re-measure after the shell's own layout settles (panels animate in) and
    // whenever the viewport changes size — a stale highlight is worse than none.
    const raf = requestAnimationFrame(measure);
    const timer = window.setTimeout(measure, 260);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        markTourSeen();
        onFinish();
      }
      if (event.key === "ArrowLeft") {
        setIndex((i) => Math.min(steps.length - 1, i + 1));
      }
      if (event.key === "ArrowRight") {
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps.length, onFinish]);

  const finish = () => {
    markTourSeen();
    onFinish();
  };

  // Tooltip placement: prefer the step's side, flip when it would leave the
  // viewport, and clamp horizontally so it never hangs off an edge.
  const tooltip = useMemo(() => {
    if (!rect) return { top: 24, left: 24, placement: "bottom" as const };
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const below = rect.top + rect.height + 12;
    const wantTop = step?.placement === "top" || below + 170 > viewportH;
    const top = wantTop
      ? Math.max(12, rect.top - 12 - 160)
      : Math.min(viewportH - 170, below);
    const centered = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
    const left = Math.min(
      Math.max(12, centered),
      Math.max(12, viewportW - TOOLTIP_WIDTH - 12),
    );
    return { top, left, placement: wantTop ? ("top" as const) : ("bottom" as const) };
  }, [rect, step?.placement]);

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="false" aria-label="جولة تعريفية">
      {/*
       * Four dim panels around the cut-out rather than one full-screen layer:
       * the highlighted control itself is never covered, so it stays clickable
       * and the author can try the thing the step is describing.
       */}
      {rect && (
        <>
          <span
            className="absolute bg-black/45"
            style={{ top: 0, left: 0, right: 0, height: Math.max(0, rect.top) }}
            aria-hidden
          />
          <span
            className="absolute bg-black/45"
            style={{
              top: rect.top + rect.height,
              left: 0,
              right: 0,
              bottom: 0,
            }}
            aria-hidden
          />
          <span
            className="absolute bg-black/45"
            style={{
              top: rect.top,
              left: 0,
              width: Math.max(0, rect.left),
              height: rect.height,
            }}
            aria-hidden
          />
          <span
            className="absolute bg-black/45"
            style={{
              top: rect.top,
              left: rect.left + rect.width,
              right: 0,
              height: rect.height,
            }}
            aria-hidden
          />
          <span
            className="pointer-events-none absolute rounded-[10px] ring-2 ring-gold-2 dark:ring-gold-2"
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.001)",
            }}
            aria-hidden
          />
        </>
      )}
      {!rect && <div className="absolute inset-0 bg-black/45" aria-hidden />}

      <div
        className="absolute w-[300px] rounded-[12px] border border-line bg-white p-3 shadow-2xl dark:border-white/10 dark:bg-[#161c26]"
        style={{ top: tooltip.top, left: tooltip.left }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-navy dark:text-gold-2" aria-hidden />
            <h3 className="text-[12px] font-extrabold">{step?.title}</h3>
          </div>
          <button
            type="button"
            onClick={finish}
            aria-label="تخطي الجولة"
            className="grid size-6 shrink-0 place-items-center rounded-[6px] text-muted hover:bg-line-2 dark:hover:bg-white/5"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-6 text-muted">{step?.body}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold tabular-nums text-muted">
            {index + 1} / {steps.length}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-line px-2 text-[11px] font-bold disabled:opacity-40 dark:border-white/10"
            >
              <ArrowRight className="size-3" aria-hidden />
              السابق
            </button>
            <button
              type="button"
              onClick={() => (isLast ? finish() : setIndex((i) => i + 1))}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-[7px] px-2.5 text-[11px] font-extrabold text-white",
                "bg-navy",
              )}
            >
              {isLast ? "ابدأ التحرير" : "التالي"}
              {!isLast && <ArrowLeft className="size-3" aria-hidden />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
