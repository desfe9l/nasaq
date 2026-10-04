import {
  IMAGE_FRAME_GROUPS,
  IMAGE_FRAMES,
  imageFrameDef,
  type ImageFrameDef,
} from "@/lib/editor/image-frames";
import { cn } from "@/lib/utils";
import { ShapePreview } from "./ShapePreview";

/**
 * «أشكال الصور» — the visual frame gallery.
 *
 * One compact grid of silhouettes, no paragraphs: the shape IS the label, and
 * the name lives in the tooltip / accessible name. Two modes share it:
 *
 *   · `insert` (أدوات التقرير) — a click puts a framed picture on the page;
 *   · `apply` (خصائص الصورة) — a click changes the frame of the selected
 *     picture, and the first tile takes the frame off again.
 *
 * Either way the result is an ordinary, fully editable `image` element: the
 * frame is `style.frameId`, so replacing the photo, cropping inside the frame,
 * resizing and rotating all keep the silhouette.
 */
export function ImageFrameGallery({
  mode,
  activeId,
  onPick,
  disabled,
  className,
}: {
  mode: "insert" | "apply";
  /** Currently applied frame (apply mode) — highlighted, never re-inserted. */
  activeId?: string | null;
  /** `null` clears the frame (apply mode only). */
  onPick: (frameId: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const active = imageFrameDef(activeId)?.id ?? null;
  return (
    <div className={cn("image-frame-gallery", className)} dir="rtl">
      {IMAGE_FRAME_GROUPS.map((group) => {
        const frames = IMAGE_FRAMES.filter((frame) => frame.group === group.id);
        if (!frames.length) return null;
        return (
          <div key={group.id} className="image-frame-group">
            <span className="image-frame-group-title" title={group.label}>
              {group.label}
            </span>
            <div className="image-frame-grid">
              {mode === "apply" && group.id === "basic" && (
                <FrameTile
                  frame={null}
                  active={!active}
                  disabled={disabled}
                  onPick={onPick}
                />
              )}
              {frames.map((frame) => (
                <FrameTile
                  key={frame.id}
                  frame={frame}
                  active={active === frame.id}
                  disabled={disabled}
                  onPick={onPick}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FrameTile({
  frame,
  active,
  disabled,
  onPick,
}: {
  frame: ImageFrameDef | null;
  active: boolean;
  disabled?: boolean;
  onPick: (frameId: string | null) => void;
}) {
  const label = frame ? frame.label : "بلا إطار";
  return (
    <button
      type="button"
      className={cn("image-frame-tile", active && "is-active")}
      title={frame ? `${label} — أضف صورة بهذا الشكل` : label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={() => onPick(frame ? frame.id : null)}
    >
      {frame ? (
        <ShapePreview shapeId={frame.shapeId} className="size-full max-h-6" />
      ) : (
        <span className="image-frame-none" aria-hidden />
      )}
    </button>
  );
}
