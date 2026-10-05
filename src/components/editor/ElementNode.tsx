import { memo, useCallback, useEffect, useRef, useId } from "react";
import { ICONS, cssFont, parseTable, type CanvasEl } from "@/lib/editor/model";
import {
  prepareText,
  textBoxMode,
  textPadding,
  type PageContext,
} from "@/lib/editor/text-render";
import { useEditor } from "@/lib/editor/store";
import { useInteraction } from "@/lib/editor/interaction-store";
import { cn, round as round2 } from "@/lib/utils";
import { applyNumerals } from "@/lib/editor/arabic";
import { fadeStyle, normalizeFade } from "@/lib/editor/fade";
import { imageAdjustCss, safeImageSrc, sharpnessKernel } from "@/lib/editor/images";
import { applySvgColors, sanitizeSvgContent } from "@/lib/editor/svg";
import { isCompoundShape, shapeDef, type ShapePart } from "@/lib/editor/shapes";
import {
  dashArrayForUnits,
  shapeIdOf,
  strokeToUnits,
} from "@/lib/editor/shape-render";
import {
  frameClipParts,
  frameFillRule,
  frameOfStyle,
} from "@/lib/editor/image-frames";
import { mapShapePart } from "@/lib/editor/shape-affine";
import { isPalmTouch } from "@/lib/editor/pen-input";
import { gradientCss, paintCss } from "@/lib/editor/gradient";
import { imageLayout, normalizeCrop } from "@/lib/editor/image-crop";
import { useImageLoadState } from "@/lib/editor/use-image-load";
import { GradientDefs } from "./GradientDefs";
import { ShapeGlyph, ShapeParts } from "./ShapeGlyph";

/**
 * Pointerdown shared by every in-place text body.
 *
 * While the caret is live, presses must not bubble into the element's own
 * move-gesture (that is what would drag the box out from under the caret) —
 * and a palm landing next to the writing hand must not teleport the caret at
 * all, so it is swallowed whole instead.
 */
