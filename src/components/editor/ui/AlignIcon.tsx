import type { ReactNode } from "react";

/**
 * Alignment / distribution glyphs.
 *
 * Drawn as vectors so they stay crisp at every zoom and in both themes, and
 * shared by every surface that offers alignment: the selection toolbar's
 * contextual menu and the layers context menu.
 */
export function AlignIcon({ kind }: { kind: string }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.3,
    strokeLinecap: "round" as const,
  };
  const bars = (a: ReactNode) => (
    <svg {...common} aria-hidden>
      {a}
    </svg>
  );
  switch (kind) {
    case "right":
      return bars(
        <>
          <path d="M14 2v12" />
          <rect x="3" y="3" width="8" height="3.4" />
          <rect x="5" y="9.6" width="6" height="3.4" />
        </>,
      );
    case "left":
      return bars(
        <>
          <path d="M2 2v12" />
          <rect x="5" y="3" width="8" height="3.4" />
          <rect x="5" y="9.6" width="6" height="3.4" />
        </>,
      );
    case "center-h":
      return bars(
        <>
          <path d="M8 2v12" />
          <rect x="3" y="3" width="10" height="3.4" />
          <rect x="4.5" y="9.6" width="7" height="3.4" />
        </>,
      );
    case "top":
      return bars(
        <>
          <path d="M2 2h12" />
          <rect x="3" y="5" width="3.4" height="8" />
          <rect x="9.6" y="5" width="3.4" height="6" />
        </>,
      );
    case "bottom":
      return bars(
        <>
          <path d="M2 14h12" />
          <rect x="3" y="3" width="3.4" height="8" />
          <rect x="9.6" y="5" width="3.4" height="6" />
        </>,
      );
    case "center-v":
      return bars(
        <>
          <path d="M2 8h12" />
          <rect x="3" y="3" width="3.4" height="10" />
          <rect x="9.6" y="4.5" width="3.4" height="7" />
        </>,
      );
    case "dist-h":
      return bars(
        <>
          <path d="M2 2v12M14 2v12" />
          <rect x="6.5" y="4" width="3" height="8" />
        </>,
      );
    case "dist-v":
      return bars(
        <>
          <path d="M2 2h12M2 14h12" />
          <rect x="4" y="6.5" width="8" height="3" />
        </>,
      );
    default:
      return null;
  }
}
