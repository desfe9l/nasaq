import { Instagram } from "lucide-react";
import { SOCIAL_ACCOUNTS, type SocialAccount } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * Official account row — one component for every place the platform links out
 * to its own social profiles (footer today, contact page today, anywhere else
 * later) so the set never drifts between surfaces.
 *
 * Two shapes, same data: `icon` for tight chrome rows and `full` where the
 * visitor is actively looking for a channel and the handle should be legible.
 * Everything wraps, so the row survives a phone, an iPad and a desktop without
 * its own breakpoint rules.
 */

/**
 * Brand glyphs lucide does not ship.
 *
 * Every path here is the platform's own mark on the SAME 24 × 24 grid the
 * lucide icons use, with the viewBox matching the coordinates the path is
 * written in. That second half is the whole bug this block fixes: the earlier
 * Pinterest path was drawn inside a ~13 × 19 box at 24 × 24, so it painted as a
 * small tall blob shoved to one side of its tile — "distorted" was the kind
 * description. Geometry and viewBox now agree, so each glyph fills its box and
 * keeps its true proportions next to the lucide Instagram icon.
 *
 * `fill="currentColor"` and `aria-hidden` match the rest of the row: colour
 * comes from the link's state, and a screen reader reads the link's own label.
 */
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function PinterestIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z" />
    </svg>
  );
}

function SocialIcon({ id, className }: { id: SocialAccount["id"]; className?: string }) {
  if (id === "instagram") return <Instagram className={className} />;
  if (id === "tiktok") return <TikTokIcon className={className} />;
  if (id === "pinterest") return <PinterestIcon className={className} />;
  return <XIcon className={className} />;
}

export function SocialLinks({
  variant = "icon",
  className,
}: {
  variant?: "icon" | "full";
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-2", className)}>
      {SOCIAL_ACCOUNTS.map((account) => (
        <li key={account.id}>
          <a
            href={account.href}
            target="_blank"
            rel="noopener noreferrer"
            // The handle repeats across accounts, so the accessible name carries
            // the platform too — a screen reader must not hear "@nasaqdocs" twice
            // with no way to tell the two links apart.
            aria-label={`${account.label} — ${account.handle}`}
            title={`${account.label} ${account.handle}`}
            className={cn(
              "inline-flex items-center rounded-[8px] border border-line text-muted transition hover:border-brand hover:text-brand-hover",
              variant === "full"
                ? "h-9 gap-2 px-3 text-[12px] font-extrabold"
                : "size-9 justify-center",
            )}
          >
            <SocialIcon id={account.id} className="size-4 shrink-0" />
            {variant === "full" ? (
              <span dir="ltr" className="tabular-nums">
                {account.handle}
              </span>
            ) : null}
          </a>
        </li>
      ))}
    </ul>
  );
}
