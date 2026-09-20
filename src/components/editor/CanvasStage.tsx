import { useEffect, useMemo, useRef, useState } from "react";
import { findElement, MIN_SIZE, pageSize, type Box, type CanvasEl, type Page } from "@/lib/editor/model";
import { applySnap, resizeByHandle } from "@/lib/editor/transform";
import { useEditor } from "@/lib/editor/store";
import { prepareText } from "@/lib/editor/text-render";
import { clamp, cn, round } from "@/lib/utils";
import { ElementNode } from "./ElementNode";
import { toast } from "sonner";

type Op =
  | {
      kind: "move" | "resize" | "rotate";
      id: string;
      handle?: string;
      startX: number;
      startY: number;
      /** Positions of every element the gesture moves, keyed by id. */
      origins: Record<string, { x: number; y: number }>;
      orig: CanvasEl;
      pageId: string;
      parent?: { x: number; y: number };
    }
  | null;

type Marquee = { x0: number; y0: number; x1: number; y1: number } | null;

const ARTBOARD_GAP_MM = 18;
/**
 * z-index of the selection/manipulation layer inside a page.
 *
 * `normalizeZ` keeps document elements at 1..n, and the marquee/guides live
 * below 100, so a large constant guarantees the overlay is painted above every
 * document element no matter how they stack — the overlay is chrome, never
 * content, and must never lose a hit-test to artwork that happens to overlap
 * the selected element.
 */
const SELECTION_LAYER_Z = 5000;
/** The eight resize handles, named by the corner/edge they sit on. */
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

function pagePoint(rect: DOMRect, size: { w: number; h: number }, clientX: number, clientY: number) {
  return {
    x: ((clientX - rect.left) / rect.width) * size.w,
    y: ((clientY - rect.top) / rect.height) * size.h,
  };
}

