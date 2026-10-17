import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export type PremiumInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
  icon?: React.ComponentType<{ className?: string }>;
  iconPosition?: "start" | "end";
  containerClassName?: string;
};

/**
 * PremiumInput — Reusable institutional form input for NASAQ.
 *
 * Implements accessible labels, error state reporting, role-token styling
 * that adapts cleanly between Light, Dark, and Dim modes, and unified focus rings.
 */
export const PremiumInput = forwardRef<HTMLInputElement, PremiumInputProps>(
  (
    {
      label,
      hint,
      error,
      icon: Icon,
      iconPosition = "start",
      className,
      containerClassName,
      id,
      disabled,
      ...props
    },
    ref,
  ) => {
    const inputId = id ?? (label ? `input-${label.replace(/\s+/g, "-")}` : undefined);

    return (
      <div className={cn("grid gap-1.5", containerClassName)}>
        {label && (
          <label
            htmlFor={inputId}
            className="text-[12px] font-bold text-ink"
          >
            {label}
          </label>
        )}

        <div className="relative flex items-center">
          {Icon && iconPosition === "start" && (
            <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-muted">
              <Icon className="size-4" aria-hidden />
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            aria-invalid={Boolean(error)}
            aria-describedby={
              error
                ? `${inputId}-error`
                : hint
                  ? `${inputId}-hint`
                  : undefined
            }
            className={cn(
              "h-11 w-full rounded-[var(--radius-md,10px)] border bg-page px-3 text-[13px] font-bold text-ink outline-none transition-[border-color,box-shadow,background-color] duration-150 focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50",
              error ? "border-danger/70 text-error" : "border-line",
              Icon && iconPosition === "start" && "ps-9",
              Icon && iconPosition === "end" && "pe-9",
              className,
            )}
            {...props}
          />

          {Icon && iconPosition === "end" && (
            <div className="pointer-events-none absolute inset-y-0 end-0 flex items-center pe-3 text-muted">
              <Icon className="size-4" aria-hidden />
            </div>
          )}
        </div>

        {error && (
          <span
            id={`${inputId}-error`}
            className="text-[11px] font-bold text-error"
            role="alert"
          >
            {error}
          </span>
        )}

        {hint && !error && (
          <span
            id={`${inputId}-hint`}
            className="text-[11px] text-muted"
          >
            {hint}
          </span>
        )}
      </div>
    );
  },
);

PremiumInput.displayName = "PremiumInput";
