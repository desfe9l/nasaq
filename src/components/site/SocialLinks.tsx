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

/** Brand glyphs lucide does not ship. Sized by `currentColor` like the rest. */
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M16.5 2h-2.8v13.1a2.6 2.6 0 1 1-2.6-2.6c.2 0 .5 0 .7.1V9.7a5.6 5.6 0 1 0 4.7 5.5V8.9a6.6 6.6 0 0 0 3.8 1.2V7.3a3.8 3.8 0 0 1-3.8-3.8V2Z" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M17.5 3h3.2l-7 8 8.2 10h-6.4l-5-6.1L4.7 21H1.5l7.5-8.6L1.2 3h6.6l4.5 5.6L17.5 3Zm-1.1 16.1h1.8L7.7 4.8H5.8l10.6 14.3Z" />
    </svg>
  );
}

function SocialIcon({ id, className }: { id: SocialAccount["id"]; className?: string }) {
  if (id === "instagram") return <Instagram className={className} />;
  if (id === "tiktok") return <TikTokIcon className={className} />;
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
            // the platform too — a screen reader must not hear "@nasaq_ar" twice
            // with no way to tell the two links apart.
            aria-label={`${account.label} — ${account.handle}`}
            title={`${account.label} ${account.handle}`}
            className={cn(
              "inline-flex items-center rounded-[8px] border border-line text-muted transition hover:border-navy-2 hover:text-navy-2 dark:border-white/10 dark:hover:border-gold-2 dark:hover:text-gold-2",
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
