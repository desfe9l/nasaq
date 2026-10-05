import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  DEFAULT_GRADIENT,
  normalizeGradient,
  paintCss,
  type Gradient,
} from "@/lib/editor/gradient";
import {
  normalizeColorHex,
  recordRecentColor,
} from "@/lib/editor/recent-colors";
import { uid } from "@/lib/utils";
import { AnchorMenu } from "./AnchorMenu";
import { ColorField } from "./ColorField";
import { ScrubInput } from "./ScrubInput";

interface FillProps {
  value?: string;
  gradient?: Gradient;
  fallback?: string;
  label?: string;
  className?: string;
  allowGradient?: boolean;
  onChange: (color: string, gradient?: Gradient) => void;
  onCommit: (color: string, gradient?: Gradient) => void;
}
const CHECKER =
  "repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%) 50% / 10px 10px";

/** One paint control, composed from the editor's existing colour picker/recents. */
export function FillField(props: FillProps) {
  const {
    value,
    gradient,
    fallback = "#006c35",
    label = "التعبئة",
    className,
  } = props;
  return (
    <AnchorMenu
      label={label}
      width={272}
      drawer={{ id: "paint", title: label }}
      trigger={({ ref, ...trigger }) => (
        <button
          {...trigger}
          ref={ref}
          type="button"
          aria-label={label}
          title={label}
          className={`color-field-trigger ${className || ""}`}
          style={{
            background:
              value === "none" && !gradient
                ? CHECKER
                : paintCss(value, gradient, fallback),
          }}
        />
      )}
    >
      <FillEditor {...props} />
    </AnchorMenu>
  );
}

