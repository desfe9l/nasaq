import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Expand,
  Images,
  Lock,
  Minimize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { pageSize, type Page } from "@/lib/editor/model";
import { TemplatePreview } from "./TemplatePreview";
import { SmartImage, aspectRatioOf } from "@/components/ui/SmartImage";

/**
 * The template preview gallery — a real slides experience for real documents.
 *
 * WHAT IT IS
 * ----------
 * One component that presents a template the way a professional catalogue does:
 * the current page large and centred, arrows, page dots, a thumbnail strip, a
 * full-size toggle, and the gestures a touch device expects — drag, swipe and
 * tap — plus trackpad swipes and the keyboard. Multi-page templates are
 * therefore readable, not just counted.
 *
 * WHY THE GESTURES ARE WRITTEN OUT
 * --------------------------------
 *   • **Pointer events, not touch events**, so one implementation serves an
 *     iPhone finger, an iPad pencil-side finger, and a mouse drag on desktop.
 *   • **Direction-aware in RTL.** The document is Arabic-first, so "next" is to
 *     the LEFT: dragging the sheet leftwards would page BACKWARDS if the
 *     arithmetic ignored `dir`. The container's computed direction decides.
 *   • **A drag is not a click.** A pointerup that follows real movement must
 *     never also advance the slide — that is the classic "it jumped two pages
 *     while I was reading" bug. Movement is measured and a drag suppresses the
 *     tap.
 *   • **The wheel only takes an intentional gesture.** A horizontal trackpad
 *     swipe pages the gallery; a vertical wheel keeps scrolling the page, so a
 *     reader can never get trapped inside a preview.
 *   • **Nothing is clipped.** The stage is `overflow-hidden` with the artwork
 *     sized to fit inside it, so the gallery never creates horizontal page
 *     overflow on a phone.
 *
 * Images an administrator uploaded are rendered through `SmartImage` (reserved
 * box, no distortion, no flash); pages are rendered by `TemplatePreview`, the
 * same renderer the editor and the exporters use.
 */

export interface GallerySlide {
  id: string;
  /** Page name, used as the thumbnail's accessible label. */
  label: string;
  /** A real document page — the primary form. */
  page?: Page;
  /** An uploaded preview image, used when a template has no pages to render. */
  src?: string;
}

/** How far a pointer must travel before it counts as a drag (CSS px). */
const DRAG_THRESHOLD = 46;
/** How much of the stage a full swipe must cover to change page. */
const SWIPE_RATIO = 0.18;

