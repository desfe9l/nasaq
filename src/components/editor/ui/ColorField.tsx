import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  getRecentColors,
  normalizeColorHex,
  recordRecentColor,
  subscribeRecentColors,
} from "@/lib/editor/recent-colors";

/**
 * Unified compact colour picker — the ONE colour control of the editor.
 *
 * Contract (same live/commit split as every other property input):
 *   • `onChange` fires continuously while the colour moves (live apply, no
 *     history entry per intermediate value);
 *   • `onCommit` fires once when the picking session ends (close / blur) and
 *     records the colour into Recent Colors — ONE history entry per pick.
 *
 * Popup is portalled to `document.body` as `position: fixed` so it can never
 * be clipped by the properties panel's scroll box, and it re-anchors on
 * scroll/resize so it always stays inside the viewport.
 *
 * `value === "none"` (allowNone fields) paints the swatch as a checkerboard —
 * "no fill" is a state you can see, not a mystery colour.
 */
export function ColorField({
  value,
  fallback = "#000000",
  onChange,
  onCommit,
  allowNone = false,
  label,
  className,
}: {
  /** Raw style value — hex, "", "none" … straight from the element. */
  value: string | undefined;
  /** What the swatch/native picker shows when there is no explicit colour. */
  fallback?: string;
  /** Live apply, called on every intermediate colour. */
  onChange: (v: string) => void;
  /**
   * Session end: persist to history + recents. Receives the session's FINAL
   * colour (never a render-closure value) — an apply and its commit can land
   * in the same click, when props are still the pre-change render.
   */
  onCommit?: (v: string) => void;
  /** Offer a «بلا تعبئة» action that writes the literal "none". */
  allowNone?: boolean;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [recents, setRecents] = useState<string[]>(() => getRecentColors());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Latest raw value without re-binding effects. */
  const valueRef = useRef(value);
  valueRef.current = value;
  /** A change happened in this open session → closing must commit it. */
  const dirtyRef = useRef(false);
  /** The last colour this session actually applied (see `onCommit` above). */
  const appliedRef = useRef<string | null>(null);

  useEffect(() => subscribeRecentColors(() => setRecents(getRecentColors())), []);

  const raw = (value || "").trim();
  const isNone = allowNone && raw === "none";
  const picked = normalizeColorHex(raw);
  const shown = isNone ? "" : picked || fallback;
  // Native <input type=color> only understands #rrggbb — expand shorthands and
  // drop any alpha tail so the OS picker shows the real colour instead of black.
  const native = shown ? shown.slice(0, 7) : "#000000";
  const checker =
    "repeating-conic-gradient(#e5e7eb 0% 25%, #ffffff 0% 50%) 50% / 10px 10px";

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const W = 240;
    const H = 168;
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - W - 8));
    let top = r.bottom + 6;
    if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - H - 6);
    setPos({ left, top });
  }, []);

  const finish = useCallback(() => {
    setOpen(false);
    setPos(null);
    if (dirtyRef.current) {
      dirtyRef.current = false;
      const finalValue = appliedRef.current ?? valueRef.current ?? "";
      appliedRef.current = null;
      recordRecentColor(finalValue);
      onCommit?.(finalValue);
    }
  }, [onCommit]);

  const openIt = useCallback(() => {
    dirtyRef.current = false;
    appliedRef.current = null;
    setOpen(true);
    place();
  }, [place]);

  useEffect(() => {
    if (!open) return;
    place();
    const reposition = () => place();
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      finish();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        finish();
      }
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, place, finish]);

  const apply = (v: string) => {
    dirtyRef.current = true;
    appliedRef.current = v;
    onChange(v);
  };

  /** Hex typing mirrors ColorRow: accept any `#`+0..8 hex prefix, live. */
  const hexDraft = isNone ? "" : raw;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn("color-field-trigger", className)}
        title={label || "لون"}
        aria-label={label || "اختيار اللون"}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{ background: isNone ? checker : shown }}
        onClick={() => (open ? finish() : openIt())}
        onContextMenu={(e) => e.preventDefault()}
      />
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="color-field-pop fixed z-[var(--z-context)] w-[240px] rounded-[10px] border border-line bg-white p-2 shadow-2xl dark:border-white/15 dark:bg-[#1e2633]"
            style={{ left: pos.left, top: pos.top }}
            role="dialog"
            aria-label={label || "منتقي اللون"}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-8 shrink-0 rounded-[6px] border border-line dark:border-white/15"
                style={{ background: isNone ? checker : shown }}
              />
              <input
                dir="ltr"
                spellCheck={false}
                aria-label="قيمة HEX"
                placeholder={isNone ? "بلا تعبئة" : "#000000"}
                value={hexDraft}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (/^#[0-9a-fA-F]{0,8}$/.test(v)) apply(v);
                }}
                className="h-9 min-w-0 flex-1 rounded-[8px] border border-line px-2 text-[12px] font-semibold text-ink outline-none focus:border-navy dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
              <input
                type="color"
                aria-label="منتقي اللون"
                title="منتقي اللون"
                value={native}
                onChange={(e) => apply(e.target.value)}
                className="h-9 w-10 shrink-0 cursor-pointer rounded-[8px] border border-line bg-white p-1 dark:border-white/10 dark:bg-white/5"
              />
            </div>
            {allowNone && (
              <button
                type="button"
                onClick={() => {
                  apply("none");
                  finish();
                }}
                className="mt-2 h-8 w-full rounded-[8px] border border-line text-[11px] font-extrabold text-ink hover:bg-line-2 dark:border-white/10 dark:text-white dark:hover:bg-white/10"
              >
                بلا تعبئة (إخفاء اللون)
              </button>
            )}
            <div className="mt-2 text-[10px] font-extrabold text-muted">
              الألوان الأخيرة
            </div>
            <div className="mt-1 flex min-h-6 flex-wrap gap-1">
              {recents.length === 0 && (
                <span className="text-[10px] font-bold text-muted">
                  اختر لونًا ليظهر هنا
                </span>
              )}
              {recents.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  aria-label={`لون أخير ${c}`}
                  onClick={() => apply(c)}
                  style={{ background: c }}
                  className={cn(
                    "size-5 rounded-[5px] border",
                    picked === c
                      ? "border-navy ring-2 ring-navy/40"
                      : "border-line dark:border-white/20",
                  )}
                />
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
