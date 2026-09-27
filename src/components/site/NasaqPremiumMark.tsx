import type { SVGProps } from "react";

/** NASAQ's aligned N: two structural rails joined by a rising weave.
 * 24-unit grid, 2-unit strokes, symmetric 2-unit minimum safe area. No badge outline,
 * crown or verification tick; currentColor inherits the account's theme tone. */
export function NasaqPremiumMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
      data-nasaq-premium="true"
    >
      <path d="M5 19V5l14 14V5" />
      <path d="m9 5 3-2 3 2M9 19l3 2 3-2" />
    </svg>
  );
}
