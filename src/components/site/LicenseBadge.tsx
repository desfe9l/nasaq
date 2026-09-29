/**
 * Unified license status badge — the one visual treatment for
 * licensed vs. locked content across the whole product.
 *
 * Two states, immediately distinguishable at a glance:
 *
 *   ── licensed ──────────────────────────────────────────────────────────
 *   A refined BadgeCheck icon inside a solid-bordered pill with a subtle
 *   navy/emerald tint. Communicates: available, authorized, premium, trusted.
 *
 *   ── locked ──────────────────────────────────────────────────────────────
 *   A Lock icon inside a dashed-border pill with a muted gold tint.
 *   Communicates: restricted, requires license, locked — without looking
 *   disabled or broken. If `href` is provided the pill becomes a link so
 *   the affordance is visually clear.
 *
 * Both states share the same height, font weight, icon size, and padding so
 * they sit side by side in a grid without visual jitter. The distinction is
 * carried by iconography + border style + tint — not by colour alone, so it
 * survives in both themes and for colour-blind users.
 *
 * RTL: the icon always leads the label (inset-inline-start), so the reading
 * order is correct in Arabic without mirroring the component.
 */

import type { ComponentType, SVGProps } from "react";
import { BadgeCheck, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

type LicenseState = "licensed" | "locked";

interface LicenseBadgeProps {
  state: LicenseState;
  /** The Arabic label — defaults to the standard copy for each state. */
  label?: string;
  /** Tooltip / accessible description. */
  title?: string;
  /** When provided, the badge renders as <a> (e.g. to /license). */
  href?: string;
  /** Click handler (used when the badge is a button, not a link). */
  onClick?: () => void;
  className?: string;
  size?: "sm" | "md";
}

const DEFAULTS: Record<
  LicenseState,
  { label: string; title: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }
> = {
  licensed: {
    label: "متاح بترخيصك",
    title: "هذا المحتوى متاح ضمن ترخيصك الحالي",
    Icon: BadgeCheck,
  },
  locked: {
    label: "متاح في النسخة الكاملة",
    title: "هذا المحتوى يتطلب ترخيصًا — اضغط للتفعيل",
    Icon: Lock,
  },
};

/**
 * Visual classes per state.
 *
 * licensed: solid border, navy tint, brand text — reads as "authorized".
 * locked:  dashed border, gold tint, ink text — reads as "restricted".
 *
 * The dashed border is the non-colour cue: even in monochrome the two states
 * are distinguishable.
 */
const STATE_CLASSES: Record<LicenseState, string> = {
  licensed:
    "border-brand/30 bg-brand/10 text-brand-hover hover:border-brand/50 hover:bg-brand/15 dark:border-brand/45 dark:bg-brand/15 dark:text-white",
  locked:
    "border-gold/40 border-dashed bg-gold/12 text-ink hover:border-gold/60 hover:bg-gold/18 dark:border-gold/55 dark:bg-gold/15 dark:text-white",
};

const SIZE_CLASSES = {
  sm: "h-5 px-2 text-[10px] gap-1",
  md: "h-6 px-2.5 text-[11px] gap-1.5",
};

const ICON_SIZE = {
  sm: "size-3",
  md: "size-3.5",
};

export function LicenseBadge({
  state,
  label,
  title,
  href,
  onClick,
  className,
  size = "sm",
}: LicenseBadgeProps) {
  const defaults = DEFAULTS[state];
  const text = label ?? defaults.label;
  const tooltip = title ?? defaults.title;
  const Icon = defaults.Icon;

  const classes = cn(
    "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border font-extrabold leading-none backdrop-blur-[2px] transition-colors duration-140",
    STATE_CLASSES[state],
    SIZE_CLASSES[size],
    className,
  );

  const icon = (
    <>
      <Icon
        className={cn(ICON_SIZE[size], "shrink-0")}
        aria-hidden
        strokeWidth={2.25}
      />
    </>
  );

  const content = (
    <>
      {icon}
      <span className="truncate">{text}</span>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className={classes}
        title={tooltip}
        aria-label={tooltip}
        onClick={onClick}
      >
        {content}
      </a>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        title={tooltip}
        aria-label={tooltip}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={classes} title={tooltip} role="img" aria-label={tooltip}>
      {content}
    </span>
  );
}

/**
 * Compact variant — icon only, no label. Used in tight rows where the
 * full badge would crowd the layout (e.g. card corners, table cells).
 */
export function LicenseBadgeIcon({
  state,
  title,
  className,
}: {
  state: LicenseState;
  title?: string;
  className?: string;
}) {
  const defaults = DEFAULTS[state];
  const Icon = defaults.Icon;
  const tooltip = title ?? defaults.title;

  return (
    <span
      className={cn(
        "grid size-5 place-items-center rounded-full border backdrop-blur-[2px] transition-colors duration-140",
        STATE_CLASSES[state],
        className,
      )}
      title={tooltip}
      role="img"
      aria-label={tooltip}
    >
      <Icon className="size-3 shrink-0" aria-hidden strokeWidth={2.25} />
    </span>
  );
}

export default LicenseBadge;
