import { cn } from "@/lib/utils";

export type CardVariant = "default" | "elevated" | "interactive" | "outline";
export type CardPadding = "none" | "sm" | "md" | "lg";

const cardBase =
  "rounded-[var(--radius-lg,14px)] bg-surface border border-line transition-[box-shadow,border-color,transform] duration-200 ease-[var(--ease-standard,_cubic-bezier(0.2,0.8,0.2,1))]";

const cardVariants: Record<CardVariant, string> = {
  default: "shadow-card",
  elevated: "shadow-panel",
  interactive: "shadow-card hover:-translate-y-0.5 hover:shadow-card-hover cursor-pointer",
  outline: "shadow-none border-2 border-line bg-transparent",
};

const cardPadding: Record<CardPadding, string> = {
  none: "p-0",
  sm: "p-3",
  md: "p-5",
  lg: "p-6",
};

export type PremiumCardProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
  padding?: CardPadding;
  active?: boolean;
};

export function PremiumCard({
  variant = "default",
  padding = "md",
  active = false,
  className,
  ...props
}: PremiumCardProps) {
  return (
    <div
      className={cn(
        cardBase,
        cardVariants[variant],
        cardPadding[padding],
        active &&
          "border-brand/35 ring-1 ring-brand/15 shadow-card-hover",
        className,
      )}
      data-card=""
      {...props}
    />
  );
}

export type CardHeaderProps = React.HTMLAttributes<HTMLDivElement>;

export function CardHeader({ className, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 pb-3",
        className,
      )}
      {...props}
    />
  );
}

export type CardTitleProps = React.HTMLAttributes<HTMLHeadingElement>;

export function CardTitle({ className, ...props }: CardTitleProps) {
  return (
    <h3
      className={cn(
        "text-[1.125rem] font-extrabold leading-[1.3] text-ink",
        className,
      )}
      {...props}
    />
  );
}

export type CardDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>;

export function CardDescription({ className, ...props }: CardDescriptionProps) {
  return (
    <p
      className={cn(
        "mt-1 text-[0.85rem] leading-[1.55] text-muted",
        className,
      )}
      {...props}
    />
  );
}

export type CardContentProps = React.HTMLAttributes<HTMLDivElement>;

export function CardContent({ className, ...props }: CardContentProps) {
  return (
    <div
      className={cn("pt-2", className)}
      {...props}
    />
  );
}

export type CardFooterProps = React.HTMLAttributes<HTMLDivElement>;

export function CardFooter({ className, ...props }: CardFooterProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 pt-4",
        className,
      )}
      {...props}
    />
  );
}