export function CanvasStage({ onDropImage }: { onDropImage?: (file: File, at?: { x: number; y: number }) => void }) {
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const enteredGroupId = useEditor((s) => s.enteredGroupId);
  const zoom = useEditor((s) => s.zoom);
  const previewAll = useEditor((s) => s.previewAll);
  const showGrid = useEditor((s) => s.showGrid);
  const snapGrid = useEditor((s) => s.snapGrid);
  const snapElements = useEditor((s) => s.snapElements);
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const selectMany = useEditor((s) => s.selectMany);
  const enterGroup = useEditor((s) => s.enterGroup);
  const replaceElement = useEditor((s) => s.replaceElement);
  const fitTextBox = useEditor((s) => s.fitTextBox);
  const commit = useEditor((s) => s.commit);
  const setActivePage = useEditor((s) => s.setActivePage);
  const setZoom = useEditor((s) => s.setZoom);
  const editingId = useEditor((s) => s.editingId);

  const opRef = useRef<Op>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const spaceDown = useRef(false);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [marquee, setMarquee] = useState<Marquee>(null);
  const [dropping, setDropping] = useState(false);
  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === "Space" && !(event.target as HTMLElement | null)?.isContentEditable) spaceDown.current = true;
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceDown.current = false;
    };
    const blur = () => {
      spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  /**
   * Translate a drop point into page millimetres.
   *
   * The drop target is resolved from the element under the pointer rather than
   * a ref, because the author may drop onto any page — including one that is not
   * the active page in the all-pages preview.
   */
  const dropPoint = (e: React.DragEvent): { x: number; y: number; pageId: string } | null => {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-page-id]");
    if (!target) return null;
    const pageId = target.dataset.pageId;
    const page = pages.find((p) => p.id === pageId);
    if (!page) return null;
    const size = pageSize(page);
    const rect = target.getBoundingClientRect();
    const point = pagePoint(rect, size, e.clientX, e.clientY);
    return { pageId: page.id, ...point };
  };

  const visible = useMemo(
    () => (previewAll ? pages : pages.filter((p) => p.id === activePageId)),
    [pages, previewAll, activePageId],
  );

  const startOp = (
    e: React.PointerEvent,
    page: Page,
    el: CanvasEl,
    kind: "move" | "resize" | "rotate",
    handle?: string,
    parent?: { x: number; y: number },
  ) => {
    if (el.locked) {
      // Locked elements can be selected but not gestured; stopping the press
      // here keeps the stage's click-to-deselect from immediately undoing it.
      e.stopPropagation();
      select(el.id);
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setActivePage(page.id);

    /*
     * Selection rules, in the order a design tool applies them:
     *  · shift extends the selection, so several elements can be gathered;
     *  · pressing an element that is already part of a multi-selection keeps the
     *    whole selection, so it can be dragged as a unit;
     *  · anything else replaces the selection with the pressed element.
     */
    if (e.shiftKey) toggleSelect(el.id);
    else if (!selectedSet.has(el.id)) select(el.id);

    const pageEl = pageRefs.current[page.id];
    if (!pageEl) return;
    const size = pageSize(page);
    // Snapshot the live page geometry once: reading it per pointermove would
    // force a layout on every frame of a drag.
    const rect = pageEl.getBoundingClientRect();
    const toMm = (ev: { clientX: number; clientY: number }) => pagePoint(rect, size, ev.clientX, ev.clientY);

    const start = toMm(e);

    // The elements this gesture moves. A resize or rotate handle only ever acts
    // on the pressed element; a plain drag carries the whole selection unless
    // the press was a shift-toggle, which is a selection change and not a drag.
    const draggingIds =
      kind !== "move" || e.shiftKey ? [el.id] : selectedSet.has(el.id) ? selectedIds : [el.id];
    const linkedIds =
      kind === "move" && !e.shiftKey
        ? page.elements
            .filter((candidate) => candidate.linkId && draggingIds.some((id) => page.elements.find((item) => item.id === id)?.linkId === candidate.linkId))
            .map((candidate) => candidate.id)
        : [];
    const gestureIds = [...new Set([...draggingIds, ...linkedIds])];

    // When inside a group, children live in entered.children with
    // group-relative coordinates; otherwise they're in page.elements.
    const enteredGroup = enteredGroupId
      ? findElement(page.elements, enteredGroupId)?.el || null
      : null;
    const enteredChildren = enteredGroup?.children || [];

    const origins: Record<string, { x: number; y: number }> = {};
    if (kind === "move" && !e.shiftKey) {
      for (const id of gestureIds) {
        let found: CanvasEl | undefined;
        if (enteredGroup && enteredChildren.some((c) => c.id === id)) {
          found = enteredChildren.find((c) => c.id === id);
        } else {
          found = page.elements.find((x) => x.id === id);
        }
        if (found) origins[id] = { x: found.x, y: found.y };
      }
    }

    opRef.current = {
      kind,
      id: el.id,
      handle,
      startX: start.x,
      startY: start.y,
      origins,
      orig: { ...el, style: { ...el.style } },
      pageId: page.id,
      parent,
    };

    const others = page.elements.filter((x) => x.id !== el.id && !x.hidden);

    const move = (ev: PointerEvent) => {
      const op = opRef.current;
      if (!op) return;
      const cur = toMm(ev);
      const dx = cur.x - op.startX;
      const dy = cur.y - op.startY;
      const next: CanvasEl = { ...op.orig, style: { ...op.orig.style } };

      if (op.kind === "move") {
        next.x = op.orig.x + dx;
        next.y = op.orig.y + dy;
        /*
         * Snap policy for moves:
         *  · Alt escapes all snapping mid-gesture, so a stuck alignment never
         *    traps the element;
         *  · Shift is the alignment mode — smart guides stay available for the
         *    gesture even when the element-snap preference is off;
         *  · otherwise the author's grid/element snap preferences apply.
         * The threshold itself is screen-space (see transform.ts), so zoom has
         * no effect on how eagerly an element locks on.
         */
        const zoomNow = useEditor.getState().zoom;
        const snapped = applySnap(
          next,
          others,
          size,
          snapGrid && !ev.altKey,
          !ev.altKey && (snapElements || ev.shiftKey),
          zoomNow,
          op.origins,
        );
        setGuides(snapped);
        // Everything else in the selection follows the pressed element's final,
        // snapped offset, so their spacing relative to each other is preserved.
        const appliedDx = next.x - op.orig.x;
        const appliedDy = next.y - op.orig.y;
        // When inside a group, siblings live in entered.children; otherwise in page.elements.
        const siblingList = op.parent && enteredGroup
          ? enteredChildren
          : page.elements;
        for (const [id, origin] of Object.entries(op.origins)) {
          if (id === op.id) continue;
          const sibling = siblingList.find((x) => x.id === id);
          if (!sibling) continue;
          replaceElement(
            { ...sibling, x: origin.x + appliedDx, y: origin.y + appliedDy },
            true,
          );
        }
      } else if (op.kind === "resize") {
        // Shift (or the element's own aspect lock) preserves the element's
        // current aspect ratio; a plain drag resizes freely.
        resizeByHandle(next, op.orig, op.handle || "se", dx, dy, ev.shiftKey || op.orig.style?.aspectLock === true);
      } else if (op.kind === "rotate") {
        const cx = op.orig.x + op.orig.w / 2;
        const cy = op.orig.y + op.orig.h / 2;
        const a0 = Math.atan2(op.startY - cy, op.startX - cx);
        const a1 = Math.atan2(cur.y - cy, cur.x - cx);
        const raw = (op.orig.rotation || 0) + ((a1 - a0) * 180) / Math.PI;
        next.rotation = ev.shiftKey ? Math.round(raw / 15) * 15 : round(raw % 360);
      }
      // Editing is free: an element may sit fully inside the page, straddle its
      // edge, or move entirely outside it. Only export clips content to the
      // page rectangle. We keep a generous soft boundary so the user can freely
      // position elements outside the page area when needed.
      const workspaceMargin = 120; // extra workspace area around page (mm)
      const workspaceW = size.w + workspaceMargin * 2;
      const workspaceH = size.h + workspaceMargin * 2;
      next.w = Math.max(clamp(next.w, MIN_SIZE, workspaceW), MIN_SIZE);
      next.h = Math.max(clamp(next.h, MIN_SIZE, workspaceH), MIN_SIZE);
      // Soft boundary: allow elements to extend beyond page but keep them
      // within a generous workspace area so nothing disappears unexpectedly.
      next.x = Math.max(-workspaceMargin, Math.min(next.x, size.w + workspaceMargin - next.w));
      next.y = Math.max(-workspaceMargin, Math.min(next.y, size.h + workspaceMargin - next.h));
      replaceElement(op.parent ? { ...next, x: next.x - op.parent.x, y: next.y - op.parent.y } : next, true);
    };

    const up = () => {
      opRef.current = null;
      setGuides({ v: [], h: [] });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      commit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /**
   * Elements a click or marquee can pick, in the current grouping context.
   *
   * Outside a group that is the top-level list — a group counts as one element.
   * Once the author steps into a group, its members become pickable instead, at
   * their absolute page positions.
   */
  const pickables = (page: Page): { id: string; box: Box }[] => {
    const entered = enteredGroupId ? findElement(page.elements, enteredGroupId)?.el || null : null;
    if (entered?.children?.length) {
      return entered.children.map((child) => ({
        id: child.id,
        box: { x: entered.x + child.x, y: entered.y + child.y, w: child.w, h: child.h },
      }));
    }
    return page.elements.map((el) => ({ id: el.id, box: { x: el.x, y: el.y, w: el.w, h: el.h } }));
  };

  /** Rubber-band selection on empty page space. */
  const startMarquee = (e: React.PointerEvent, page: Page) => {
    const pageEl = pageRefs.current[page.id];
    if (!pageEl) return;
    const size = pageSize(page);
    const rect = pageEl.getBoundingClientRect();
    const toMm = (ev: { clientX: number; clientY: number }) => pagePoint(rect, size, ev.clientX, ev.clientY);
    const start = toMm(e);
    const additive = e.shiftKey;
    const before = additive ? [...selectedIds] : [];
    const candidates = pickables(page);
    let moved = false;

    const move = (ev: PointerEvent) => {
      const cur = toMm(ev);
      moved = true;
      const box: Box = {
        x: Math.min(start.x, cur.x),
        y: Math.min(start.y, cur.y),
        w: Math.abs(cur.x - start.x),
        h: Math.abs(cur.y - start.y),
      };
      setMarquee({ x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h });
      // Intersection, not full containment: brushing across a row of elements is
      // the gesture people actually use to grab them all.
      const hits = candidates
        .filter(
          (p) =>
            p.box.x < box.x + box.w &&
            p.box.x + p.box.w > box.x &&
            p.box.y < box.y + box.h &&
            p.box.y + p.box.h > box.y,
        )
        .map((p) => p.id);
      selectMany([...before, ...hits.filter((id) => !before.includes(id))]);
    };

    const up = () => {
      setMarquee(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // A press with no drag is a plain click on empty space, which clears the
      // selection the way every design tool does.
      if (!moved && !additive) select(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={stageRef}
      className={cn("editor-canvas-stage studio-grid relative min-h-0 min-w-0 overflow-auto px-6 py-8", dropping && "is-dropping")}
      style={{ "--editor-zoom": zoom } as React.CSSProperties}
      dir="ltr"
      onPointerDownCapture={(e) => {
        if (!spaceDown.current || !stageRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        const stage = stageRef.current;
        const startX = e.clientX;
        const startY = e.clientY;
        const scrollLeft = stage.scrollLeft;
        const scrollTop = stage.scrollTop;
        const move = (event: PointerEvent) => {
          stage.scrollLeft = scrollLeft - (event.clientX - startX);
          stage.scrollTop = scrollTop - (event.clientY - startY);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      onPointerDown={() => select(null)}
      onWheel={(e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        setZoom(useEditor.getState().zoom + (e.deltaY < 0 ? 0.06 : -0.06));
      }}
      onDragOver={(e) => {
        if (!onDropImage || !e.dataTransfer.types.includes("Files")) return;
        // Claiming the drop is what suppresses the browser's "open the file" handoff.
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropping(false);
      }}
      onDrop={(e) => {
        setDropping(false);
        if (!onDropImage) return;
        e.preventDefault();
        const file = Array.from(e.dataTransfer.files)[0];
        if (!file || !file.type.startsWith("image/")) {
          toast.error("نوع الملف غير مدعوم.");
          return;
        }
        const at = dropPoint(e);
        if (at) setActivePage(at.pageId);
        onDropImage(file, at ? { x: at.x, y: at.y } : undefined);
      }}
    >
      {dropping && (
        <div className="pointer-events-none sticky top-0 z-50 mx-auto w-max rounded-full border border-gold/40 bg-white/95 px-4 py-1.5 text-[11px] font-extrabold text-navy shadow-sm dark:bg-[#161c26] dark:text-gold-2">
          أفلت الصورة لإضافتها إلى الصفحة
        </div>
      )}
      <div className="mx-auto flex w-max min-w-full flex-col items-center gap-3" dir="rtl">
        {visible.map((page) => {
          const size = pageSize(page);
          const isActive = page.id === activePageId;
          const entered = enteredGroupId ? findElement(page.elements, enteredGroupId)?.el || null : null;
          const enteredKids = entered?.children ?? [];
          /*
           * Selection/manipulation frames for this page, in the grouping
           * context the author is in (group members at their absolute page
           * positions). They render in a dedicated overlay layer above every
           * document element so overlapping artwork can never block the
           * selection outline, the handles or a drag on the selected element.
           */
          const selectionFrames: SelectionBox[] = [];
          if (isActive) {
            if (entered && enteredKids.length) {
              for (const child of enteredKids) {
                if (selectedSet.has(child.id) && !child.hidden) {
                  selectionFrames.push({
                    el: { ...child, x: entered.x + child.x, y: entered.y + child.y },
                    parent: { x: entered.x, y: entered.y },
                  });
                }
              }
            } else {
              for (const el of page.elements) {
                if (selectedSet.has(el.id) && !el.hidden && el.id !== entered?.id) {
                  selectionFrames.push({ el, parent: undefined });
                }
              }
            }
          }
          return (
            <div
              key={page.id}
              className="page-frame shrink-0"
              dir="ltr"
              style={{
                width: `${size.w * zoom}mm`,
                height: `${(size.h + 12 + ARTBOARD_GAP_MM) * zoom}mm`,
              }}
            >
              <div className="page-frame-content" dir="ltr" style={{ width: `${size.w}mm`, height: `${size.h + 12}mm`, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
              <div className="mb-2 flex items-center justify-between gap-4 text-[12px] text-muted" dir="rtl">
                <strong className="text-ink dark:text-white">
                  {page.name}
                  {entered && <span className="ms-2 font-semibold text-gold-2">· داخل «{entered.name}»</span>}
                </strong>
                <span className="tabular-nums">
                  {previewAll
                    ? `صفحة ${pages.findIndex((p) => p.id === page.id) + 1} من ${pages.length}`
                    : `${round(size.w)} × ${round(size.h)} مم`}
                </span>
              </div>
              <div
                ref={(n) => {
                  pageRefs.current[page.id] = n;
                }}
                data-page-id={page.id}
                className={`report-page ${showGrid ? "show-grid" : ""} ${isActive ? "ring-2 ring-gold ring-offset-8" : ""}`}
                style={{ width: `${size.w}mm`, height: `${size.h}mm`, background: page.bg || "#fff" }}
                onPointerDown={(e) => {
                  // Only a press on the page itself starts a marquee; presses on
                  // elements are handled by the element and stop propagation.
                  if (e.target !== e.currentTarget) return;
                  e.stopPropagation();
                  setActivePage(page.id);
                  startMarquee(e, page);
                }}
              >
                {page.elements
                  .slice()
                  .sort((a, b) => a.z - b.z)
                  .map((el) => {
                    // Stepped into this group: its frame is drawn for context and
                    // its members become individually selectable nodes, instead of
                    // the group behaving as one opaque element.
                    if (entered && el.id === entered.id && enteredKids.length) {
                      return (
                        <div key={el.id}>
                          <div
                            className="canvas-el group-frame"
                            style={{
                              left: `${el.x}mm`,
                              top: `${el.y}mm`,
                              width: `${el.w}mm`,
                              height: `${el.h}mm`,
                              transform: `rotate(${el.rotation || 0}deg)`,
                              zIndex: el.z,
                            }}
                          />
                          {enteredKids
                            .slice()
                            .sort((a, b) => a.z - b.z)
                            .map((child) => {
                              const abs = { ...child, x: entered.x + child.x, y: entered.y + child.y };
                              return (
                                <ElementNode
                                  key={child.id}
                                  el={abs}
                                  interactive
                                  onPointerDown={(ev, kind, handle) => startOp(ev, page, abs, kind, handle, { x: entered.x, y: entered.y })}
                                />
                              );
                            })}
                        </div>
                      );
                    }
                    if (entered && el.id === entered.id) return null;
                    return (
                      <ElementNode
                        key={el.id}
                        el={el}
                        interactive
                        onEnterGroup={el.type === "group" ? () => enterGroup(el.id) : undefined}
                        onPointerDown={(ev, kind, handle) => startOp(ev, page, el, kind, handle)}
                      />
                    );
                  })}
                {marquee && (
                  <div
                    className="marquee"
                    style={{
                      left: `${marquee.x0}mm`,
                      top: `${marquee.y0}mm`,
                      width: `${Math.abs(marquee.x1 - marquee.x0)}mm`,
                      height: `${Math.abs(marquee.y1 - marquee.y0)}mm`,
                    }}
                  />
                )}
                {isActive &&
                  page.elements.map((el) => (
                    <OverflowFlag key={el.id} el={el} onFit={() => fitTextBox(el.id)} />
                  ))}
                {isActive &&
                  guides.v.map((x) => <div key={`v${x}`} className="guide-v" style={{ left: `${x}mm` }} />)}
                {isActive &&
                  guides.h.map((y) => <div key={`h${y}`} className="guide-h" style={{ top: `${y}mm` }} />)}
                {isActive &&
                  selectionFrames.length > 0 && (
                    <div className="selection-layer" style={{ zIndex: SELECTION_LAYER_Z }}>
                      {selectionFrames.map((frame) => (
                        <SelectionFrame
                          key={frame.el.id}
                          frame={frame}
                          primary={selectedIds.length === 1}
                          editing={editingId === frame.el.id}
                          onGesture={(ev, kind, handle) =>
                            startOp(ev, page, frame.el, kind, handle, frame.parent)
                          }
                          onEditRequest={() => requestEdit(page.id, frame.el.id)}
                        />
                      ))}
                    </div>
                  )}
              </div>
              </div>
            </div>
          );
        })}
      </div>
      <ExportCapture pages={pages} />
    </div>
  );
}

/**
 * Overflow marker for an element whose text does not fit its box.
 *
 * Drawn as a sibling of the element rather than inside it, because `.canvas-el`
 * clips its own content — a badge placed inside would be cut off by exactly the
 * element it is warning about. Clicking it applies the fix.
 */
function OverflowFlag({ el, onFit }: { el: CanvasEl; onFit: () => void }) {
  if (el.hidden || el.type === "group") return null;
  const prepared = prepareText(el);
  if (!prepared.clipped) return null;
  return (
    <button
      type="button"
      className="overflow-badge"
      style={{ left: `${el.x}mm`, top: `${el.y + el.h + 1}mm` }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onFit();
      }}
      title="النص أطول من الصندوق — اضغط لملاءمة الصندوق مع النص"
    >
      النص أطول من الصندوق
    </button>
  );
}

/** A selected element to draw a manipulation frame for, plus its group offset. */
interface SelectionBox {
  /** Absolute page-space geometry (group members already offset). */
  el: CanvasEl;
  /** Group-relative coordinate offset, when stepping inside a group. */
  parent?: { x: number; y: number };
}

/**
 * Manipulation frame for one selected element, rendered in the selection layer.
 *
 * This is the editor's separation of concerns in practice: the document layer
 * (ElementNode) paints content in z-order, while this frame — always above all
 * artwork — owns selection chrome and pointer interaction for the selection.
 * Overlapping elements can never steal its handles, its drag, or its outline.
 *
 * The frame mirrors the element's box and rotation exactly, so the handles sit
 * on the true rotated corners; `--editor-zoom` keeps their screen size stable
 * at every zoom level.
 */
function SelectionFrame({
  frame,
  primary,
  editing,
  onGesture,
  onEditRequest,
}: {
  frame: SelectionBox;
  primary: boolean;
  editing: boolean;
  onGesture: (e: React.PointerEvent, kind: "move" | "resize" | "rotate", handle?: string) => void;
  onEditRequest: () => void;
}) {
  const select = useEditor((s) => s.select);
  const el = frame.el;
  return (
    <div
      className={cn(
        "selection-frame",
        !primary && "is-secondary",
        el.locked && "is-locked",
        editing && "is-editing",
      )}
      style={{
        left: `${el.x}mm`,
        top: `${el.y}mm`,
        width: `${el.w}mm`,
        height: `${el.h}mm`,
        transform: `rotate(${el.rotation || 0}deg)`,
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest(".handle, .rotate-handle")) return;
        e.stopPropagation();
        if (el.locked) {
          select(el.id);
          return;
        }
        onGesture(e, "move");
      }}
      onDoubleClick={(e) => {
        // Text editing, group stepping: delegate to the element node itself so
        // there is exactly one edit pathway, never a duplicate.
        e.stopPropagation();
        onEditRequest();
      }}
    >
      {primary && !el.locked && !editing && (
        <>
          {HANDLES.map((h) => (
            <div
              key={h}
              className={cn("handle", h)}
              onPointerDown={(e) => {
                e.stopPropagation();
                onGesture(e, "resize", h);
              }}
            />
          ))}
          <div
            className="rotate-handle"
            onPointerDown={(e) => {
              e.stopPropagation();
              onGesture(e, "rotate");
            }}
          />
        </>
      )}
    </div>
  );
}

/**
 * Forward a double-click on the manipulation frame to the element node beneath
 * it, which owns in-place text editing and group stepping. Dispatching a real
 * `dblclick` keeps one editing implementation instead of duplicating it in the
 * overlay.
 */
function requestEdit(pageId: string, elId: string) {
  const host = document.querySelector<HTMLElement>(`[data-page-id="${pageId}"]`);
  const node = host?.querySelector<HTMLElement>(`[data-el-id="${CSS.escape(elId)}"]`);
  node?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
}

/**
 * Hidden 1:1 pages used by export capture. Rendered off-screen (not
 * `display:none`) so html2canvas still measures real boxes and loads images.
 */
function ExportCapture({ pages }: { pages: Page[] }) {
  return (
    <div
      id="export-root"
      className="pointer-events-none fixed top-0 left-[-2400px] z-[-1]"
      aria-hidden
    >
      {pages.map((page) => {
        const size = pageSize(page);
        return (
          <div
            key={page.id}
            data-export-page={page.id}
            className="report-page"
            style={{ width: `${size.w}mm`, height: `${size.h}mm`, background: page.bg || "#fff" }}
          >
            {page.elements
              .slice()
              .sort((a, b) => a.z - b.z)
              .map((el) => (
                <ElementNode key={el.id} el={el} interactive={false} onPointerDown={() => {}} />
              ))}
          </div>
        );
      })}
    </div>
  );
}
