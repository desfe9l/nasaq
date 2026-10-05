import { useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * SmartImage — an image that already owns its final box before it has loaded.
 *
 * WHY THIS EXISTS
 * ---------------
 * A plain `<img src>` starts life with no intrinsic height. The browser paints
 * the surrounding card at the height of an empty box, the bytes arrive, the box
 * grows, and the whole page shifts under the reader's finger (the "image flash"
 * authors reported). Two smaller faults came from the same missing state:
 *
 *   • a surface that had no image yet printed a sentence about it — a
 *     development-era message that has no place in the product; and
 *   • an image served from cache could arrive BEFORE React attached `onLoad`,
 *     so it stayed invisible (the "never loaded" image authors saw).
 *
 * The fix is a small state machine around the real `<img>`:
 *
 *   1. the wrapper reserves the final geometry immediately — either the exact
 *      `aspectRatio` of the artwork or an explicit box from the caller — so the
 *      layout never changes when the bytes land;
 *   2. a neutral, theme-aware plate fills that box while loading (a surface
 *      tone plus a slow sheen — never text, never a debug label);
 *   3. the picture fades in exactly where it was always going to be, and only
 *      after `decode()` resolves, so a partially painted image can never be
 *      seen;
 *   4. `complete` is checked on mount, which is what makes a cached image
 *      appear immediately instead of waiting for an event that already fired;
 *   5. a failed source keeps the plate and shows a single glyph. The reason is
 *      available to operators through `data-state`, never as customer copy.
 *
 * Uploaded artwork is never distorted: `objectFit` defaults to `contain`, so a
 * 4:3 upload inside a 16:9 frame is letterboxed rather than stretched. Pass
 * `fit="cover"` where a crop is intended and the caller owns the aspect ratio.
 */
export type SmartImageState = "loading" | "ready" | "error";

/** The ratio of a reserved box, from a document page or any width/height pair. */
export function aspectRatioOf(
  size: { w: number; h: number } | undefined,
): string | undefined {
  if (!size || !Number.isFinite(size.w) || !Number.isFinite(size.h)) return undefined;
  if (size.w <= 0 || size.h <= 0) return undefined;
  return `${size.w} / ${size.h}`;
}

export function SmartImage({
  src,
  alt,
  /** Classes for the reserved box (radius, border, shadow, size). */
  className,
  /** Classes for the `<img>` itself (filters, transforms, hover effects). */
  imageClassName,
  /** Fill strategy for the artwork inside the box. `contain` never distorts. */
  fit = "contain",
  /** `object-position`, e.g. `center top` for a page snapshot. */
  position,
  /** A page-like ratio to reserve when the caller's box has no fixed size. */
  aspectRatio,
  /** Load immediately (above the fold) instead of lazily. */
  eager = false,
  /** Decorative artwork (a card preview) carries no alternative text. */
  decorative = false,
  /** Copy for the placeholder while loading — screen readers only. */
  loadingLabel = "جارٍ تحميل الصورة",
  /** Reported after the first successful paint — used to fade a caption in. */
  onReady,
  onError,
}: {
  src: string;
  alt?: string;
  className?: string;
  imageClassName?: string;
  fit?: "contain" | "cover";
  position?: string;
  aspectRatio?: string;
  eager?: boolean;
  decorative?: boolean;
  loadingLabel?: string;
  onReady?: () => void;
  onError?: () => void;
}) {
  const ref = useRef<HTMLImageElement | null>(null);
  const [state, setState] = useState<SmartImageState>("loading");

  async function reveal(img: HTMLImageElement) {
    try {
      await img.decode();
    } catch {
      /* decoder declined — the load event already told us the bytes are here */
    }
    setState("ready");
    onReady?.();
  }


  // A new source is a new state: the box keeps its geometry, only the artwork
  // inside it changes, so a replacement never re-lays-out the page.
  useEffect(() => {
    setState("loading");
  }, [src]);

  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    if (!src) {
      setState("error");
      return;
    }
    /*
     * The cached case. A source already in memory fires `load` before this
     * effect runs, so waiting for the event alone would leave the picture
     * hidden forever. `complete` is the honest answer to "do we already have
     * these bytes?".
     */
    if (img.complete && img.naturalWidth > 0) {
      void reveal(img);
      return;
    }
    if (img.complete && img.naturalWidth === 0) {
      setState("error");
      onError?.();
    }
    // `onReady`/`onError` are intentionally not dependencies: they are
    // notification callbacks, and re-running this effect on an inline arrow
    // would restart decoding on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const settle = (next: SmartImageState) => {
    setState(next);
    if (next === "ready") onReady?.();
    if (next === "error") onError?.();
  };

  /**
   * Show the picture only once the browser can paint it whole.
   *
   * `decode()` resolves when the frame is ready to render, so the fade starts
   * from a complete image instead of a progressive one that would otherwise be
   * seen half-drawn in the first frames of the transition. A decoder that
   * refuses (some SVG sources) is not a failure — the bytes already loaded, so
   * the picture is shown anyway.
   */
  return (
    <span
      className={cn(
        "smart-image relative block overflow-hidden bg-surface-2",
        className,
      )}
      style={aspectRatio ? { aspectRatio } : undefined}
      data-state={state}
    >
      {/* The plate. Present from the first paint, gone the moment the picture
          is, so there is never an empty frame and never a flash of nothing. */}
      {state !== "ready" && (
        <span
          aria-hidden
          className={cn(
            "smart-image-plate absolute inset-0 grid place-items-center",
            state === "loading" && "is-loading",
          )}
        >
          {state === "error" && <ImageOff className="size-4 opacity-45" />}
        </span>
      )}
      {state === "loading" && (
        <span className="sr-only" role="status">
          {loadingLabel}
        </span>
      )}
      <img
        ref={ref}
        src={src}
        alt={decorative ? "" : (alt ?? "")}
        aria-hidden={decorative || undefined}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        onLoad={(event) => void reveal(event.currentTarget)}
        onError={() => settle("error")}
        className={cn(
          "smart-image-art relative h-full w-full transition-opacity duration-300 ease-out",
          state === "ready" ? "opacity-100" : "opacity-0",
          imageClassName,
        )}
        style={{
          objectFit: fit,
          objectPosition: position,
        }}
      />
    </span>
  );
}
