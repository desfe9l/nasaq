import { useEffect, useRef, useState } from "react";

/**
 * Entrance reveal via IntersectionObserver.
 *
 * Elements with `data-animate` start hidden (see `src/styles.css`). This hook
 * adds `is-revealed` once they enter the viewport, and a `--reveal-delay`
 * custom property so sibling reveals can stagger without per-element timers.
 *
 * Honors `prefers-reduced-motion` — when the user has asked to reduce motion,
 * elements reveal immediately (no stager, no transform).
 */
export function useReveal<T extends HTMLElement = HTMLElement>(options?: {
  delay?: number;
  threshold?: number;
  rootMargin?: string;
}): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (prefersReduced) {
      setVisible(true);
      return;
    }

    if (options?.delay) {
      node.style.setProperty(
        "--reveal-delay",
        `${options.delay}ms`,
      );
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        });
      },
      {
        threshold: options?.threshold ?? 0.08,
        rootMargin: options?.rootMargin ?? "0px 0px -8% 0px",
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [options?.delay, options?.threshold, options?.rootMargin]);

  return [ref, visible];
}