export function TemplateGallery({
  slides,
  /** Disables the management-free presentation for locked (paid) templates. */
  locked = false,
  lockedNote,
  className,
  stageClassName,
  label = "معاينة القالب",
  showThumbnails = true,
  onSlideChange,
}: {
  slides: GallerySlide[];
  locked?: boolean;
  lockedNote?: string;
  className?: string;
  stageClassName?: string;
  label?: string;
  showThumbnails?: boolean;
  onSlideChange?: (index: number) => void;
}) {
  const total = slides.length;
  const [index, setIndex] = useState(0);
  const [full, setFull] = useState(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const wheelAt = useRef(0);
  const listId = useId().replace(/:/g, "");

  const safeIndex = Math.min(Math.max(index, 0), Math.max(total - 1, 0));
  const slide = slides[safeIndex];

  // The reserved geometry: the first page's own ratio, so the stage never
  // resizes as pages change or as artwork loads.
  const ratio = useMemo(
    () => aspectRatioOf(pageSize(slide?.page ?? slides[0]?.page)) ?? "210 / 297",
    [slide, slides],
  );

  const go = useCallback(
    (next: number) => {
      if (total < 2) return;
      const wrapped = ((next % total) + total) % total;
      setIndex(wrapped);
      onSlideChange?.(wrapped);
    },
    [onSlideChange, total],
  );

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(total - 1, 0)));
  }, [total]);

  /* The physical direction "next" moves in: leftwards in an RTL document. */
  const rtl = useCallback(() => {
    const node = stageRef.current;
    if (!node || typeof window === "undefined") return true;
    return getComputedStyle(node).direction === "rtl";
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    if (total < 2) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointer.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const state = pointer.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    // A mostly-vertical gesture belongs to the page, not the gallery.
    if (!state.moved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
      pointer.current = null;
      setDragging(false);
      setDrag(0);
      return;
    }
    if (Math.abs(dx) > 6) state.moved = true;
    setDrag(dx);
  };

  const endDrag = (event: React.PointerEvent) => {
    const state = pointer.current;
    if (!state || state.id !== event.pointerId) return;
    pointer.current = null;
    setDragging(false);
    const width = stageRef.current?.clientWidth ?? 0;
    const threshold = Math.max(DRAG_THRESHOLD, width * SWIPE_RATIO);
    const dx = drag;
    setDrag(0);
    if (Math.abs(dx) < threshold) return;
    // In RTL a leftward drag (negative dx) reveals the NEXT page; in LTR the
    // opposite. One sign flip, decided by the document's own direction.
    const forward = rtl() ? dx > 0 : dx < 0;
    go(forward ? safeIndex + 1 : safeIndex - 1);
  };

  const onWheel = (event: React.WheelEvent) => {
    if (total < 2) return;
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (!horizontal || Math.abs(event.deltaX) < 4) return;
    // A trackpad emits a stream of small deltas: navigate once per gesture.
    const now = Date.now();
    if (now - wheelAt.current < 320) return;
    wheelAt.current = now;
    go(event.deltaX > 0 ? safeIndex - 1 : safeIndex + 1);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      // Arrow keys follow the reading direction, not the screen direction.
      go(safeIndex + 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(safeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      go(0);
    } else if (event.key === "End") {
      event.preventDefault();
      go(total - 1);
    }
  };

  if (!total) return null;

  const artwork = slide?.src ? (
    <SmartImage
      src={slide.src}
      alt=""
      decorative
      fit="contain"
      aspectRatio={ratio}
      className="max-h-full w-full"
      imageClassName="max-h-full"
    />
  ) : slide?.page ? (
    <TemplatePreview page={slide.page} className="rounded-[3px] shadow-md" />
  ) : null;

  return (
    <section
      className={cn("template-gallery", className)}
      aria-roledescription="معرض صفحات"
      aria-label={label}
      data-gallery=""
      data-index={safeIndex}
    >
      <div className="flex items-center justify-between gap-2 pb-2">
        <p className="inline-flex items-center gap-1.5 text-[12px] font-extrabold text-muted">
          <Images className="size-3.5 text-brand" aria-hidden />
          {total > 1 ? `الصفحة ${safeIndex + 1} من ${total}` : "معاينة الصفحة"}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFull((value) => !value)}
            aria-pressed={full}
            aria-label={full ? "ملاءمة العرض" : "عرض بالحجم الكامل"}
            title={full ? "ملاءمة العرض" : "عرض بالحجم الكامل"}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[11px] font-bold text-muted transition hover:border-brand hover:text-ink"
          >
            {full ? <Minimize2 className="size-3.5" aria-hidden /> : <Expand className="size-3.5" aria-hidden />}
            {full ? "ملاءمة" : "حجم كامل"}
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        role="group"
        aria-live="polite"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
        onClick={(event) => {
          // A click that ends a drag is not a click, and a control's own click
          // must never double-advance the gallery.
          if (pointer.current?.moved) return;
          if ((event.target as HTMLElement).closest("button, a")) return;
          if (total < 2) return;
          go(safeIndex + 1);
        }}
        className={cn(
          "template-gallery-stage relative grid touch-pan-y place-items-center overflow-hidden rounded-xl border border-line bg-paper p-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:p-5",
          total > 1 && "cursor-grab active:cursor-grabbing",
          stageClassName,
        )}
        style={full ? undefined : { aspectRatio: ratio, maxHeight: "62vh" }}
      >
        {/* The sheet: transform carries the live drag, the transition carries
            the settle, and reduced-motion users get the settle instantly. */}
        <div
          className="template-gallery-sheet w-full"
          style={{
            transform: full
              ? undefined
              : `translate3d(${drag}px, 0, 0) scale(${dragging ? 0.995 : 1})`,
            transition: dragging ? "none" : "transform 240ms cubic-bezier(0.22,1,0.36,1)",
            width: full ? `${Math.max(210, pageSize(slide?.page ?? slides[0]?.page).w)}mm` : undefined,
            maxWidth: "100%",
          }}
        >
          {artwork}
        </div>

        {/*
         * Locked artwork: a paid template states its requirement ON the preview
         * instead of hiding behind it. The first page stays readable — a buyer
         * has to see what they are buying — while the note says what unlocks the
         * rest.
         */}
        {locked && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-center gap-2 rounded-lg border border-gold/40 bg-surface/95 px-3 py-2 text-[11.5px] font-extrabold text-ink shadow-sm">
            <Lock className="size-3.5 text-warning" aria-hidden />
            {lockedNote ?? "النسخة الكاملة تتطلب ترخيصًا"}
          </div>
        )}

        {total > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(safeIndex - 1)}
              aria-label="الصفحة السابقة"
              title="الصفحة السابقة"
              className="template-gallery-arrow template-gallery-arrow-prev"
              data-side="prev"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(safeIndex + 1)}
              aria-label="الصفحة التالية"
              title="الصفحة التالية"
              className="template-gallery-arrow template-gallery-arrow-next"
              data-side="next"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
          </>
        )}
      </div>

      {total > 1 && (
        <>
          {/* Dots: the fastest way to a known page on a phone. */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5" role="tablist" aria-label="صفحات القالب">
            {slides.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={i === safeIndex}
                aria-label={`الصفحة ${i + 1}`}
                onClick={() => go(i)}
                className={cn(
                  "template-gallery-dot",
                  i === safeIndex && "is-active",
                )}
              />
            ))}
          </div>

          {showThumbnails && (
            <div
              id={`gallery-thumbs-${listId}`}
              className="mt-3 flex gap-2 overflow-x-auto pb-1"
              aria-label="مصغّرات الصفحات"
            >
              {slides.map((item, i) => {
                const thumbSize = pageSize(item.page);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(i)}
                    aria-pressed={i === safeIndex}
                    aria-label={`عرض الصفحة ${i + 1}`}
                    title={item.label}
                    className={cn(
                      "shrink-0 rounded-lg border p-1 transition",
                      i === safeIndex
                        ? "border-brand ring-2 ring-navy/25"
                        : "border-line hover:border-brand",
                    )}
                    style={{ width: 76, aspectRatio: aspectRatioOf(thumbSize) ?? "210 / 297" }}
                  >
                    {item.src ? (
                      <SmartImage
                        src={item.src}
                        decorative
                        fit="contain"
                        aspectRatio={aspectRatioOf(thumbSize) ?? "210 / 297"}
                        className="h-full w-full rounded-[4px]"
                      />
                    ) : item.page ? (
                      <TemplatePreview page={item.page} className="rounded-[4px]" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Build gallery slides from a template's pages and its uploaded previews. */
export function slidesFromTemplate(
  pages: Page[],
  previews: string[] = [],
): GallerySlide[] {
  const slides: GallerySlide[] = pages.map((page, index) => ({
    id: page.id,
    label: page.name || `الصفحة ${index + 1}`,
    page,
  }));
  for (const [index, src] of previews.entries()) {
    if (!src) continue;
    slides.push({
      id: `preview-${index}`,
      label: `معاينة ${index + 1}`,
      src,
    });
  }
  return slides;
}
