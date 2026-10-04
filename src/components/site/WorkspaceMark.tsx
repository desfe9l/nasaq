/**
 * «مسار مساحة العمل» — the workspace / editor-experience mark.
 *
 * NASAQ's door into the editor was text-only («مساحة العمل» / «تجربة المحرر»).
 * This mark gives that control an identity of its own: the WORKSPACE frame (the
 * editor chrome) holding the NASAQ PAGE — a solid sheet marked with the house
 * SPINE in gold, which in this product is the report cover's rule (the editor's
 * `THEMES.official` cover, and the media skill's green-and-gold system).
 *
 * Drawn as a 16×16 glyph rather than an illustration, so it holds at the header's
 * real size (16px) and in Light, Dim and Dark without a second asset:
 *
 *   • the frame and the sheet inherit the control's own colour (`currentColor`),
 *     so the mark follows every hover / active / focus treatment the control
 *     already carries — including its AA contrast guarantee;
 *   • the spine is the single accent, and it is a token: gold where the chrome is
 *     emerald (Light), emerald where the chrome is gold (Dim and Dark). Same two
 *     hues in the same roles, inverted the way the palettes invert them — never
 *     an arbitrary colour, and never a spine that disappears into the sheet.
 *
 * Geometry: the sheet sits against the frame's inline-start edge with the canvas
 * space left open, and a hairline of air keeps the two shapes from welding shut
 * at 16px. Stroke weights (1.3 / 1.7) sit next to the 1.75 stroke of the lucide
 * icons in the same toolbar.
 */

import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

export function WorkspaceMark({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
      {...props}
    >
      {/* Workspace frame — the editor chrome around the canvas. */}
      <rect
        x="2.4"
        y="2.4"
        width="11.2"
        height="11.2"
        rx="2.6"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      {/* The document on the canvas: one solid sheet, not a second outline. */}
      <rect x="6.9" y="4.5" width="5.3" height="7" rx="1.05" fill="currentColor" />
      {/* The NASAQ spine — gold on emerald, emerald on gold. */}
      <path
        d="M11.05 4.5v7"
        className="text-gold dark:text-navy"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export default WorkspaceMark;