export function FillEditor({
  value,
  gradient,
  fallback = "#006c35",
  onChange,
  onCommit,
  allowGradient = true,
}: FillProps) {
  const g = normalizeGradient(gradient);
  const solid = normalizeColorHex(value) || fallback;
  const mode =
    g?.type || (value === "none" || value === "transparent" ? "none" : "solid");
  const [selected, setSelected] = useState(g?.stops[0]?.id || "start");
  const current = g?.stops.find((s) => s.id === selected) || g?.stops[0];
  const latest = useRef({ color: value || solid, gradient: g });
  latest.current = { color: value || solid, gradient: g };
  const apply = (color: string, next?: Gradient, commit = false) => {
    const normalized = normalizeGradient(next);
    latest.current = { color, gradient: normalized };
    onChange(color, normalized);
    if (commit) {
      normalized?.stops.forEach((s) => recordRecentColor(s.color));
      onCommit(color, normalized);
    }
  };
  const changeGradient = (next: Gradient, commit = false) =>
    apply(value || solid, next, commit);
  const patchStop = (
    patch: Partial<Gradient["stops"][number]>,
    commit = false,
  ) => {
    const live = latest.current.gradient || g;
    if (!live || !current) return;
    changeGradient(
      {
        ...live,
        stops: live.stops.map((s) =>
          s.id === current.id ? { ...s, ...patch } : s,
        ),
      },
      commit,
    );
  };
  const finish = () => {
    const v = latest.current;
    v.gradient?.stops.forEach((s) => recordRecentColor(s.color));
    onCommit(v.color, v.gradient);
  };
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const stopDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    id: string,
  ) => {
    if (event.button !== 0 || !event.isPrimary) return;
    dragCleanup.current?.();
    event.preventDefault();
    event.stopPropagation();
    setSelected(id);
    const track = event.currentTarget.parentElement!.getBoundingClientRect();
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    target.setPointerCapture(pointerId);
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const live = latest.current.gradient;
      if (!live) return;
      changeGradient({
        ...live,
        stops: live.stops.map((s) =>
          s.id === id
            ? {
                ...s,
                offset: Math.min(
                  1,
                  Math.max(0, (e.clientX - track.left) / track.width),
                ),
              }
            : s,
        ),
      });
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (e.type === "pointerup") move(e);
      dragCleanup.current?.();
    };
    dragCleanup.current = () => {
      dragCleanup.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (target.hasPointerCapture(pointerId))
        target.releasePointerCapture(pointerId);
      finish();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  return (
    <div className="fill-editor grid gap-2" dir="rtl">
      <select
        aria-label="نوع التعبئة"
        className="editor-drawer-select"
        value={mode}
        onChange={(event) => {
          const type = event.target.value;
          if (type === "none") return apply("none", undefined, true);
          if (type === "solid") return apply(solid, undefined, true);
          const next: Gradient = g || {
            ...DEFAULT_GRADIENT,
            stops: DEFAULT_GRADIENT.stops.map((s, i) => ({
              ...s,
              color: i === 0 ? solid : s.color,
            })),
          };
          apply(solid, { ...next, type: type as Gradient["type"] }, true);
        }}
      >
        <option value="solid">لون موحّد</option>
        <option value="none">شفاف</option>
        {allowGradient && (
          <>
            <option value="linear">تدرّج خطي</option>
            <option value="radial">تدرّج دائري</option>
          </>
        )}
      </select>
      {mode === "solid" && (
        <ColorField
          value={value}
          fallback={fallback}
          label="لون التعبئة"
          className="h-9 w-full"
          onChange={(color) => apply(color)}
          onCommit={(color) => apply(color, undefined, true)}
        />
      )}
      {g && (
        <>
          <div
            className="gradient-stop-track"
            dir="ltr"
            style={{ background: paintCss(undefined, g) }}
            aria-label="نقاط ألوان التدرّج"
          >
            {g.stops.map((stop, index) => (
              <button
                key={stop.id}
                type="button"
                className="gradient-stop"
                aria-pressed={current?.id === stop.id}
                aria-label={`نقطة اللون ${index + 1}`}
                title={`${Math.round(stop.offset * 100)}%`}
                style={{
                  left: `${stop.offset * 100}%`,
                  background: stop.color,
                }}
                onClick={() => setSelected(stop.id)}
                onPointerDown={(e) => stopDrag(e, stop.id)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                  e.preventDefault();
                  setSelected(stop.id);
                  changeGradient(
                    {
                      ...g,
                      stops: g.stops.map((s) =>
                        s.id === stop.id
                          ? {
                              ...s,
                              offset: Math.max(
                                0,
                                Math.min(
                                  1,
                                  s.offset +
                                    (e.key === "ArrowRight" ? 0.01 : -0.01),
                                ),
                              ),
                            }
                          : s,
                      ),
                    },
                    true,
                  );
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <ColorField
              value={current?.color}
              label="لون نقطة التدرّج"
              className="h-9 flex-1"
              onChange={(color) => patchStop({ color })}
              onCommit={(color) => patchStop({ color }, true)}
            />
            <button
              type="button"
              aria-label="إضافة نقطة لون"
              title="إضافة نقطة لون"
              className="editor-icon-btn"
              disabled={g.stops.length >= 16}
              onClick={() => {
                const id = uid("stop");
                setSelected(id);
                changeGradient(
                  {
                    ...g,
                    stops: [
                      ...g.stops,
                      {
                        id,
                        offset: 0.5,
                        color: current?.color || solid,
                        opacity: 1,
                      },
                    ],
                  },
                  true,
                );
              }}
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              aria-label="حذف نقطة اللون"
              title="حذف نقطة اللون"
              className="editor-icon-btn"
              disabled={g.stops.length <= 2}
              onClick={() => {
                if (!current) return;
                const stops = g.stops.filter((s) => s.id !== current.id);
                setSelected(stops[0].id);
                changeGradient({ ...g, stops }, true);
              }}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-[10px] text-muted">
              موضع النقطة
              <ScrubInput
                label="موضع نقطة اللون"
                value={Math.round((current?.offset || 0) * 100)}
                min={0}
                max={100}
                suffix="%"
                onChange={(v) => patchStop({ offset: v / 100 })}
                onCommit={(v) => patchStop({ offset: v / 100 }, true)}
              />
            </label>
            <label className="grid gap-1 text-[10px] text-muted">
              عتامة اللون
              <ScrubInput
                label="عتامة نقطة اللون"
                value={Math.round((current?.opacity ?? 1) * 100)}
                min={0}
                max={100}
                suffix="%"
                onChange={(v) => patchStop({ opacity: v / 100 })}
                onCommit={(v) => patchStop({ opacity: v / 100 }, true)}
              />
            </label>
          </div>
          {g.type === "linear" ? (
            <label className="grid gap-1 text-[10px] text-muted">
              زاوية التدرّج
              <ScrubInput
                label="زاوية التدرّج"
                value={g.angle}
                min={0}
                max={360}
                suffix="°"
                onChange={(angle) => changeGradient({ ...g, angle })}
                onCommit={(angle) => changeGradient({ ...g, angle }, true)}
              />
            </label>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-[10px] text-muted">
                مركز أفقي
                <ScrubInput
                  label="مركز التدرّج أفقي"
                  value={g.cx}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(cx) => changeGradient({ ...g, cx })}
                  onCommit={(cx) => changeGradient({ ...g, cx }, true)}
                />
              </label>
              <label className="grid gap-1 text-[10px] text-muted">
                مركز رأسي
                <ScrubInput
                  label="مركز التدرّج رأسي"
                  value={g.cy}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(cy) => changeGradient({ ...g, cy })}
                  onCommit={(cy) => changeGradient({ ...g, cy }, true)}
                />
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
}
