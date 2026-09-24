import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { clamp, cn, round } from "@/lib/utils";

/**
 * Scrubbable precision input.
 *
 * Replaces `type="number"` everywhere in the inspector, for two reasons:
 *  · the native spinners are a 12px hit target and cannot be styled
 *    consistently across browsers, so they are useless on a tablet;
 *  · every panel here is metric (mm, pt, %) where the author wants to nudge a
 *    value and watch the canvas — drag-to-scrub is the direct gesture.
 *
 * Desktop: the label/value shows an `ew-resize` cursor and a horizontal drag
 * changes the value (Shift = ×10 for coarse jumps, Alt = ÷10 for fine ones).
 * Touch: explicit − / + buttons at 36×36px sit on both sides of the value.
 *
 * The drag reports live values without history and commits exactly once on
 * release, so one gesture is one undo step — the same contract the range
 * sliders in this panel already follow.
 */
export function ScrubInput({
  value,
  onChange,
  onCommit,
  onClear,
  allowUnset,
  label,
  min = -100000,
  max = 100000,
  step = 0.5,
  precision = 2,
  suffix,
  disabled,
  placeholder,
  className,
}: {
  /**
   * Current value. `undefined` only happens with `allowUnset` (a field that may
   * intentionally carry no override, e.g. «سماكة الإطار — كما في الملف»).
   */
  value: number | undefined;
  /** Live update (no history entry). */
  onChange: (value: number) => void;
  /** Gesture end — the single history entry. Defaults to a no-op. */
  onCommit?: (value: number) => void;
  /** Emptying the field — clears the override (`allowUnset` only). */
  onClear?: () => void;
  /** Let the author empty the field to mean "no value". */
  allowUnset?: boolean;
  /** Accessible name; also the tooltip that explains the drag affordance. */
  label: string;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  suffix?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const drag = useRef<{ x: number; start: number; value: number } | null>(null);
  /*
   * An unset (empty) field still needs a number to scrub FROM, otherwise the
   * first drag or stepper press would have nothing to add to. The seed is the
   * smallest sensible value the field could hold.
   */
  const seed = round(clamp(Math.max(Math.abs(step), 1), min, max), precision);
  const numeric = value ?? seed;
  const latest = useRef(numeric);
  latest.current = numeric;

  const clampValue = useCallback(
    (next: number) => round(clamp(next, min, max), precision),
    [min, max, precision],
  );

  const commitValue = useCallback(
    (next: number) => {
      const applied = clampValue(next);
      onChange(applied);
      onCommit?.(applied);
    },
    [clampValue, onChange, onCommit],
  );

  /**
   * Pointer drag. Listener registration is window-level so a fast drag that
   * leaves the 36px row (or the panel) keeps tracking the pointer — the classic
   * reason a scrubber "sticks" halfway through a gesture.
   */
  const startScrub = useCallback(
    (event: React.PointerEvent) => {
      if (disabled) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      drag.current = { x: event.clientX, start: event.clientX, value: latest.current };
      document.body.classList.add("is-scrubbing-value");

      const move = (ev: PointerEvent) => {
        const state = drag.current;
        if (!state) return;
        // Screen-space delta, multiplied by the step: 1px ≈ one step at normal
        // speed, ×10 with Shift, ÷10 with Alt. Direction is physical (right =
        // increase) which is what the cursor promises in both RTL and LTR.
        const dx = ev.clientX - state.start;
        const factor = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
        const next = clampValue(state.value + dx * step * factor);
        // Keep the reference value fixed so Shift/Alt can be pressed mid-drag
        // without the accumulated delta jumping.
        latest.current = next;
        onChange(next);
      };

      const finish = () => {
        drag.current = null;
        document.body.classList.remove("is-scrubbing-value");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        onCommit?.(latest.current);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [clampValue, disabled, onChange, onCommit, step],
  );

  // A value change from outside (canvas drag, undo) must not leave the input
  // showing a stale draft.
  useEffect(() => {
    setDraft(null);
  }, [value]);

  const display = draft ?? (value === undefined ? "" : String(round(value, precision)));

  const nudge = (direction: 1 | -1) => commitValue(latest.current + step * direction);

  return (
    <div className={cn("scrub-input", disabled && "is-disabled", className)} dir="ltr">
      {/* Touch steppers: 36×36 minimum, so a thumb can land on them reliably. */}
      <button
        type="button"
        className="scrub-stepper"
        disabled={disabled || numeric <= min}
        onClick={() => nudge(-1)}
        aria-label={`إنقاص ${label}`}
        title={`إنقاص ${label}`}
      >
        <Minus className="size-3.5" />
      </button>

      <div
        className="scrub-track"
        onPointerDown={startScrub}
        title={`${label} — اسحب أفقيًا للتغيير (Shift ×10)`}
        role="presentation"
      >
        <input
          type="text"
          inputMode="decimal"
          dir="ltr"
          disabled={disabled}
          aria-label={label}
          placeholder={placeholder}
          value={display}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            const parsed = Number(raw.replace(/[^\d.-]/g, ""));
            if (raw !== "" && Number.isFinite(parsed)) onChange(clampValue(parsed));
          }}
          onBlur={() => {
            const parsed = Number(String(draft ?? "").replace(/[^\d.-]/g, ""));
            if (draft === "" && allowUnset) onClear?.();
            else if (draft !== null && Number.isFinite(parsed)) commitValue(parsed);
            setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
              return;
            }
            if (event.key === "Escape") {
              setDraft(null);
              event.currentTarget.blur();
              return;
            }
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              nudge(event.key === "ArrowUp" ? 1 : -1);
              return;
            }
            // The drag handler must not hijack text selection inside the field.
            event.stopPropagation();
          }}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          className="scrub-field"
        />
        {suffix && <span className="scrub-suffix">{suffix}</span>}
      </div>

      <button
        type="button"
        className="scrub-stepper"
        disabled={disabled || numeric >= max}
        onClick={() => nudge(1)}
        aria-label={`زيادة ${label}`}
        title={`زيادة ${label}`}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * One inspector row: label + scrubbable value.
 *
 * The label itself is the drag handle too (cursor `ew-resize`) — that is the
 * affordance designers reach for first, and it gives the gesture a much larger
 * target than the 36px input.
 */
export function ScrubField({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step,
  precision,
  suffix,
  disabled,
  full,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  suffix?: string;
  disabled?: boolean;
  full?: boolean;
}) {
  return (
    <div className={cn("editor-property-field grid gap-1", full && "col-span-2")}>
      <ScrubLabel label={label} value={value} onScrub={onChange} onCommit={onCommit} min={min} max={max} step={step} precision={precision} disabled={disabled} />
      <ScrubInput
        label={label}
        value={value}
        onChange={onChange}
        onCommit={onCommit}
        min={min}
        max={max}
        step={step}
        precision={precision}
        suffix={suffix}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * The label half of `ScrubField`, exposed separately so composite rows (colour
 * rows, selects) can borrow the same drag-to-change affordance.
 */
export function ScrubLabel({
  label,
  value,
  onScrub,
  onCommit,
  min = -100000,
  max = 100000,
  step = 0.5,
  precision = 2,
  disabled,
  trailing,
}: {
  label: string;
  value: number;
  onScrub: (value: number) => void;
  onCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  disabled?: boolean;
  trailing?: React.ReactNode;
}) {
  const start = useRef<{ x: number; base: number } | null>(null);
  const current = useRef(value);
  current.current = value;

  const onPointerDown = (event: React.PointerEvent) => {
    if (disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    start.current = { x: event.clientX, base: value };
    document.body.classList.add("is-scrubbing-value");
    const move = (ev: PointerEvent) => {
      const state = start.current;
      if (!state) return;
      const dx = ev.clientX - state.x;
      const factor = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const next = round(clamp(state.base + dx * step * factor, min, max), precision);
      current.current = next;
      onScrub(next);
    };
    const finish = () => {
      start.current = null;
      document.body.classList.remove("is-scrubbing-value");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      onCommit?.(current.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  return (
    <span className="flex items-center justify-between gap-1 text-[11px] font-extrabold text-muted">
      <span
        onPointerDown={onPointerDown}
        className={cn("scrub-label min-w-0 flex-1 truncate", !disabled && "is-scrubbable")}
        title={`${label} — اسحب أفقيًا للتغيير (Shift ×10)`}
      >
        {label}
      </span>
      {trailing}
    </span>
  );
}
