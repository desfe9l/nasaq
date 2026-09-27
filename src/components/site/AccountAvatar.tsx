import { accountIdentity } from "@/lib/auth/identity";
import type { AppUser } from "@/lib/auth/use-current-user";
import { cn } from "@/lib/utils";

/**
 * The account avatar: the provider's picture when the session carries one,
 * otherwise the initials of the resolved display name.
 *
 * One component for every surface that shows WHO is signed in (site header,
 * editor header, settings sheet), so the same account never looks like two
 * different people inside the product.
 */
export function AccountAvatar({
  user,
  size = 24,
  className,
}: {
  user: AppUser | null | undefined;
  size?: number;
  className?: string;
}) {
  const identity = accountIdentity(user);
  const box = { width: size, height: size } as const;
  const style = { ...box, fontSize: Math.max(9, Math.round(size * 0.42)) };

  if (identity.avatarUrl) {
    return (
      <img
        src={identity.avatarUrl}
        alt=""
        style={box}
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-navy leading-none font-extrabold text-on-brand",
        className,
      )}
    >
      {identity.initials || identity.label.charAt(0)}
    </span>
  );
}
