import { cn } from "@/lib/utils";

export type BadgeVariant = "brand" | "gold" | "neutral" | "ok" | "warn" | "danger" | "emerald";
export type BadgeSize = "sm" | "md";

const badgeBase =
  "inline-flex items-center gap-1 rounded-full font-extrabold letter-[0.02em] text-[0.625rem] leading-[1.2] whitespace-nowrap";

const badgeVariants: Record<BadgeVariant, string> = {
  brand: "bg-navy text-on-brand",
  gold: "bg-gold text-on-gold",
  neutral:
    "border border-line bg-surface-2 text-muted",
  ok: "bg-ok/10 text-success",
  warn: "bg-warning/10 text-warning",
  danger: "bg-error/10 text-error",
  emerald: "border border-brand/20 bg-brand/10 text-brand",
};

const badgeSizes: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5",
  md: "px-2.5 py-1",
};

export function Badge({
  children,
  variant = "neutral",
  size = "md",
  icon: Icon,
  dot = false,
  ltr = false,
  className,
  ...props
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: React.ComponentType<{ className?: string }>;
  dot?: boolean;
  ltr?: boolean;
  className?: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      dir={ltr ? "ltr" : undefined}
      className={cn(badgeBase, badgeVariants[variant], badgeSizes[size], className)}
      {...props}
    >
      {dot && (
        <span
          className="size-1.5 rounded-full bg-current opacity-80"
          aria-hidden
        />
      )}
      {Icon && <Icon className="size-2.5 shrink-0" aria-hidden />}
      {children}
    </span>
  );
}