const textPointerDown = (e: React.PointerEvent<HTMLElement>) => {
  if (isPalmTouch(e)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (e.currentTarget.isContentEditable) e.stopPropagation();
};

interface Props {
  el: CanvasEl;
  interactive: boolean;
  /**
   * Stable gesture sink (never an inline closure): `(event, element, kind,
   * handle, context)`. Keeping the handler identity stable is what lets this
   * node be memoized — a fresh arrow per parent render would defeat the memo
   * for every element on the page.
   */
  onGesture: (
    e: React.PointerEvent,
    el: CanvasEl,
    kind: "move" | "resize" | "rotate",
    handle?: string,
    ctx?: GestureContext,
  ) => void;
  /**
   * 1-based page the element sits on, so `{رقم_الصفحة_من_الكل}` resolves per
   * page. The total comes from the store; omitting it falls back to the ambient
   * context, which is correct for single-page consumers.
   */
  pageNo?: number;
  /** Page count for macro resolution (replaces a whole-document subscription). */
  pageCount?: number;
  /** Siblings in this page/group, never the active page of another canvas. */
  siblings?: CanvasEl[];
  /** Id of the page hosting this element (gesture resolution + hit tests). */
  pageId?: string;
  /** Offset when the element renders inside an entered group (absolute mode). */
  parent?: { x: number; y: number };
}

/** Everything a gesture needs about where an element lives. */
export interface GestureContext {
  pageId: string;
  parent?: { x: number; y: number };
}

/** Types whose text can be edited in place with a double click. */
const EDITABLE = new Set(["text", "box", "stat", "stamp", "progress"]);

export const NOOP_GESTURE = () => {};
const EMPTY_SIBLINGS: CanvasEl[] = [];

type ElementNodeProps = Props & { onEnterGroup?: (id: string) => void };

function resolveMaskShape(
  el: CanvasEl,
  siblings?: CanvasEl[],
): CanvasEl | null {
  if (!el.clippedBy || !siblings?.length) return null;
  return (
    siblings.find(
      (m) => m.id === el.clippedBy && (m.type === "shape" || m.type === "svg"),
    ) ?? null
  );
}

function isMaskingSibling(el: CanvasEl, siblings?: CanvasEl[]): boolean {
  if ((el.type !== "shape" && el.type !== "svg") || !siblings?.length)
    return false;
  return siblings.some((m) => m.clippedBy === el.id);
}

function areElementNodePropsEqual(
  prev: ElementNodeProps,
  next: ElementNodeProps,
): boolean {
  if (
    prev.el !== next.el ||
    prev.interactive !== next.interactive ||
    prev.onGesture !== next.onGesture ||
    prev.onEnterGroup !== next.onEnterGroup ||
    prev.pageNo !== next.pageNo ||
    prev.pageCount !== next.pageCount ||
    prev.pageId !== next.pageId ||
    prev.parent?.x !== next.parent?.x ||
    prev.parent?.y !== next.parent?.y
  ) {
    return false;
  }
  if (prev.siblings === next.siblings) return true;
  if (
    resolveMaskShape(prev.el, prev.siblings) !==
    resolveMaskShape(next.el, next.siblings)
  ) {
    return false;
  }
  if (
    isMaskingSibling(prev.el, prev.siblings) !==
    isMaskingSibling(next.el, next.siblings)
  ) {
    return false;
  }
  return true;
}

/**
 * A document-layer node: it paints one element, in z-order, and nothing else.
 *
 * Selection chrome (outline, resize/rotate handles, the drag-capture frame)
 * lives in CanvasStage's selection overlay layer, so overlapping elements can
 * never cover the controls of a selected element beneath them.
 *
 * PERF CONTRACT — this is the most-rendered component in the app:
 *  · It subscribes to NO document state. Siblings and page count arrive as
 *    props (stable identities from the owning page), so an edit to one
 *    element never re-renders its neighbours through this component.
 *  · It is memoized; the parent must pass a stable `onGesture` callback.
 *  · While a gesture is live it renders the TRANSIENT geometry from the
 *    interaction store (page-mm), which is how a drag moves one node without
 *    writing the document per frame.
 */
export const ElementNode = memo(function ElementNode({
  el,
  interactive,
  onGesture,
  onEnterGroup,
  pageNo,
  pageCount,
  siblings,
  pageId,
  parent,
}: ElementNodeProps) {
  const updateElement = useEditor((s) => s.updateElement);
  const fitTextBox = useEditor((s) => s.fitTextBox);
  const setEditing = useEditor((s) => s.setEditing);
  const commit = useEditor((s) => s.commit);
  /**
   * Live gesture geometry for THIS element only. The selector allocates
   * nothing, so every other element's drag costs this node a comparator run,
   * never a re-render.
   */
  const transient = useInteraction((s) => s.overrides[el.id]);
  const view = transient ? { ...el, ...transient } : el;
  /**
   * قناع القص (Clipping Mask): the shape element masking this one, looked up
   * from the live page. Real clipping = `clip-path` matching the mask's own
   * geometry, computed in the MASK's box but applied to the masked element in
   * page space (clip-path supports `clipPathUnits`-style math via calc since
   * both are mm boxes on the same page). The mask shape itself stays visible.
   */
  const activeElements = siblings ?? EMPTY_SIBLINGS;
  const maskShape = resolveMaskShape(view, activeElements);
  /*
   * قناع القص (Clipping Mask) — real clipping of the picture by the mask.
   *
   * The cut follows the mask's OWN silhouette, not its bounding box: geometry
   * from shapes.ts (a 0–100 box) is placed inside the masked element's box and
   * referenced with `clip-path: url(#…)`. It is expressed in fractional
   * `objectBoundingBox` units because a `clipPath` referenced from HTML loses its
   * contents the moment they carry an SVG `transform`; the placement therefore
   * happens in the coordinates themselves (shape-affine.ts).
   */
  const instanceId = useId().replace(/:/g, "");
  const clipId = `nasaq-clip-${instanceId}`;
  const clipPath = maskShape ? `url(#${clipId})` : undefined;
  const maskDef =
    maskShape && maskShape.type === "shape"
      ? shapeDef(shapeIdOf(maskShape.style))
      : undefined;
  /** Fractions of the masked element's own box (objectBoundingBox units). */
  const clipMap = maskShape
    ? {
        sx: Math.max(1, maskShape.w) / Math.max(0.1, view.w) / 100,
        sy: Math.max(1, maskShape.h) / Math.max(0.1, view.h) / 100,
        tx: (maskShape.x - view.x) / Math.max(0.1, view.w),
        ty: (maskShape.y - view.y) / Math.max(0.1, view.h),
      }
    : null;
  const clipParts =
    maskDef && clipMap
      ? maskDef.parts.map((part) => mapShapePart(part, clipMap))
      : null;
  const clipBox = clipMap
    ? { x: clipMap.tx, y: clipMap.ty, w: clipMap.sx * 100, h: clipMap.sy * 100 }
    : null;
  const textRef = useRef<HTMLDivElement>(null);
  const editing = useRef(false);

  // Only this node may end its own editing session: a blur that arrives after
  // the author already started editing a different element must not close it.
  const endEditingState = useCallback(() => {
    if (useEditor.getState().editingId === el.id) setEditing(null);
  }, [el.id, setEditing]);

  // A remount (undo, page switch) must never leave a stale contentEditable DOM
  // node behind: the rendered `{el.content}` would be out of sync with it.
  useEffect(() => {
    if (
      editing.current &&
      textRef.current &&
      textRef.current.isContentEditable
    ) {
      editing.current = false;
      textRef.current.contentEditable = "false";
      textRef.current.classList.remove("editing");
      endEditingState();
    }
  }, [el.id, endEditingState]);

  const startEdit = (e: React.MouseEvent) => {
    if (!interactive || el.locked) return;
    // Double-clicking a group steps inside it rather than editing text, which is
    // the only way to reach members that are selectable individually.
    if (el.type === "group") {
      if (onEnterGroup) {
        e.stopPropagation();
        onEnterGroup(el.id);
      }
      return;
    }
    if (!EDITABLE.has(el.type)) return;
    e.stopPropagation();
    const node = textRef.current;
    if (!node) return;
    editing.current = true;
    setEditing(el.id);
    node.contentEditable = "true";
    node.classList.add("editing");
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const finishEdit = () => {
    const node = textRef.current;
    if (!node || !editing.current) return;
    editing.current = false;
    endEditingState();
    node.contentEditable = "false";
    node.classList.remove("editing");
    const next = node.innerText;
    const changed = next !== el.content;
    // Live update + ONE commit: writing through the non-live path here and
    // then committing would record the same text edit twice (the first Undo
    // would appear to do nothing).
    if (changed) {
      updateElement(el.id, { content: next }, true);
      fitTextBox(el.id);
      commit();
    }
  };

  const handleEditKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      finishEdit();
    }
  };

  if (el.hidden) return null;

  return (
    <div
      data-el-id={el.id}
      /* Stable hook for tests and for the contextual tooling: the DOM says
         what it is, so a check never has to guess from a class name. */
      data-el-type={el.type}
      className={cn("canvas-el", interactive && view.locked && "locked")}
      style={{
        left: `${view.x}mm`,
        top: `${view.y}mm`,
        width: `${view.w}mm`,
        height: `${view.h}mm`,
        /*
         * One transform string carries the whole orientation: rotation first,
         * then the mirrors (step 7). Order matters — mirroring after rotating
         * flips the artwork around its own centre, which is what "قلب أفقي"
         * means to an author looking at a rotated element.
         */
        transform: `rotate(${view.rotation || 0}deg)${view.style?.flipX ? " scaleX(-1)" : ""}${view.style?.flipY ? " scaleY(-1)" : ""}`,
        opacity: view.opacity ?? 1,
        mixBlendMode:
          view.style?.blendMode && view.style.blendMode !== "normal"
            ? view.style.blendMode
            : undefined,
        zIndex: view.z,
        boxShadow: view.style?.shadow || undefined,
        /*
         * When the node is not interactive (a drawing tool owns the canvas) the
         * cursor is left to CSS: the stage sets the crosshair for the tool, and
         * an inline `default` here would override it on every element.
         */
        cursor: view.locked ? "not-allowed" : interactive ? "move" : undefined,
        clipPath,
      }}
      onPointerDown={(e) => {
        if (!interactive) return;
        onGesture(
          e,
          view,
          "move",
          undefined,
          pageId ? { pageId, parent } : undefined,
        );
      }}
      onDoubleClick={startEdit}
    >
      {clipBox && (
        /*
         * The clip geometry lives inside the masked element so `url(#…)` always
         * resolves locally, and stays zero-sized so it never affects layout. Its
         * coordinates are already in the element's fractional box, so the whole
         * clip is a pure geometry statement — no transform to be lost.
         *
         * The shapes sit DIRECTLY inside the clipPath: only shape elements are
         * permitted children, and a wrapping `<g>` makes Chromium throw the whole
         * clip away (an empty region), which reads as "the picture vanished".
         */
        <svg
          className="pointer-events-none absolute left-0 top-0 h-0 w-0"
          aria-hidden
          focusable={false}
        >
          <defs>
            <clipPath id={clipId} clipPathUnits="objectBoundingBox">
              {clipParts ? (
                <ShapeParts
                  parts={clipParts}
                  fillRule={
                    maskDef && isCompoundShape(maskDef.id)
                      ? "evenodd"
                      : undefined
                  }
                />
              ) : (
                <rect
                  x={clipBox.x}
                  y={clipBox.y}
                  width={clipBox.w}
                  height={clipBox.h}
                />
              )}
            </clipPath>
          </defs>
        </svg>
      )}
      <ElementContent
        el={view}
        textRef={textRef}
        onBlur={finishEdit}
        onKeyDown={handleEditKey}
        siblings={activeElements}
        interactive={interactive}
        pageRef={
          pageNo ? { number: pageNo, count: pageCount ?? pageNo } : undefined
        }
      />
    </div>
  );
}, areElementNodePropsEqual);

