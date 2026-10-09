import { cn } from "@/lib/utils";

export type ButtonVariant =
  | "primary"
  | "outline"
  | "ghost"
  | "inverse"
  | "brand"
  | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md,10px)] font-extrabold text-[0.875rem] font-sans transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-[var(--ease-standard,_cubic-bezier(0.2,0.8,0.2,1))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50";

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-9 min-h-[36px] min-w-[36px] px-3.5 text-[0.75rem]",
  md: "h-11 min-h-[44px] min-w-[44px] px-5 text-[0.875rem]",
  lg: "h-12 min-h-[48px] min-w-[48px] px-7 text-[1rem]",
};

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-navy text-on-brand border border-navy hover:bg-navy-2 hover:shadow-[0_4px_14px_color-mix(in_srgb,var(--color-navy)_35%,transparent)] active:translate-y-[1px]",
  outline:
    "border border-line bg-surface text-ink hover:bg-surface-2 hover:border-line/80",
  ghost:
    "border-transparent bg-transparent text-muted hover:bg-line-2 hover:text-ink",
  inverse:
    "bg-inverse text-on-inverse border border-inverse hover:bg-inverse-hover",
  brand:
    "text-brand hover:bg-navy/8 hover:text-brand-hover",
  danger:
    "border border-error bg-error text-on-inverse hover:bg-error/90",
};

export type PremiumButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ComponentType<{ className?: string }>;
  iconPosition?: "start" | "end";
  loading?: boolean;
};

export function PremiumButton({
  variant = "primary",
  size = "md",
  className,
  children,
  icon: Icon,
  iconPosition = "start",
  loading = false,
  disabled,
  ...props
}: PremiumButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      className={cn(
        buttonBase,
        buttonVariants[variant],
        buttonSizes[size],
        loading && "cursor-wait opacity-70",
        className,
      )}
      disabled={isDisabled}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.073 1.639 5.837 4.172 7.422l1.828-2.131z"
          />
        </svg>
      )}
      {Icon && !loading && iconPosition === "start" && (
        <Icon className="size-4 shrink-0" aria-hidden />
      )}
      {children}
      {Icon && !loading && iconPosition === "end" && (
        <Icon className="size-4 shrink-0" aria-hidden />
      )}
    </button>
  );
}
