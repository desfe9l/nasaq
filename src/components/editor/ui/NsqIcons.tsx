/**
 * NASAQ-specific editor icons.
 *
 * Lucide covers the generic vocabulary (crop, rotate, lock…), but masking and
 * image repositioning had been borrowing `Group`/`Ungroup` glyphs whose marks
 * read as tangled clusters at 14–16 px — the exact "distorted icon" complaint.
 * These three are drawn for the editor's own language: a 24×24 grid, 2px
 * strokes matching lucide's optical weight, rounded joints, and one clear
 * idea each. They inherit `currentColor`, size like any lucide icon, and are
 * typed as `LucideIcon` so every existing icon slot accepts them — one icon
 * vocabulary across the floating controls and the editor dock, never two.
 */
import { forwardRef, type ReactElement, type SVGProps } from "react";
import type { LucideIcon } from "lucide-react";

type IconProps = SVGProps<SVGSVGElement>;

const defaultProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function makeIcon(displayName: string, children: ReactElement): LucideIcon {
  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
    { className, ...rest },
    ref,
  ) {
    return (
      <svg {...defaultProps} ref={ref} className={className ?? "size-4"} {...rest}>
        {children}
      </svg>
    );
  });
  Icon.displayName = displayName;
  return Icon as unknown as LucideIcon;
}

/** قناع القص — the frame clips the artwork: the half inside the frame is filled. */
export const MaskIcon = makeIcon(
  "NASAQ Mask",
  <>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M14.5 8.5a4.2 4.2 0 1 1 0 7" />
    <path
      d="M14.5 8.5a4.2 4.2 0 1 0 0 7Z"
      fill="currentColor"
      stroke="none"
      opacity="0.9"
    />
  </>,
);

/** إزالة القناع — the mark released: open frame, whole artwork. */
export const MaskOffIcon = makeIcon(
  "NASAQ Mask Off",
  <>
    <rect
      x="3"
      y="3"
      width="18"
      height="18"
      rx="4"
      strokeDasharray="4.2 2.6"
    />
    <circle cx="12" cy="12" r="4.2" />
    <path d="M5 19 19 5" opacity="0.85" />
  </>,
);

/** تحريك الصورة داخل الإطار — a fixed frame; the picture slides inside it. */
export const RepositionImageIcon = makeIcon(
  "NASAQ Reposition",
  <>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <rect
      x="8.2"
      y="8.2"
      width="11"
      height="11"
      rx="1.6"
      fill="currentColor"
      stroke="none"
      opacity="0.55"
    />
    <path
      d="M12.6 13.7H16m0 0-1.4-1.4M16 13.7l-1.4 1.4"
      strokeWidth="1.6"
    />
  </>,
);
