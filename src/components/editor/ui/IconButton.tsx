import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";
import { Tip } from "./Tip";

/**
 * The one icon-only control of the studio.
 *
 * Every panel gateway, toolbar action, dock tool and floating-panel button is
 * this component, which is what makes the chrome read as a single system:
 * identical box, identical radius, identical icon size, identical tooltip
 * behaviour (hover on pointer devices, long-press on touch). A tooltip is not
 * optional here — `label` is required and always rendered, so a control can
 * never ship without an explanation of what it does.
 */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  /** Tool name — the accessible name and the tooltip headline. */
  label: string;
  /** One short line of purpose, shown in the tooltip. */
  hint?: string;
  /** Keyboard shortcut, shown as a key cap in the tooltip. */
  shortcut?: string;
  /** Filled state for toggles (on/off panels, active tools). */
  active?: boolean;
  /** Destructive actions (delete, discard). */
  danger?: boolean;
  /** Brand-filled primary action (export). */
  primary?: boolean;
  icon: ReactNode;
  /** Tooltip side; flipped automatically near a viewport edge. */
  tipSide?: "top" | "bottom";
  /** Extra class on the button box (sizing overrides, not colour). */
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  label,
  hint,
  shortcut,
  active,
  danger,
  primary,
  icon,
  tipSide = "bottom",
  className,
  children,
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <Tip label={label} hint={hint} shortcut={shortcut} side={tipSide}>
      <button
        ref={ref}
        type="button"
        className={cn(
          "editor-icon-btn",
          active && "is-active",
          danger && "is-danger",
          primary && "is-primary",
          className,
        )}
        aria-label={label}
        aria-keyshortcuts={shortcut || undefined}
        {...rest}
      >
        <span className="editor-icon-glyph" aria-hidden="true">
          {icon}
        </span>
        {children}
      </button>
    </Tip>
  );
}
