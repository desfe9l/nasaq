import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowLeftRight,
  ArrowUpDown,
  Bold,
  Copy,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Italic,
  Lock,
  Maximize2,
  MoreHorizontal,
  Move,
  Paintbrush,
  Palette,
  RotateCcw,
  RotateCw,
  Scaling,
  Trash2,
  Underline,
  Unlock,
  X,
  type LucideIcon,
} from "lucide-react";
import { TYPE_NAME, type CanvasEl } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { useInteraction } from "@/lib/editor/interaction-store";
import { strokeBinding } from "@/lib/editor/stroke";
import { bubbleLayout, placeFloatingToolbar } from "@/lib/editor/ui-state";
import { cn } from "@/lib/utils";
import { StrokeControls, StrokeField } from "./StrokeControls";
import { ScrubInput } from "./ui/ScrubInput";
import { ColorField } from "./ui/ColorField";
import { Tip } from "./ui/Tip";
import {
  AnchorMenu,
  MenuCell,
  MenuGrid,
  MenuGroup,
  MenuRow,
} from "./ui/AnchorMenu";
import { AlignIcon } from "./ui/AlignIcon";
import type { AlignEdge } from "@/lib/editor/model";

/** Elements that render an editable text body. */
const TEXT_TYPES = new Set(["text", "box", "stat", "stamp", "progress"]);

/** Gap between the selection interaction bounds and the toolbar. */
const GAP = 16;
/** Minimum distance from the viewport edges. */
const MARGIN = 8;
/** Widest lane the bubble is ever asked to fill (`ui-state` folds beyond it). */
const MAX_LANE = 760;

/**
 * The contextual selection toolbar.
 *
 * It appears only while something is selected, and it shows only what that
 * selection can use. The bar itself is ONE row of fixed 32px cells whose
 * contents are chosen by `bubbleLayout()` from the free lane beside the
 * artwork — so its rectangle is a function of the viewport and the selection
 * KIND, never of a font name, a tooltip or the drawer that happens to be open.
 * Everything that does not fit leaves the bar for one of two drawers:
 *
 *   • the group drawer (the palette icon) — the complete set of formatting
 *     controls for this kind of element, live and movable;
 *   • «المزيد» — arrange, transform, opacity, the style clipboard and equal
 *     sizing, which no selection needs in the first second.
 *
 * Nothing is dropped: every control that used to sit in the bar is still one
 * press away, and both drawers can be moved, closed and reopened.
 *
 * Anchor maths are done in SCREEN space (a `getBoundingClientRect` of the live
 * element), never from the element's mm geometry — that is what keeps the
 * toolbar glued to the artwork through zoom, scroll and rotation, and it makes
 * the whole computation RTL-agnostic: physical pixels have no direction. The
 * only RTL-sensitive part is the toolbar's own content, which stays `dir="rtl"`
 * so Arabic labels read correctly.
 *
 * The same option sets the properties panel uses are reused here
 * (`fontChoices`, `updateStyle`, `updateElement`), so there is no second
 * formatting model.
 */
