import { BrandLogo } from "./SiteChrome";
import { cn } from "@/lib/utils";

/**
 * The NASAQ mark on its own, theme-aware.
 *
 * One component so every surface that shows the platform's badge — the header,
 * the footer, the custom-design brand area, the gate loader — resolves the same
 * artwork through the same admin-managed slot. When the owner uploads a mark in
 * `/admin/assets`, all of them update together; when none is uploaded, the
 * shipped light/dark pair is used.
 *
 * `BrandLogo` owns that resolution (it reads the settings and picks the right
 * file), so this is a thin, typed wrapper rather than a second implementation.
 * The label is empty on purpose: the mark is decorative wherever it appears
 * beside the platform's own name, and a screen reader announcing "نَسَق" twice
 * on one row is noise.
 */
export function BrandMark({
  className,
  decorative = true,
}: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <span
      className={cn("inline-flex items-center", className)}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : "نَسَق | NASAQ"}
    >
      <BrandLogo markOnly compact />
    </span>
  );
}
