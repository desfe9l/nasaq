import { useEffect, useState } from "react";

/**
 * Picture load state for artwork already laid out by the document model.
 *
 * The element's own box (mm on the page) always owns the geometry, so nothing
 * here can shift a layout. What this hook decides is only WHETHER the pixels are
 * ready to be seen:
 *
 *   idle    — no source at all (an empty picture slot);
 *   loading — the source is set and the browser is fetching/decoding it;
 *   ready   — safe to paint;
 *   error   — the source will not render (broken link, unsupported bytes).
 *
 * Two details exist because of real reports:
 *
 *  • `img.complete` is consulted on mount. A cached data URL fires `load`
 *    before React can attach a handler, so an event-only implementation leaves
 *    the picture invisible — the "image never loads in the editor" fault.
 *  • Sources that already resolved once are remembered in a module-level set.
 *    The editor re-mounts nodes on page switches and history steps; without
 *    this, every cached picture would replay its fade and read as a flash.
 */
export type ImageLoadState = "idle" | "loading" | "ready" | "error";

/** Sources already painted in this session. Strings are the sources themselves. */
const RESOLVED = new Set<string>();
/** Sources that failed for good, so a re-mount does not retry the fade. */
const FAILED = new Set<string>();

/** Forget a source's cached verdict (used when an author replaces artwork). */
export function forgetImageState(src: string): void {
  RESOLVED.delete(src);
  FAILED.delete(src);
}

export function useImageLoadState(src: string): ImageLoadState {
  const [state, setState] = useState<ImageLoadState>(() => {
    if (!src) return "idle";
    if (RESOLVED.has(src)) return "ready";
    if (FAILED.has(src)) return "error";
    return "loading";
  });

  useEffect(() => {
    if (!src) {
      setState("idle");
      return;
    }
    if (RESOLVED.has(src)) {
      setState("ready");
      return;
    }
    if (FAILED.has(src)) {
      setState("error");
      return;
    }
    setState("loading");

    let alive = true;
    const image = new Image();
    image.decoding = "async";
    const settle = (next: "ready" | "error") => {
      if (!alive) return;
      if (next === "ready") RESOLVED.add(src);
      else FAILED.add(src);
      setState(next);
    };
    image.onload = () => {
      /*
       * `decode()` resolves when the frame can be painted whole; showing the
       * picture before that is what produced a visible half-drawn frame in the
       * first moments of a zoom or a page switch. A decoder that declines is
       * not a failure — the bytes are here.
       */
      void image
        .decode?.()
        .catch(() => undefined)
        .then(() => settle("ready"));
    };
    image.onerror = () => settle("error");
    image.src = src;
    // A data URL can settle synchronously in some engines.
    if (image.complete) {
      if (image.naturalWidth > 0) settle("ready");
      else settle("error");
    }
    return () => {
      alive = false;
    };
  }, [src]);

  return state;
}