function ElementContent({
  el,
  textRef,
  onBlur,
  onKeyDown,
  pageRef,
  siblings,
  interactive,
}: {
  el: CanvasEl;
  textRef: React.RefObject<HTMLDivElement | null>;
  onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  pageRef?: PageContext;
  siblings: CanvasEl[];
  interactive: boolean;
}) {
  const s = el.style || {};
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gradientId = `paint-${rawId}`;
  /** One stable local id for this element's image frame clip. */
  const frameClipId = `frame-${rawId}`;
  /*
   * A shape that clips another element paints as the clip outline, not as a
   * filled shape (the same rule every vector editor uses): an opaque fill would
   * hide the very picture it cuts. The author's own border is kept; when there
   * is none, a dashed hairline marks the mask so it stays findable on canvas.
   */
  const masking = siblings.some((m) => m.clippedBy === el.id);
  const maskOutline = masking && !(Number(s.borderWidth) > 0);
  const prepared = prepareText(el, pageRef);
  const vertical = s.writingMode === "vertical";
  const pad = textPadding(el);
  /*
   * Arabic leading is measured from the baseline, not the em box, so a single
   * `line-height` value renders unevenly across fonts that place their
   * ascenders and descenders differently. Hyphenation stays off (there is no
   * Arabic hyphenation worth trusting), and justified text keeps its closing
   * line flush to the right unless the author asks for it to stretch too.
   */
  const textStyle: React.CSSProperties = {
    fontFamily: cssFont(s.fontFamily),
    fontSize: `${prepared.fontSize}pt`,
    color: s.color || "#172033",
    fontWeight: s.fontWeight || 600,
    fontStyle: (s.fontStyle as React.CSSProperties["fontStyle"]) || "normal",
    textDecoration: s.underline ? "underline" : undefined,
    textUnderlineOffset: s.underline ? "0.15em" : undefined,
    textAlign: s.textAlign || "right",
    // The resolved leading, not the raw style: `prepareText` raises a too-tight
    // value on multi-line Arabic so the tops of tall letters are never shaved.
    lineHeight: prepared.lineHeight,
    letterSpacing: s.letterSpacing ? `${s.letterSpacing}mm` : undefined,
    textShadow: s.textShadow || "none",
    direction: s.direction === "ltr" ? "ltr" : "rtl",
    writingMode: vertical ? "vertical-rl" : undefined,
    textOrientation: vertical ? "mixed" : undefined,
    hyphens: "none",
    padding: pad ? `${pad}mm` : undefined,
    overflow:
      textBoxMode(el) === "fixed" && !s.overflowVisible ? "hidden" : "visible",
    display: s.verticalAlign && s.verticalAlign !== "top" ? "flex" : undefined,
    alignItems:
      s.verticalAlign === "middle"
        ? "center"
        : s.verticalAlign === "bottom"
          ? "flex-end"
          : undefined,
    ...(s.textAlign === "justify" && s.justifyLastLine === "stretch"
      ? { textAlignLast: "justify" as const }
      : {}),
  };

  // While a text node is being edited it is contentEditable, and re-rendering the
  // normalised string would fight the caret. `isContentEditable` distinguishes
  // that state without extra React state, so raw content is shown mid-edit and
  // the cleaned string appears once editing ends.
  const renderText = (fallback: string) =>
    textRef.current?.isContentEditable
      ? el.content || ""
      : prepared.text || fallback;

  if (el.type === "text") {
    return (
      <div
        ref={textRef}
        className="el-text"
        style={textStyle}
        onPointerDown={textPointerDown}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        {renderText("")}
      </div>
    );
  }

  if (el.type === "box" || el.type === "stat") {
    return (
      <div
        ref={textRef}
        className="el-box"
        style={{
          ...textStyle,
          background: paintCss(s.fill || s.background, s.gradient, "#f7f8fb"),
          border: `${s.borderWidth ?? 0.35}mm ${s.borderDash ? "dashed" : "solid"} ${s.borderColor || "#d9dee8"}`,
          borderRadius: `${s.radius ?? 4}mm`,
          padding: `${pad}mm`,
          display: "flex",
          alignItems: el.type === "stat" ? "center" : "flex-start",
          justifyContent:
            s.textAlign === "center"
              ? "center"
              : s.textAlign === "left"
                ? "flex-end"
                : "flex-start",
        }}
        onPointerDown={textPointerDown}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        {renderText("")}
      </div>
    );
  }

  if (el.type === "progress") {
    const value = Math.max(0, Math.min(100, Number(s.value) || 0));
    const shown = s.numerals
      ? `${applyNumerals(String(value), s.numerals)}%`
      : `${value}%`;
    // `textRef` sits on the caption alone. Putting it on the flex container would
    // make the percentage and the bar part of `innerText`, so committing an edit
    // would write "نسبة الإنجاز70%" back into the element's content.
    const caption = (
      <span
        ref={textRef}
        className="progress-caption"
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          outline: "none",
        }}
        onPointerDown={textPointerDown}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        {renderText("")}
      </span>
    );

    if (s.variant === "steps") {
      const total = Math.max(2, Math.min(12, Number(s.steps) || 5));
      // Completed stages light up left-to-right (RTL: right-to-left visually,
      // matching the reading direction the caption already follows).
      const filled = Math.round((value / 100) * total);
      const dot = Math.max(2.4, Math.min(el.h * 0.34, 7));
      return (
        <div
          className="el-box"
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "1.4mm",
            direction: "rtl",
            fontFamily: cssFont(s.fontFamily),
            fontSize: `${prepared.fontSize}pt`,
            color: s.color || "#172033",
            fontWeight: s.fontWeight || 700,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: "2mm",
            }}
          >
            {caption}
            {s.showValue !== false && (
              <span style={{ color: s.fill || "#006c35", flexShrink: 0 }}>
                {shown}
              </span>
            )}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: `${round2(dot * 0.55)}mm`,
              flexShrink: 0,
            }}
            aria-hidden
          >
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                style={{
                  width: `${round2(dot)}mm`,
                  height: `${round2(dot)}mm`,
                  borderRadius: "999px",
                  flexShrink: 0,
                  background:
                    i < filled
                      ? paintCss(s.fill, s.gradient, "#006c35")
                      : s.background || "#e8ecf3",
                }}
              />
            ))}
          </div>
        </div>
      );
    }

    if (s.variant === "ring") {
      const size = Math.max(8, Math.min(el.w, el.h));
      const thickness = Math.max(1.5, size * 0.11);
      const r = (size - thickness) / 2;
      const c = 2 * Math.PI * r;
      return (
        <div
          className="el-box"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1mm",
            direction: "rtl",
            fontFamily: cssFont(s.fontFamily),
            color: s.color || "#172033",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "relative",
              width: `${size}mm`,
              height: `${size}mm`,
              flexShrink: 0,
            }}
          >
            <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%">
              <GradientDefs
                gradient={s.gradient}
                id={gradientId}
                box={{ w: size, h: size }}
                coordinates={{ w: size, h: size }}
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.background || "#e8ecf3"}
                strokeWidth={thickness}
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={
                  s.gradient ? `url(#${gradientId})` : s.fill || "#006c35"
                }
                strokeWidth={thickness}
                strokeLinecap="round"
                strokeDasharray={`${(c * value) / 100} ${c}`}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            </svg>
            {s.showValue !== false && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  fontSize: `${prepared.fontSize}pt`,
                  fontWeight: s.fontWeight || 700,
                }}
              >
                {shown}
              </div>
            )}
          </div>
          {caption}
        </div>
      );
    }

    const barHeight = Math.max(2, el.h * 0.3);
    return (
      <div
        className="el-box"
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: "1.4mm",
          direction: "rtl",
          fontFamily: cssFont(s.fontFamily),
          fontSize: `${prepared.fontSize}pt`,
          color: s.color || "#172033",
          fontWeight: s.fontWeight || 700,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "2mm",
          }}
        >
          {caption}
          {s.showValue !== false && (
            <span style={{ color: s.fill || "#006c35", flexShrink: 0 }}>
              {shown}
            </span>
          )}
        </div>
        <div
          style={{
            height: `${barHeight}mm`,
            background: s.background || "#e8ecf3",
            borderRadius: `${s.radius ?? 3}mm`,
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: `${value}%`,
              height: "100%",
              background: paintCss(s.fill, s.gradient, "#006c35"),
            }}
          />
        </div>
      </div>
    );
  }

  if (el.type === "group") {
    return (
      <div className="relative h-full w-full">
        {(el.children || EMPTY_SIBLINGS)
          .slice()
          .sort((a, b) => a.z - b.z)
          .map((child) => (
            <ElementNode
              key={child.id}
              el={child}
              interactive={false}
              pageNo={pageRef?.number}
              pageCount={pageRef?.count}
              siblings={el.children || EMPTY_SIBLINGS}
              onGesture={NOOP_GESTURE}
            />
          ))}
      </div>
    );
  }

  if (el.type === "shape") {
    return (
      <ShapeGlyph
        style={s}
        fill={masking ? "none" : s.fill || "#006c35"}
        stroke={
          maskOutline
            ? interactive
              ? "var(--color-gold)"
              : "transparent"
            : s.borderColor || "transparent"
        }
        borderWidthMm={maskOutline ? 0.25 : Number(s.borderWidth) || 0}
        strokeDasharray={maskOutline ? "2 2" : undefined}
        dash={!maskOutline && s.borderDash === true}
        radiusMm={s.radius}
        box={{ w: el.w, h: el.h }}
      />
    );
  }

  if (el.type === "line") {
    const vertical = el.h > el.w;
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div
          style={{
            background: s.color || "#c9a86a",
            width: vertical ? `${s.stroke ?? 0.8}mm` : "100%",
            height: vertical ? "100%" : `${s.stroke ?? 0.8}mm`,
          }}
        />
      </div>
    );
  }

  if (el.type === "divider") {
    const c = s.color || "#c9a86a";
    return (
      <div className="flex h-full w-full items-center gap-1.5 px-1">
        <span
          className="h-px flex-1"
          style={{ background: c, height: `${s.stroke ?? 0.5}mm` }}
        />
        <span
          className="shrink-0"
          style={{
            width: "3.6mm",
            height: "3.6mm",
            border: `${s.stroke ?? 0.5}mm solid ${c}`,
            transform: "rotate(45deg)",
          }}
        />
        <span
          className="h-px flex-1"
          style={{ background: c, height: `${s.stroke ?? 0.5}mm` }}
        />
      </div>
    );
  }

  if (el.type === "image" || el.type === "logo" || el.type === "qr") {
    const src = safeImageSrc(el.src);
    /*
     * إطار الصورة — the frame is a property of THIS picture, so its silhouette
     * is cut in fractional box units and follows the element through resize,
     * rotation, cropping and every export path. It composes with a clipping
     * mask (which clips the outer node): the two cuts intersect, exactly as two
     * nested clips should.
     */
    const frame = frameOfStyle(s);
    const frameParts = frame ? frameClipParts(frame.id) : null;
    const artwork = (
      <>
        <ImageArtwork el={el} src={src} framed={Boolean(frameParts)} />
        {s.gradient && (
          <div
            aria-hidden
            data-gradient-overlay={el.id}
            className="pointer-events-none absolute inset-0"
            style={{
              background: gradientCss(s.gradient),
              mixBlendMode: s.gradientBlendMode || "normal",
              borderRadius: frameParts ? undefined : `${s.radius || 0}mm`,
            }}
          />
        )}
        {/*
         * Step 8 — طبقة التلاشي. Painted after the image so it always sits on
         * top, sized to the frame (not the photo), and inert: it is decoration,
         * so a click must reach the image underneath and dragging the element
         * must keep working.
         */}
        {normalizeFade(s.fade) && (
          <div
            aria-hidden
            data-fade-overlay={el.id}
            className="fade-overlay"
            style={{
              ...fadeStyle(normalizeFade(s.fade)!),
              borderRadius: frameParts ? undefined : `${s.radius || 0}mm`,
            }}
          />
        )}
        {frameParts && Number(s.borderWidth) > 0 && (
          /* The author's outline follows the frame silhouette, not the box. */
          <svg
            aria-hidden
            focusable={false}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <g
              fill="none"
              stroke={s.borderColor || "#ffffff"}
              strokeWidth={strokeToUnits(Number(s.borderWidth), { w: el.w, h: el.h })}
              strokeDasharray={
                s.borderDash
                  ? dashArrayForUnits(
                      strokeToUnits(Number(s.borderWidth), { w: el.w, h: el.h }),
                    )
                  : undefined
              }
              strokeLinejoin="round"
            >
              <ShapeParts
                parts={shapeDef(frame!.shapeId).parts}
                fillRule={frameFillRule(frame!.id)}
              />
            </g>
          </svg>
        )}
      </>
    );
    /*
     * An empty picture slot.
     *
     * The element keeps its box, its frame and its place in the document — what
     * it does NOT do is print a sentence about itself. «لا توجد صورة» used to
     * appear for a moment on every load, because the artwork is resolved after
     * the page is laid out; the author saw a development-era message flash
     * across their document. An empty slot now looks like an empty slot (a
     * quiet plate with the universal "no picture" pictogram), and the picker
     * that fills it lives where it always did — in the properties panel.
     */
    if (!src) {
      const plate = (
        <div className="grid h-full w-full place-items-center bg-surface-2" aria-hidden>
          <span className="el-image-empty" />
        </div>
      );
      return frameParts ? (
        <FrameClip id={frameClipId} parts={frameParts} fillRule={frameFillRule(frame!.id)}>
          {plate}
        </FrameClip>
      ) : (
        plate
      );
    }
    if (!frameParts) return artwork;
    return (
      <FrameClip id={frameClipId} parts={frameParts} fillRule={frameFillRule(frame!.id)}>
        {artwork}
      </FrameClip>
    );
  }

  if (el.type === "svg") {
    // Vector path: sanitised markup renders inline, so it stays crisp at any
    // zoom. Panel fill/stroke overrides are applied onto the markup itself
    // (independent channels — see applySvgColors); `currentColor` in the
    // markup keeps following the panel's color property.
    const clean = applySvgColors(sanitizeSvgContent(el.content), {
      fill: s.svgFill,
      stroke: s.svgStroke,
      strokeWidth: s.svgStrokeWidth,
      gradient: s.gradient,
      gradientId,
      box: { w: el.w, h: el.h },
    });
    if (!clean) {
      return (
        <div className="grid h-full w-full place-items-center bg-[#f4f6fa] text-[9pt] font-bold text-muted">
          ألصق كود SVG من الخصائص
        </div>
      );
    }
    return (
      <div
        className="canvas-svg-content h-full w-full"
        style={{
          color: s.color || "#172033",
          opacity: el.opacity ?? 1,
          overflow: s.overflowVisible ? "visible" : "hidden",
          pointerEvents: "none",
        }}
        // Sanitised above (allow-list walk) — no script/handler/external ref
        // survives, so this is safe to inline.
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    );
  }

  if (el.type === "icon") {
    const d = ICONS[el.icon || "star"] || ICONS.star;
    return (
      <div
        className="grid h-full w-full place-items-center"
        style={{ color: s.color || "#c9a86a" }}
      >
        <svg
          viewBox="0 0 24 24"
          fill={s.fill || "none"}
          stroke={s.svgStroke || s.borderColor || "currentColor"}
          strokeWidth={s.stroke ?? 1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-full w-full"
        >
          <path d={d} />
        </svg>
      </div>
    );
  }

  if (el.type === "stamp") {
    return (
      <div
        ref={textRef}
        className="grid h-full w-full place-items-center text-center"
        style={{
          borderRadius: "999px",
          border: `0.7mm double ${s.borderColor || s.color || "#c9a86a"}`,
          color: s.color || "#c9a86a",
          fontFamily: cssFont(s.fontFamily || "Amiri"),
          fontWeight: 700,
          fontSize: `${prepared.fontSize}pt`,
          transform: "rotate(-12deg)",
          lineHeight: 1.2,
          whiteSpace: "pre-wrap",
          overflow: "hidden",
        }}
        onPointerDown={textPointerDown}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        {renderText("معتمد")}
      </div>
    );
  }

  if (el.type === "table") {
    const cols = s.cols || 3;
    const rows = s.rows || 4;
    const data = parseTable(el.content, cols, rows);
    const stripe = s.stripeBg;
    return (
      <table
        className="h-full w-full border-collapse"
        style={{
          tableLayout: "fixed",
          fontFamily: cssFont(s.fontFamily),
          fontSize: `${s.fontSize || 11}pt`,
          direction: "rtl",
        }}
      >
        <tbody>
          {data.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => {
                const Tag = ri === 0 ? "th" : "td";
                const zebra =
                  stripe && ri > 0 && ri % 2 === 0 ? stripe : undefined;
                return (
                  <Tag
                    key={ci}
                    style={{
                      border: `${s.borderWidth ?? 0.3}mm solid ${s.borderColor || "#bfc7d6"}`,
                      padding: "1.6mm",
                      background:
                        ri === 0
                          ? s.headerBg || "#006c35"
                          : zebra || s.tableBg || "#fff",
                      color:
                        ri === 0
                          ? s.headerColor || "#fff"
                          : s.color || "#172033",
                      fontWeight: ri === 0 ? 800 : 500,
                      textAlign: s.cellAlign || "right",
                      verticalAlign: "top",
                      overflow: "hidden",
                    }}
                  >
                    {applyNumerals(cell, s.numerals)}
                  </Tag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return null;
}
/**
 * Cut a picture to a frame silhouette.
 *
 * The geometry lives in a zero-sized inline `<svg>` next to the artwork so
 * `url(#…)` always resolves locally, and it is expressed in fractional
 * `objectBoundingBox` units — the same contract the clipping mask uses, because
 * a `clipPath` referenced from HTML drops its contents the moment they carry an
 * SVG transform (`shape-affine.ts`).
 */
function FrameClip({
  id,
  parts,
  fillRule,
  children,
}: {
  id: string;
  parts: ShapePart[];
  fillRule?: "evenodd";
  children: React.ReactNode;
}) {
  return (
    <div
      className="image-frame-clip relative h-full w-full"
      style={{ clipPath: `url(#${id})` }}
    >
      <svg
        className="pointer-events-none absolute left-0 top-0 h-0 w-0"
        aria-hidden
        focusable={false}
      >
        <defs>
          <clipPath id={id} clipPathUnits="objectBoundingBox">
            <ShapeParts parts={parts} fillRule={fillRule} />
          </clipPath>
        </defs>
      </svg>
      {children}
    </div>
  );
}

/** A source crop never stretches pixels: Fit/Fill change the viewport, not the source. */
function ImageArtwork({
  el,
  src,
  framed,
}: {
  el: CanvasEl;
  src: string;
  /** A frame owns the silhouette, so the box radius must not fight it. */
  framed?: boolean;
}) {
  const s = el.style;
  /*
   * The geometry is the element's own box, so the load state only controls what
   * is painted inside it: a quiet plate first, the picture when it is decoded.
   * Nothing here can move the document.
   */
  const loadState = useImageLoadState(src);
  const pending = loadState !== "ready";
  const plate = pending ? (
    <span aria-hidden className="el-image-plate" data-state={loadState} />
  ) : null;
  const artClass = cn(
    "el-image-art",
    loadState === "ready" ? "opacity-100" : "opacity-0",
  );
  const filterId = useId().replace(/:/g, "");
  const sharp = Math.max(0, Math.min(100, Number(s.sharpness) || 0));
  const filter = imageAdjustCss(s, sharp > 0 ? filterId : undefined);
  const crop = normalizeCrop(s.crop);
  const radius = framed ? "0mm" : `${s.radius || 0}mm`;
  const stroke =
    Number(s.borderWidth) > 0
      ? `${s.borderWidth}mm ${s.borderDash ? "dashed" : "solid"} ${s.borderColor || "transparent"}`
      : undefined;
  if (!crop)
    return (
      <>
        {sharp > 0 && (
          <svg width="0" height="0" aria-hidden className="absolute">
            <filter id={filterId}>
              <feConvolveMatrix
                order="3"
                kernelMatrix={sharpnessKernel(sharp)}
                preserveAlpha="true"
              />
            </filter>
          </svg>
        )}
        {plate}
        <img
          alt=""
          src={src}
          draggable={false}
          className={artClass}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            objectFit:
              s.objectFit ||
              (el.type === "logo" || el.type === "qr" ? "contain" : "cover"),
            objectPosition: `${s.objectX ?? 50}% ${s.objectY ?? 50}%`,
            borderRadius: radius,
            outline: stroke,
            outlineOffset: stroke ? `-${s.borderWidth}mm` : undefined,
            filter,
            pointerEvents: "none",
          }}
        />
      </>
    );
  const layout = imageLayout(
    el,
    { w: crop.sourceW, h: crop.sourceH },
    crop,
    s.objectFit || (el.type === "logo" ? "contain" : "cover"),
    s.objectX,
    s.objectY,
  );
  return (
    <div
      className="image-crop-content"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        borderRadius: radius,
        outline: stroke,
        outlineOffset: stroke ? `-${s.borderWidth}mm` : undefined,
        filter,
        pointerEvents: "none",
      }}
    >
      {plate}
      {sharp > 0 && (
        <svg width="0" height="0" aria-hidden className="absolute">
          <filter id={filterId}>
            <feConvolveMatrix
              order="3"
              kernelMatrix={sharpnessKernel(sharp)}
              preserveAlpha="true"
            />
          </filter>
        </svg>
      )}
      <div
        style={{
          position: "absolute",
          left: `${layout.x}mm`,
          top: `${layout.y}mm`,
          width: `${layout.w}mm`,
          height: `${layout.h}mm`,
          overflow: "hidden",
        }}
      >
        <img
          alt=""
          src={src}
          draggable={false}
          className={artClass}
          style={{
            position: "absolute",
            display: "block",
            maxWidth: "none",
            width: `${crop.sourceW * layout.scaleX}mm`,
            height: `${crop.sourceH * layout.scaleY}mm`,
            left: `${-crop.x * layout.scaleX}mm`,
            top: `${-crop.y * layout.scaleY}mm`,
          }}
        />
      </div>
    </div>
  );
}