export function FloatingToolbar({ el }: { el: CanvasEl }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  /**
   * The free lane beside the artwork, measured in screen pixels. It — and only
   * it — decides which controls stay in the bar, so the bar's size can change
   * with the viewport but never with the document or an open drawer.
   */
  const [lane, setLane] = useState(MAX_LANE);
  /**
   * A floating panel is a surface the author placed deliberately; on a phone
   * there is not enough room for the bubble AND the panel. While the pointer is
   * inside a panel the bubble steps aside and returns the moment the author
   * moves back to the canvas, so a panel's own controls are never behind a
   * floating strip.
   */
  const [yielding, setYielding] = useState(false);
  /** Which side the bubble settled on — drives its entrance animation. */
  const [side, setSide] = useState<"above" | "below" | "left" | "right">(
    "above",
  );

  const fontChoices = useEditor((s) => s.fontChoices);
  const zoom = useEditor((s) => s.zoom);
  /*
   * Follow the element while it is being dragged/rotated WITHOUT subscribing
   * to the document: the transient interaction store bumps `version` for this
   * element only. (The old `pages` subscription re-rendered the bubble on
   * every document write, and a drag wrote per frame.)
   */
  const dragVersion = useInteraction(
    (s) => (s.overrides[el.id] ? s.version : 0),
  );
  const updateStyle = useEditor((s) => s.updateStyle);
  const updateElement = useEditor((s) => s.updateElement);
  const commit = useEditor((s) => s.commit);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const copyStyle = useEditor((s) => s.copyStyle);
  const pasteStyle = useEditor((s) => s.pasteStyle);
  const styleClipboard = useEditor((s) => s.styleClipboard);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const toggleBubble = useEditor((s) => s.toggleBubble);
  const bubbleOffset = useEditor((s) => s.bubbleOffset);
  const setBubbleOffset = useEditor((s) => s.setBubbleOffset);
  const [dragging, setDragging] = useState(false);
  const flipSelected = useEditor((s) => s.flipSelected);
  const toggleResizeLock = useEditor((s) => s.toggleResizeLock);
  const toggleLock = useEditor((s) => s.toggleLock);
  const toggleHidden = useEditor((s) => s.toggleHidden);
  const align = useEditor((s) => s.align);
  const distribute = useEditor((s) => s.distribute);
  const matchSize = useEditor((s) => s.matchSize);
  const fitTextBox = useEditor((s) => s.fitTextBox);
  const selectedIds = useEditor((s) => s.selectedIds);

  /**
   * Place the toolbar 16px beyond the grips, flipping below when there is no
   * room, and clamp horizontally so it can never leave the viewport.
   */
  const place = useCallback(() => {
    const target = document.querySelector<HTMLElement>(
      `.editor-canvas-stage [data-page-id] [data-el-id="${CSS.escape(el.id)}"]`,
    );
    const toolbar = boxRef.current;
    if (!target || !toolbar) return;
    const rect = target.getBoundingClientRect();
    // A narrow tool rail must not force a phone toolbar down to the page rail.
    // Fit the bar into the lane beside the tools before placing it.
    let laneLeft = MARGIN, laneRight = window.innerWidth - MARGIN;
    document.querySelectorAll<HTMLElement>('[data-editor-obstacle="tool-dock"]').forEach(dock => {
      const r = dock.getBoundingClientRect();
      if (!r.width || r.height < r.width || getComputedStyle(dock).visibility === "hidden") return;
      if (r.left > rect.left + rect.width / 2) laneRight = Math.min(laneRight, r.left - MARGIN);
      else if (r.right < rect.left + rect.width / 2) laneLeft = Math.max(laneLeft, r.right + MARGIN);
    });
    const nextLane = Math.min(
      MAX_LANE,
      window.innerWidth - MARGIN * 2,
      Math.max(240, laneRight - laneLeft),
    );
    /*
     * Publish the lane instead of measuring the bar: `bubbleLayout` turns this
     * one number into the bar's contents, so a re-render (not a resize of the
     * bar) is what answers a smaller viewport. Measuring the bar here and
     * resizing it there would be a loop.
     */
    setLane((current) => (current === nextLane ? current : nextLane));
    const size = toolbar.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    // Keep the bubble clear of the real, outward-expanded grip hit regions,
    // not just the visible 7px dots. These measurements include rotation/zoom.
    const grips = [...document.querySelectorAll<HTMLElement>(
      `.selection-frame[data-el-id="${CSS.escape(el.id)}"] .handle, .selection-frame[data-el-id="${CSS.escape(el.id)}"] .rotate-handle`,
    )].map(node => node.getBoundingClientRect());
    /*
     * The selection frame can be the MEASURED artwork box, so it is part of
     * the anchor: the bubble must clear what the author sees as "the
     * selection", not just the element's layout box.
     */
    const frameNode = document.querySelector<HTMLElement>(
      `.selection-frame[data-el-id="${CSS.escape(el.id)}"]`,
    );
    if (frameNode) grips.push(frameNode.getBoundingClientRect());
    const leftEdge = Math.min(rect.left, ...grips.map(r => r.left));
    const rightEdge = Math.max(rect.right, ...grips.map(r => r.right));
    const topEdge = Math.min(rect.top, ...grips.map(r => r.top));
    const bottomEdge = Math.max(rect.bottom, ...grips.map(r => r.bottom));
    const interactionBox = { left: leftEdge, right: rightEdge, top: topEdge,
      bottom: bottomEdge, width: rightEdge - leftEdge, height: bottomEdge - topEdge };
    /*
     * Obstacles: the header, both sidebars, the pages rail and the status bar
     * all mark themselves `data-editor-obstacle`. Measuring them at placement
     * time (rather than assuming fixed widths) means the bubble dodges a
     * resized panel, a collapsed sidebar or a floating drawer exactly as it
     * dodges the docked layout.
     */
    const avoid = [
      ...document.querySelectorAll<HTMLElement>("[data-editor-obstacle]"),
    ]
      .filter((node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden")
      .map((node) => node.getBoundingClientRect());
    // The arithmetic is pure and unit-tested (`placeFloatingToolbar`); this
    // callback only feeds it live screen measurements.
    const { left, top, placement } = placeFloatingToolbar(
      interactionBox,
      { width: size.width, height: size.height },
      { width: window.innerWidth, height: window.innerHeight },
      GAP,
      MARGIN,
      [...avoid, ...grips],
    );
    /*
     * A manual park wins over the automatic placement, still clamped into the
     * viewport so a resized window can never strand the bubble off screen.
     */
    const offset = useEditor.getState().bubbleOffset;
    const parked = offset
      ? {
          left: Math.min(
            Math.max(left + offset.dx, MARGIN),
            Math.max(MARGIN, window.innerWidth - size.width - MARGIN),
          ),
          top: Math.min(
            Math.max(top + offset.dy, MARGIN),
            Math.max(MARGIN, window.innerHeight - size.height - MARGIN),
          ),
        }
      : { left, top };
    setPos(parked);
    setSide(placement);
  }, [el.id]);

  // Re-place on every input that can move the element on screen: its own
  // geometry, the zoom, a page re-render, a scroll inside the stage, a resize.
  // `lane` is in the list because a new lane means a new bar, and the bar has
  // to be measured AFTER it re-rendered, not before.
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    schedule();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.addEventListener("transitionend", schedule, true);
    const observer = new ResizeObserver(schedule);
    document.querySelectorAll("[data-editor-obstacle]").forEach(node => observer.observe(node));
    window.addEventListener("nasaq:panel-layout", schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener("nasaq:panel-layout", schedule);
      window.removeEventListener("transitionend", schedule, true);
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [place, lane, el.x, el.y, el.w, el.h, el.rotation, zoom, dragVersion, bubbleOffset]);

  useEffect(() => {
    const inside = (event: Event) => {
      const target = event.target;
      setYielding(
        target instanceof Element && !!target.closest(".editor-floating-panel"),
      );
    };
    // Capture phase on move and press: both fire before the panel acts on the
    // gesture, so the bubble is already gone when the hit test resolves.
    const onMove = (event: Event) => {
      if (event instanceof PointerEvent && event.pointerType === "mouse") inside(event);
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerdown", inside, true);
    const onLeave = () => setYielding(false);
    window.addEventListener("blur", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerdown", inside, true);
      window.removeEventListener("blur", onLeave);
    };
  }, []);

  /**
   * Drag the bubble by its grip and remember where it lands.
   *
   * Deltas are accumulated against the bubble's live rect (never the model),
   * and each move writes the offset through the store so the placement effect
   * keeps honouring the park without fighting the pointer.
   */
  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const toolbar = boxRef.current;
    if (!toolbar) return;
    const origin = toolbar.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const base = useEditor.getState().bubbleOffset ?? { dx: 0, dy: 0 };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const next = { dx: base.dx + dx, dy: base.dy + dy };
      /* Clamp the travel so the parked bubble can never leave the viewport. */
      next.dx = Math.min(
        Math.max(next.dx, base.dx + MARGIN - origin.left),
        Math.max(base.dx + window.innerWidth - origin.width - MARGIN - origin.left, base.dx + MARGIN - origin.left),
      );
      next.dy = Math.min(
        Math.max(next.dy, base.dy + MARGIN - origin.top),
        Math.max(base.dy + window.innerHeight - origin.height - MARGIN - origin.top, base.dy + MARGIN - origin.top),
      );
      useEditor.getState().setBubbleOffset(next);
    };
    const end = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const style = el.style || {};
  const isText = TEXT_TYPES.has(el.type);
  const count = selectedIds.length;
  /*
   * Border support is a property of the element's TYPE (and, for an imported
   * SVG, of its viewBox), so it is read here without subscribing to the
   * document: a selection that cannot carry a border simply has no border
   * control, in the bar or in a drawer, instead of an empty 76px slot.
   */
  const supportsStroke = useMemo(() => {
    if (strokeBinding(el) !== null) return true;
    // A mixed selection can hold a shape even when the primary element is a
    // plain text frame. `selectedIds` is subscribed above, so this re-runs with
    // every selection — and only a multi-selection needs the extra walk.
    if (selectedIds.length < 2) return false;
    return useEditor
      .getState()
      .selectedElements()
      .some((item) => strokeBinding(item) !== null);
  }, [el, selectedIds]);
  const layout = bubbleLayout(isText ? "text" : "object", lane, {
    stroke: supportsStroke,
  });
  const inBar = new Set(layout.bar);
  const inDrawer = new Set(layout.drawer);

  const paragraphAlign: Array<{ id: string; label: string; icon: LucideIcon }> = [
    { id: "right", label: "محاذاة لليمين", icon: AlignRight },
    { id: "center", label: "توسيط", icon: AlignCenter },
    { id: "left", label: "محاذاة لليسار", icon: AlignLeft },
    { id: "justify", label: "ضبط", icon: AlignJustify },
  ];
  const AlignCurrent =
    paragraphAlign.find((item) => item.id === (style.textAlign || "right"))
      ?.icon ?? AlignRight;
  /** Align/distribute the selection (or the page when a single object is picked). */
  const alignEdge = (edge: string) =>
    align(edge as AlignEdge, count >= 2 ? "selection" : "page");
  const setParagraphAlign = (id: string) => {
    updateStyle(el.id, {
      textAlign: id as "right" | "center" | "left" | "justify",
    });
    commit();
  };
  const rotate = (delta: number) => {
    const state = useEditor.getState();
    for (const item of state.selectedElements()) {
      if (item.locked) continue;
      const next = ((((item.rotation || 0) + delta) % 360) + 360) % 360;
      state.updateElement(item.id, { rotation: next }, true);
    }
    commit();
  };
  /** The two colour bindings of an object, shared by the bar and the drawer. */
  const objectColors = {
    fill: {
      value: el.type === "svg" ? style.svgFill : style.fill,
      fallback: style.background || "#006c35",
      onChange: (v: string) =>
        updateStyle(el.id, el.type === "svg" ? { svgFill: v } : { fill: v }, true),
      onCommit: (v: string) =>
        updateStyle(el.id, el.type === "svg" ? { svgFill: v } : { fill: v }),
    },
    border: {
      value:
        el.type === "line" || el.type === "divider"
          ? style.color
          : el.type === "svg" || el.type === "icon"
            ? style.svgStroke
            : style.borderColor,
      fallback: style.color || "#c9a86a",
      onChange: (v: string) =>
        updateStyle(
          el.id,
          el.type === "line" || el.type === "divider"
            ? { color: v }
            : el.type === "svg" || el.type === "icon"
              ? { svgStroke: v }
              : { borderColor: v },
          true,
        ),
      onCommit: (v: string) =>
        updateStyle(
          el.id,
          el.type === "line" || el.type === "divider"
            ? { color: v }
            : el.type === "svg" || el.type === "icon"
              ? { svgStroke: v }
              : { borderColor: v },
        ),
    },
  };

  /** Typography, in the bar or in the drawer — the same controls either way. */
  const typographyControls = (
    <>
      <div className="editor-menu-field">
        <select
          className="editor-drawer-select"
          aria-label="نوع الخط"
          title={`نوع الخط — ${style.fontFamily || "Tajawal"}`}
          value={style.fontFamily || "Tajawal"}
          onChange={(event) => {
            updateStyle(el.id, { fontFamily: event.target.value });
            commit();
          }}
        >
          {fontChoices.map((font) => (
            <option key={font.family} value={font.family}>
              {font.family}
            </option>
          ))}
        </select>
      </div>
      <div className="editor-menu-field">
        <ScrubInput
          label="حجم الخط"
          value={Math.round(Number(style.fontSize || 12) * 10) / 10}
          min={5}
          max={200}
          step={0.5}
          precision={1}
          suffix="pt"
          onChange={(v) => updateStyle(el.id, { fontSize: v }, true)}
          onCommit={(v) => {
            updateStyle(el.id, { fontSize: v });
            commit();
          }}
        />
      </div>
    </>
  );

  /*
   * Portalled to `document.body` on purpose: the bubble is `position: fixed`
   * and must sit above the panel layer (`--z-bubble` > `--z-panel`), while the
   * canvas stage itself is deliberately isolated so artboard layers can never
   * escape it. Rendering here keeps both invariants true.
   */
  return createPortal(
    <div
      ref={boxRef}
      className={cn("floating-toolbar", dragging && "is-dragging")}
      data-floating-toolbar={el.id}
      data-placement={side}
      data-density={layout.drawer.length || layout.more.length ? "folded" : "full"}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos && !yielding ? "visible" : "hidden",
      }}
      // The toolbar is chrome over the document: pointer events must never
      // reach the canvas beneath it. Right-click is stopped here too — the
      // stopPropagation means the workspace handler never runs, so without
      // preventDefault the browser's own menu would appear over the canvas.
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      dir="rtl"
      role="toolbar"
      aria-label={`أدوات ${el.name || TYPE_NAME[el.type]}`}
    >
      {/*
       * Drag grip — the bubble can be parked anywhere on screen, and
       * double-clicking the grip hands placement back to the automatic
       * scoring (above → below → sides, never over the artwork).
       */}
      <button
        type="button"
        className="floating-toolbar-btn floating-toolbar-grip"
        title="اسحب لنقل الشريط — نقرتان لإعادته إلى الموضع التلقائي"
        aria-label="نقل الشريط العائم"
        onPointerDown={startDrag}
        onDoubleClick={() => setBubbleOffset(null)}
      >
        <Move />
      </button>

      {/*
       * The group drawer: the whole formatting set for this kind of element,
       * opened only when the lane is too narrow to hold it in the bar. It is a
       * real drawer — titled, movable, closable — not a second toolbar.
       */}
      {inBar.has("drawer") && (
        <AnchorMenu
          label={isText ? "تنسيق النص" : "تنسيق العنصر"}
          drawer={{
            id: "selection-format",
            title: isText ? "تنسيق النص" : "تنسيق العنصر",
          }}
          width={248}
          side="top"
          align="start"
          trigger={({ ref, ...props }) => (
            <button
              {...props}
              ref={ref}
              type="button"
              className="floating-toolbar-btn"
              aria-label={isText ? "تنسيق النص" : "تنسيق العنصر"}
            >
              <Palette />
            </button>
          )}
        >
          {inDrawer.has("typography") && typographyControls}
          {inDrawer.has("format") && (
            <>
              <MenuGrid columns={4} label="تنسيق الأحرف">
                <MenuCell
                  icon={<Bold />}
                  label="عريض"
                  active={Number(style.fontWeight || 0) >= 700}
                  onSelect={() => {
                    updateStyle(el.id, {
                      fontWeight: Number(style.fontWeight) >= 700 ? 500 : 800,
                    });
                    commit();
                  }}
                />
                <MenuCell
                  icon={<Italic />}
                  label="مائل"
                  active={style.fontStyle === "italic"}
                  onSelect={() => {
                    updateStyle(el.id, {
                      fontStyle: style.fontStyle === "italic" ? "normal" : "italic",
                    });
                    commit();
                  }}
                />
                <MenuCell
                  icon={<Underline />}
                  label="تحته خط"
                  active={style.underline === true}
                  onSelect={() => {
                    updateStyle(el.id, { underline: style.underline !== true });
                    commit();
                  }}
                />
                <ColorField
                  className="editor-menu-swatch"
                  label="لون النص"
                  value={style.color}
                  fallback="#172033"
                  onChange={(v) => updateStyle(el.id, { color: v }, true)}
                  onCommit={(v) => updateStyle(el.id, { color: v })}
                />
              </MenuGrid>
              <MenuGrid columns={4} label="محاذاة الفقرة">
                {paragraphAlign.map((item) => {
                  const Icon = item.icon;
                  return (
                    <MenuCell
                      key={item.id}
                      icon={<Icon />}
                      label={item.label}
                      active={(style.textAlign || "right") === item.id}
                      onSelect={() => setParagraphAlign(item.id)}
                    />
                  );
                })}
              </MenuGrid>
            </>
          )}
          {inDrawer.has("ink") && (
            <MenuGrid columns={2} label="ألوان العنصر">
              <ColorField
                className="editor-menu-swatch"
                label="لون التعبئة"
                value={objectColors.fill.value}
                fallback={objectColors.fill.fallback}
                allowNone
                onChange={objectColors.fill.onChange}
                onCommit={objectColors.fill.onCommit}
              />
              <ColorField
                className="editor-menu-swatch"
                label="لون الإطار"
                value={objectColors.border.value}
                fallback={objectColors.border.fallback}
                onChange={objectColors.border.onChange}
                onCommit={objectColors.border.onCommit}
              />
            </MenuGrid>
          )}
          {inDrawer.has("stroke") && (
            <div className="editor-menu-field">
              <StrokeField />
            </div>
          )}
        </AnchorMenu>
      )}

      {inBar.has("typography") && (
        <div className="floating-toolbar-section">
          <select
            className="floating-toolbar-select"
            aria-label="نوع الخط"
            title={`نوع الخط — ${style.fontFamily || "Tajawal"}`}
            value={style.fontFamily || "Tajawal"}
            onChange={(event) => {
              updateStyle(el.id, { fontFamily: event.target.value });
              commit();
            }}
          >
            {fontChoices.map((font) => (
              <option key={font.family} value={font.family}>
                {font.family}
              </option>
            ))}
          </select>
          {/*
           * Font size uses the shared scrubber: drag the value horizontally,
           * Shift for ×10, and ± steppers that stay thumb-sized on touch — the
           * same gesture as the properties panel, so the author does not
           * relearn it mid-canvas.
           */}
          <ScrubInput
            className="floating-toolbar-scrub"
            label="حجم الخط"
            value={Math.round(Number(style.fontSize || 12) * 10) / 10}
            min={5}
            max={200}
            step={0.5}
            precision={1}
            suffix="pt"
            onChange={(v) => updateStyle(el.id, { fontSize: v }, true)}
            onCommit={(v) => {
              updateStyle(el.id, { fontSize: v });
              commit();
            }}
          />
        </div>
      )}

      {inBar.has("format") && (
        <div className="floating-toolbar-section">
          <TipButton
            label="عريض"
            pressed={Number(style.fontWeight || 0) >= 700}
            onClick={() => {
              updateStyle(el.id, {
                fontWeight: Number(style.fontWeight) >= 700 ? 500 : 800,
              });
              commit();
            }}
          >
            <Bold />
          </TipButton>
          <TipButton
            label="مائل"
            pressed={style.fontStyle === "italic"}
            onClick={() => {
              updateStyle(el.id, {
                fontStyle: style.fontStyle === "italic" ? "normal" : "italic",
              });
              commit();
            }}
          >
            <Italic />
          </TipButton>
          <TipButton
            label="تحته خط"
            pressed={style.underline === true}
            onClick={() => {
              updateStyle(el.id, { underline: style.underline !== true });
              commit();
            }}
          >
            <Underline />
          </TipButton>
          <ColorField
            className="floating-toolbar-swatch"
            label="لون النص"
            value={style.color}
            fallback="#172033"
            onChange={(v) => updateStyle(el.id, { color: v }, true)}
            onCommit={(v) => updateStyle(el.id, { color: v })}
          />
          {/* Paragraph alignment is four choices for one job — a popover, not
              four permanent slots competing with the font controls. */}
          <AnchorMenu
            label="محاذاة الفقرة"
            width={168}
            trigger={({ ref, ...props }) => (
              <button
                {...props}
                ref={ref}
                type="button"
                className="floating-toolbar-btn"
                aria-label="محاذاة الفقرة"
              >
                <AlignCurrent />
              </button>
            )}
          >
            {paragraphAlign.map((item) => {
              const Icon = item.icon;
              return (
                <MenuRow
                  key={item.id}
                  icon={<Icon className="size-4" />}
                  label={item.label}
                  checked={(style.textAlign || "right") === item.id}
                  onSelect={() => setParagraphAlign(item.id)}
                />
              );
            })}
          </AnchorMenu>
        </div>
      )}

      {inBar.has("ink") && (
        <div className="floating-toolbar-section">
          <ColorField
            className="floating-toolbar-swatch"
            label="لون التعبئة"
            value={objectColors.fill.value}
            fallback={objectColors.fill.fallback}
            allowNone
            onChange={objectColors.fill.onChange}
            onCommit={objectColors.fill.onCommit}
          />
          <ColorField
            className="floating-toolbar-swatch"
            label="لون الإطار"
            value={objectColors.border.value}
            fallback={objectColors.border.fallback}
            onChange={objectColors.border.onChange}
            onCommit={objectColors.border.onCommit}
          />
        </div>
      )}

      {/* Owns its leading separator, so a selection without stroke support
          never leaves a stray divider in the bar. */}
      {inBar.has("stroke") && <StrokeControls />}

      {inBar.has("element") && (
        <div className="floating-toolbar-section">
          <TipButton label="تكرار" shortcut="⌘D" onClick={duplicateSelected}>
            <Copy />
          </TipButton>
          <TipButton label="حذف" shortcut="Delete" danger onClick={deleteSelected}>
            <Trash2 />
          </TipButton>
        </div>
      )}

      <span className="floating-toolbar-sep" aria-hidden />

      {/*
       * «المزيد» — everything that is real but not immediate: alignment and
       * distribution, rotation and flips, lock/hide/duplicate/delete, opacity,
       * the style clipboard and equal sizing. A movable drawer of icon
       * controls, so the bar adapts to the selection instead of listing every
       * action the editor can perform.
       */}
      <AnchorMenu
        label="المزيد"
        drawer={{ id: "selection-more", title: "أدوات العنصر" }}
        width={240}
        side="top"
        align="end"
        trigger={({ ref, ...props }) => (
          <button
            {...props}
            ref={ref}
            type="button"
            className="floating-toolbar-btn"
            aria-label="المزيد من أدوات العنصر"
          >
            <MoreHorizontal />
          </button>
        )}
      >
        <MenuGrid columns={3} label="المحاذاة">
          {(
            [
              ["right", "محاذاة لليمين"],
              ["center-h", "توسيط أفقي"],
              ["left", "محاذاة لليسار"],
              ["top", "محاذاة للأعلى"],
              ["center-v", "توسيط رأسي"],
              ["bottom", "محاذاة للأسفل"],
            ] as const
          ).map(([kind, title]) => (
            <MenuCell
              key={kind}
              icon={<AlignIcon kind={kind} />}
              label={title}
              onSelect={() => alignEdge(kind)}
            />
          ))}
        </MenuGrid>
        <MenuGrid columns={4} label="التوزيع والتحويل">
          <MenuCell
            icon={<AlignIcon kind="dist-h" />}
            label="توزيع أفقي متساوٍ"
            disabled={count < 3}
            onSelect={() => distribute("h")}
          />
          <MenuCell
            icon={<AlignIcon kind="dist-v" />}
            label="توزيع رأسي متساوٍ"
            disabled={count < 3}
            onSelect={() => distribute("v")}
          />
          <MenuCell
            icon={<RotateCcw />}
            label="تدوير 90° لليسار"
            onSelect={() => rotate(-90)}
          />
          <MenuCell
            icon={<RotateCw />}
            label="تدوير 90° لليمين"
            onSelect={() => rotate(90)}
          />
        </MenuGrid>
        <MenuGrid columns={4} label="القلب والتحجيم">
          <MenuCell
            icon={<FlipHorizontal2 />}
            label="قلب أفقي"
            active={style.flipX === true}
            onSelect={() => flipSelected("x")}
          />
          <MenuCell
            icon={<FlipVertical2 />}
            label="قلب رأسي"
            active={style.flipY === true}
            onSelect={() => flipSelected("y")}
          />
          <MenuCell
            icon={<Scaling />}
            label="قفل التحجيم — تجميد العرض والارتفاع"
            active={el.resizeLocked === true}
            onSelect={() => toggleResizeLock()}
          />
          <MenuCell
            icon={<Maximize2 />}
            label="ملاءمة صندوق النص"
            disabled={!isText}
            onSelect={() => fitTextBox(el.id)}
          />
        </MenuGrid>
        <MenuGrid columns={4} label="العنصر">
          <MenuCell
            icon={el.locked ? <Unlock /> : <Lock />}
            label={el.locked ? "فتح القفل" : "قفل العنصر — منع التحرير"}
            active={el.locked === true}
            onSelect={() => toggleLock()}
          />
          <MenuCell
            icon={<EyeOff />}
            label="إخفاء العنصر — يظهر مرة أخرى من شجرة الطبقات"
            onSelect={() => toggleHidden()}
          />
          <MenuCell icon={<Copy />} label="تكرار" onSelect={duplicateSelected} />
          <MenuCell
            icon={<Trash2 />}
            label="حذف العنصر"
            danger
            onSelect={deleteSelected}
          />
        </MenuGrid>
        <MenuGroup title="الشفافية" />
        <div className="editor-menu-field">
          <ScrubInput
            label="الشفافية"
            value={Math.round((el.opacity ?? 1) * 100)}
            min={0}
            max={100}
            step={1}
            precision={0}
            suffix="%"
            onChange={(v) => updateElement(el.id, { opacity: v / 100 }, true)}
            onCommit={(v) => {
              updateElement(el.id, { opacity: v / 100 });
              commit();
            }}
          />
        </div>
        <MenuGroup title="التنسيق والحجم" />
        <MenuGrid columns={2} label="نسخ التنسيق">
          <MenuCell
            icon={<Paintbrush />}
            label="نسخ التنسيق"
            onSelect={copyStyle}
          />
          <MenuCell
            icon={<Paintbrush />}
            label="لصق التنسيق"
            disabled={!styleClipboard}
            onSelect={pasteStyle}
          />
        </MenuGrid>
        <MenuGrid columns={3} label="توحيد المقاس">
          <MenuCell
            icon={<ArrowLeftRight />}
            label="نفس العرض"
            disabled={count < 2}
            onSelect={() => matchSize("width")}
          />
          <MenuCell
            icon={<ArrowUpDown />}
            label="نفس الارتفاع"
            disabled={count < 2}
            onSelect={() => matchSize("height")}
          />
          <MenuCell
            icon={<Maximize2 />}
            label="نفس الحجم"
            disabled={count < 2}
            onSelect={() => matchSize("both")}
          />
        </MenuGrid>
      </AnchorMenu>

      <span className="floating-toolbar-sep" aria-hidden />
      {/*
       * Quick dismiss. The author can silence the bubble from the bubble
       * itself (it follows every selection, so it is the thing that is in the
       * way right now); «عرض» turns it back on. The choice is persisted with
       * the rest of the UI state.
       */}
      <button
        type="button"
        className="floating-toolbar-btn"
        title="إخفاء الشريط العائم (يمكن إرجاعه من «عرض»)"
        aria-label="إخفاء الشريط العائم"
        onClick={() => toggleBubble(false)}
      >
        <X />
      </button>

    </div>,
    document.body,
  );
}

/**
 * One bubble button. Same tooltip contract as the rest of the studio
 * (hover on pointer devices, long-press on touch) so no icon in the bar is a
 * mystery, and the same pressed/active affordance the panel buttons use.
 *
 * `shortcut` is for a key the editor actually binds, shown in ONE place: a
 * decorative key cap that does nothing on press is worse than none.
 */
function TipButton({
  label,
  hint,
  shortcut,
  pressed,
  danger,
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  shortcut?: string;
  pressed?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tip label={label} hint={hint} shortcut={shortcut}>
      <button
        type="button"
        className={cn(
          "floating-toolbar-btn",
          pressed && "is-active",
          danger && "text-error",
        )}
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={shortcut || undefined}
        onClick={onClick}
      >
        {children}
      </button>
    </Tip>
  );
}
