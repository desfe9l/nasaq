import { useEffect, useRef, useState } from "react";

/**
 * Incremental rendering for long library lists.
 *
 * Virtualization without a dependency: the list renders a growing WINDOW of
 * rows (`step` at a time) and grows it when a sentinel is scrolled into view.
 * The alternative — rendering every asset card (each with an <img> decode)
 * the moment the shelf opens — is what made browsing a large library block
 * the canvas.
 *
 * Returns the slice to render and a ref for the sentinel element that must
 * sit right after the list.
 */
export function useIncrementalList<T>(items: T[], step = 48) {
  const [count, setCount] = useState(step);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // A new list (filter, folder switch, search) restarts from the first page.
  useEffect(() => {
    setCount(step);
  }, [items, step]);

  const remaining = items.length - count;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || remaining <= 0) return;
    if (typeof IntersectionObserver === "undefined") {
      // Environments without IO (tests, SSR) simply render the first page.
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setCount((current) => current + step);
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [remaining, step]);

  return {
    slice: remaining > 0 ? items.slice(0, count) : items,
    sentinelRef,
    remaining,
  };
}
