import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  MousePointerClick,
  Redo2,
  RotateCcw,
  Trash2,
  Type as TypeIcon,
  Undo2,
} from "lucide-react";
import type { AdminTemplateSummary } from "@/lib/admin/types";
import { TYPE_NAME, pageSize, type CanvasEl } from "@/lib/editor/model";
import type { GestureBox } from "@/lib/editor/transform";
import { TemplatePreview } from "@/components/site/TemplatePreview";
import {
  HOME_EDITOR_INITIAL,
  type HomeEditorAction,
  activePageOf,
  canRedo,
  canUndo,
  fitPaperBox,
  homeEditorReducer,
  isTextualElement,
  loadHomeEditorDocument,
  pixelsToMm,
  resizedBox,
  selectedElementOf,
  stackedElements,
} from "@/lib/site/home-editor";
import { cn } from "@/lib/utils";

/**
 * The homepage editor — a real NASAQ document, live in the hero.
 *
 * It paints the published catalog record the Admin featured (or the bundled
 * «تقرير رسمي» pack when none is available) with the SAME renderer the
 * template catalog uses, and edits it through the SAME document model and
 * geometry helpers the studio canvas uses. Selection, dragging, resizing,
 * retyping text, duplicating, deleting, undo/redo and page navigation all run
 * against that model — see `@/lib/site/home-editor`.
 *
 * Why it is not an `<iframe src="/editor">` any more: the app answers every
 * request with `X-Frame-Options: DENY` (server/middleware/00-security-headers),
 * so the browser refuses to paint a framed `/editor` in production — the hero
 * showed an empty box. A frame also swallowed the page scroll (the studio sets
 * `overflow: hidden` + `overscroll-behavior: none` on its own body, which stops
 * scroll chaining out of the frame) and booted the whole studio bundle inside
 * the marketing page. Nothing here frames anything, so the security header
 * stays as strict as it was.
 *
 * Scrolling and touch: the stage only declares `touch-action: pan-y`, and a
 * touch has to select an element before it can drag it — so a swipe over the
 * hero scrolls the homepage on iPad exactly like a swipe anywhere else, and no
 * wheel handler is installed at all.
 */
export function LiveEditorPreview({
  document: featured,
  pending = false,
}: {
  /** The published catalog record selected in Admin, when there is one. */
  document?: AdminTemplateSummary | null;
  /** The catalog answer has not arrived yet — wait before booting. */
  pending?: boolean;
}) {
  const [model, dispatch] = useReducer(homeEditorReducer, HOME_EDITOR_INITIAL);
  const [booting, setBooting] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const featuredId = featured?.id ?? "";

  /**
   * One boot per document.
   *
   * `loadHomeEditorDocument` memoises its promise per id, so a re-mount (or
   * React's double-invoked development effect) reuses the same document
   * instead of fetching and mounting a second editor. The `alive` flag drops
   * a late answer from a previous id, so a stale document can never land in
   * the live model.
   */
  useEffect(() => {
    if (pending) return;
    let alive = true;
    setBooting(true);
    void loadHomeEditorDocument(featuredId).then((doc) => {
      if (!alive) return;
      dispatch({ type: "load", doc });
      setBooting(false);
    });
    return () => {
      alive = false;
    };
  }, [featuredId, pending]);

  /** The paper is fitted to the measured stage, so any page size fits. */
  useEffect(() => {
    const node = viewportRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const apply = (width: number, height: number) => {
      setViewport((prev) =>
        Math.abs(prev.width - width) < 0.5 &&
        Math.abs(prev.height - height) < 0.5
          ? prev
          : { width, height },
      );
    };
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) apply(rect.width, rect.height);
    });
    observer.observe(node);
    apply(node.clientWidth, node.clientHeight);
    return () => observer.disconnect();
  }, []);

  const page = activePageOf(model);
  const selected = selectedElementOf(model);
  const editing = model.editingId
    ? (page?.elements.find((el) => el.id === model.editingId) ?? null)
    : null;
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const editingRef = useRef<string | null>(null);
  editingRef.current = editing?.id ?? null;
  const size = useMemo(() => pageSize(page ?? undefined), [page]);
  const paper = useMemo(
    () => fitPaperBox(viewport, page ?? undefined),
    [viewport, page],
  );
  const elements = useMemo(() => stackedElements(page), [page]);

  /**
   * The live gesture. Everything the pointer stream needs is captured here at
   * `pointerdown` (including the paper rect and the page size), so the window
   * listeners below never depend on render state and are installed exactly
   * once — no re-subscription storm while dragging, no stale closure.
   */
  const gestureRef = useRef<{
    pointerId: number;
    id: string;
    mode: "move" | "resize";
    handle: string;
    startX: number;
    startY: number;
    orig: GestureBox;
    rotation: number;
    paper: { width: number; height: number };
    size: { w: number; h: number };
    ratioLock: boolean;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const dxPx = event.clientX - gesture.startX;
      const dyPx = event.clientY - gesture.startY;
      if (!gesture.moved && Math.hypot(dxPx, dyPx) < 2) return;
      gesture.moved = true;
      const { dx, dy } = pixelsToMm(gesture.paper, gesture.size, dxPx, dyPx);
      const box =
        gesture.mode === "move"
          ? { ...gesture.orig, x: gesture.orig.x + dx, y: gesture.orig.y + dy }
          : resizedBox(
              gesture.orig,
              gesture.handle,
              dx,
              dy,
              gesture.rotation,
              event.shiftKey || gesture.ratioLock,
            );
      dispatch({ type: "gestureBox", id: gesture.id, box });
    };
    const end = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gestureRef.current = null;
      dispatch({ type: "gestureEnd" });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      // A gesture never outlives the surface: the pointer stream is dropped
      // and the model is told the interaction is over.
      gestureRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);

  const beginGesture = useCallback(
    (
      event: React.PointerEvent<HTMLElement>,
      el: CanvasEl,
      mode: "move" | "resize",
      handle: string,
    ) => {
      const rect = paperRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      gestureRef.current = {
        pointerId: event.pointerId,
        id: el.id,
        mode,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        orig: { x: el.x, y: el.y, w: el.w, h: el.h },
        rotation: el.rotation || 0,
        paper: { width: rect.width, height: rect.height },
        size: pageSize(page ?? undefined),
        ratioLock: Boolean(el.style?.aspectLock),
        moved: false,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dispatch({ type: "gestureStart", id: el.id });
      event.preventDefault();
      event.stopPropagation();
    },
    [page],
  );

  const onElementPointerDown = (
    event: React.PointerEvent<HTMLElement>,
    el: CanvasEl,
  ) => {
    if (event.button > 0) return;
    // The stage clears the selection on an empty press; pressing an element
    // must never reach it, or every selection would be undone immediately.
    event.stopPropagation();
    const alreadySelected = model.selectedId === el.id;
    flushText();
    dispatch({ type: "select", id: el.id });
    /*
     * Touch: the FIRST tap only selects. Until then the element keeps
     * `touch-action: pan-y`, so a swipe that starts on the hero scrolls the
     * homepage instead of dragging artwork — the iPad behaviour the hero
     * needs. A mouse or pen drags immediately; there is no scroll to protect.
     */
    if (event.pointerType === "touch" && !alreadySelected) return;
    if (el.locked) return;
    beginGesture(event, el, "move", "");
  };

  const commitText = (value: string) => {
    if (!editing) return;
    dispatch({ type: "setContent", id: editing.id, content: value });
  };

  /**
   * Save whatever is in the inline editor before anything tears it down.
   *
   * Any action that clears `editingId` (clicking the paper, picking another
   * element, a toolbar button, turning the page) unmounts the textarea, and an
   * unmounted field never fires `blur` — the typing would be silently thrown
   * away. Every UI handler therefore goes through `run`, which flushes first.
   */
  const flushText = useCallback(() => {
    const node = textRef.current;
    const id = editingRef.current;
    if (node && id) dispatch({ type: "setContent", id, content: node.value });
  }, []);

  const run = useCallback(
    (action: HomeEditorAction) => {
      flushText();
      dispatch(action);
    },
    [flushText],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (model.editingId) return;
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === "z") {
      event.preventDefault();
      dispatch({ type: event.shiftKey ? "redo" : "undo" });
      return;
    }
    if (meta && event.key.toLowerCase() === "y") {
      event.preventDefault();
      dispatch({ type: "redo" });
      return;
    }
    if (event.key === "Escape") {
      dispatch({ type: "select", id: null });
      return;
    }
    if (!model.selectedId) return; // nothing selected: the page keeps its keys
    const step = event.shiftKey ? 5 : 1;
    const nudge = (dx: number, dy: number) => {
      event.preventDefault();
      dispatch({ type: "nudge", dx, dy });
    };
    if (event.key === "ArrowLeft") nudge(-step, 0);
    else if (event.key === "ArrowRight") nudge(step, 0);
    else if (event.key === "ArrowUp") nudge(0, -step);
    else if (event.key === "ArrowDown") nudge(0, step);
    else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      dispatch({ type: "delete" });
    } else if (event.key === "Enter" && isTextualElement(selected)) {
      event.preventDefault();
      dispatch({ type: "editText", id: model.selectedId });
    }
  };

  const pageCount = model.pages.length;
  const title = featured?.title || model.doc?.title || "مستند نَسَق";
  const subtitle = featured
    ? `${featured.category} · مستند مميز من كتالوج نَسَق`
    : "تقرير رسمي من قوالب نَسَق";
  const ready = !booting && !!page && pageCount > 0;

  return (
    <div className="mx-auto w-full lg:max-w-none">
      <div
        data-home-editor
        data-home-editor-source={model.doc?.source ?? "loading"}
        className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-card"
      >
        {/* Header — unchanged hero chrome */}
        <div className="flex items-center gap-2 border-b border-line/60 bg-surface px-3 py-2.5">
          {featured?.thumbnail && (
            <img
              src={featured.thumbnail}
              alt=""
              aria-hidden="true"
              className="size-8 shrink-0 rounded border border-line object-cover"
            />
          )}
          <div className="min-w-0">
            <p className="truncate text-[12px] font-extrabold text-ink">
              {title}
            </p>
            <p className="truncate text-[10px] text-muted">{subtitle}</p>
          </div>
          <span className="ms-auto hidden shrink-0 text-[10px] font-bold text-muted sm:block">
            محرر حقيقي — جرّبه بنفسك
          </span>
        </div>

        {/* Toolbar — the actions the hero surface supports */}
        <div className="flex flex-wrap items-center gap-1 border-b border-line/60 bg-surface-2 px-2 py-1.5">
          <ToolButton
            label="تراجع"
            icon={Undo2}
            action="undo"
            disabled={!canUndo(model)}
            onClick={() => run({ type: "undo" })}
          />
          <ToolButton
            label="إعادة"
            icon={Redo2}
            action="redo"
            disabled={!canRedo(model)}
            onClick={() => run({ type: "redo" })}
          />
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <ToolButton
            label="تحرير النص"
            icon={TypeIcon}
            action="edit-text"
            disabled={!isTextualElement(selected)}
            onClick={() =>
              selected && run({ type: "editText", id: selected.id })
            }
          />
          <ToolButton
            label="تكرار العنصر"
            icon={Copy}
            action="duplicate"
            disabled={!selected}
            onClick={() => run({ type: "duplicate" })}
          />
          <ToolButton
            label="حذف العنصر"
            icon={Trash2}
            action="delete"
            disabled={!selected || Boolean(selected.locked)}
            onClick={() => run({ type: "delete" })}
          />
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <ToolButton
            label="استعادة المستند"
            icon={RotateCcw}
            action="reset"
            disabled={!ready}
            onClick={() => run({ type: "reset" })}
          />
          <span className="ms-auto hidden items-center gap-1 text-[10px] font-semibold text-muted sm:flex">
            <MousePointerClick className="size-3.5" aria-hidden />
            اختر عنصرًا ثم اسحبه أو غيّر حجمه
          </span>
        </div>

        {/* Stage — the live document */}
        <div
          ref={viewportRef}
          tabIndex={0}
          role="application"
          aria-label={`محرر نَسَق المصغّر — ${title}`}
          onKeyDown={onKeyDown}
          onPointerDown={() => run({ type: "select", id: null })}
          data-home-editor-stage=""
          /*
           * `pan-y` keeps the homepage scrollable with a finger anywhere over
           * the hero; only a selected element opts out (see below). No wheel
           * listener is registered, so desktop scrolling is untouched too.
           */
          className="relative h-[340px] touch-pan-y overflow-hidden bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:h-[400px]"
        >
          {!ready ? (
            <div className="absolute inset-0 grid place-items-center">
              <span className="text-[12px] font-semibold text-muted">
                جاري تجهيز المحرر…
              </span>
            </div>
          ) : (
            <div
              ref={paperRef}
              data-home-editor-paper=""
              className="absolute shadow-card"
              style={{
                left: paper.left,
                top: paper.top,
                width: paper.width,
                height: paper.height,
                // Keep the document's own z-order (and the interaction layer's
                // index below) inside the sheet.
                isolation: "isolate",
              }}
            >
              <TemplatePreview page={page!} className="h-full w-full" />

              {/*
               * Interaction layer — one hit box per visible element.
               *
               * The painted document stacks its own elements with the `z` they
               * carry in the model, so the layer that receives the pointer has
               * to sit above every one of them: without the explicit z-index a
               * click lands on the artwork (an `<img>`, a shape) and the hero
               * looks dead. `isolation` on the paper keeps this index local.
               */}
              <div className="absolute inset-0" style={{ zIndex: 9999 }}>
                {elements.map((el) => {
                  const isSelected = model.selectedId === el.id;
                  return (
                    <div
                      key={el.id}
                      role="button"
                      tabIndex={-1}
                      aria-label={`${TYPE_NAME[el.type] ?? "عنصر"}${el.name ? ` — ${el.name}` : ""}`}
                      aria-pressed={isSelected}
                      data-home-el={el.id}
                      data-el-type={el.type}
                      data-selected={isSelected ? "true" : "false"}
                      data-el-x={el.x.toFixed(2)}
                      data-el-y={el.y.toFixed(2)}
                      data-el-w={el.w.toFixed(2)}
                      data-el-h={el.h.toFixed(2)}
                      onPointerDown={(event) => onElementPointerDown(event, el)}
                      onDoubleClick={(event) => {
                        if (!isTextualElement(el)) return;
                        event.preventDefault();
                        dispatch({ type: "editText", id: el.id });
                      }}
                      className={cn(
                        "absolute",
                        el.locked ? "cursor-default" : "cursor-move",
                        isSelected
                          ? "outline outline-2 outline-offset-[1px] outline-[color:var(--color-brand)]"
                          : "hover:outline hover:outline-1 hover:outline-offset-[1px] hover:outline-[color:var(--color-brand)]/45",
                      )}
                      style={{
                        left: `${(el.x / size.w) * 100}%`,
                        top: `${(el.y / size.h) * 100}%`,
                        width: `${(el.w / size.w) * 100}%`,
                        height: `${(el.h / size.h) * 100}%`,
                        transform: el.rotation
                          ? `rotate(${el.rotation}deg)`
                          : undefined,
                        // Only the element the visitor has selected takes
                        // the touch stream; the rest let the page scroll.
                        touchAction: isSelected ? "none" : "pan-y",
                      }}
                    />
                  );
                })}

                {/* Resize handles for the selection */}
                {selected &&
                  !selected.locked &&
                  !selected.resizeLocked &&
                  !editing && (
                    <div
                      className="pointer-events-none absolute"
                      style={{
                        left: `${(selected.x / size.w) * 100}%`,
                        top: `${(selected.y / size.h) * 100}%`,
                        width: `${(selected.w / size.w) * 100}%`,
                        height: `${(selected.h / size.h) * 100}%`,
                        transform: selected.rotation
                          ? `rotate(${selected.rotation}deg)`
                          : undefined,
                      }}
                    >
                      {(["nw", "ne", "sw", "se"] as const).map((handle) => (
                        <button
                          key={handle}
                          type="button"
                          tabIndex={-1}
                          aria-label={`تغيير الحجم (${handle})`}
                          data-handle={handle}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            beginGesture(event, selected, "resize", handle);
                          }}
                          className="pointer-events-auto absolute size-3 rounded-[3px] border border-white bg-[color:var(--color-brand)] shadow-sm"
                          style={{
                            left: handle.includes("w") ? -6 : undefined,
                            right: handle.includes("e") ? -6 : undefined,
                            top: handle.includes("n") ? -6 : undefined,
                            bottom: handle.includes("s") ? -6 : undefined,
                            cursor: `${handle}-resize`,
                            touchAction: "none",
                          }}
                        />
                      ))}
                    </div>
                  )}

                {/* Inline text editing — writes straight into the element */}
                {editing && (
                  <textarea
                    autoFocus
                    ref={textRef}
                    data-home-editor-text=""
                    defaultValue={editing.content ?? ""}
                    onPointerDown={(event) => event.stopPropagation()}
                    onBlur={(event) => commitText(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Escape") {
                        event.preventDefault();
                        dispatch({ type: "editText", id: null });
                      } else if (
                        event.key === "Enter" &&
                        (event.metaKey || event.ctrlKey)
                      ) {
                        event.preventDefault();
                        commitText(event.currentTarget.value);
                      }
                    }}
                    className="absolute resize-none rounded-[3px] border-2 border-[color:var(--color-brand)] bg-white/95 p-1 text-ink shadow-card outline-none"
                    style={{
                      left: `${(editing.x / size.w) * 100}%`,
                      top: `${(editing.y / size.h) * 100}%`,
                      width: `${(editing.w / size.w) * 100}%`,
                      height: `${(editing.h / size.h) * 100}%`,
                      minHeight: 24,
                      direction: "rtl",
                      textAlign:
                        (editing.style
                          ?.textAlign as React.CSSProperties["textAlign"]) ??
                        "right",
                      fontSize: Math.max(
                        9,
                        (((Number(editing.style?.fontSize) || 14) * 25.4) /
                          72 /
                          size.w) *
                          (paper.width || 1),
                      ),
                      lineHeight: editing.style?.lineHeight || 1.45,
                      touchAction: "auto",
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Page navigation */}
        <div className="flex items-center gap-2 border-t border-line/60 bg-surface px-3 py-2">
          <button
            type="button"
            data-home-editor-prev=""
            aria-label="الصفحة السابقة"
            disabled={!ready || model.activeIndex <= 0}
            onClick={() =>
              run({ type: "goToPage", index: model.activeIndex - 1 })
            }
            className="grid size-7 place-items-center rounded-[7px] border border-line bg-surface text-ink transition hover:bg-surface-2 disabled:opacity-40"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {model.pages.map((item, index) => (
              <button
                key={item.id}
                type="button"
                data-home-editor-page={index}
                aria-current={index === model.activeIndex}
                aria-label={`الصفحة ${index + 1}`}
                onClick={() => run({ type: "goToPage", index })}
                className={cn(
                  "h-6 shrink-0 rounded-full border px-2.5 text-[11px] font-bold transition",
                  index === model.activeIndex
                    ? "border-inverse/10 bg-inverse text-on-inverse"
                    : "border-line bg-surface-2 text-muted hover:text-ink",
                )}
              >
                {index + 1}
              </button>
            ))}
          </div>
          <span
            className="shrink-0 text-[11px] font-semibold text-muted"
            data-home-editor-page-count={pageCount}
          >
            {ready ? `صفحة ${model.activeIndex + 1} من ${pageCount}` : "…"}
          </span>
          <button
            type="button"
            data-home-editor-next=""
            aria-label="الصفحة التالية"
            disabled={!ready || model.activeIndex >= pageCount - 1}
            onClick={() =>
              run({ type: "goToPage", index: model.activeIndex + 1 })
            }
            className="grid size-7 place-items-center rounded-[7px] border border-line bg-surface text-ink transition hover:bg-surface-2 disabled:opacity-40"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-6 text-muted">
        {featured
          ? `هذه المعاينة تفتح سجل «${title}» نفسه من كتالوج القوالب المنشور؛`
          : "هذه المعاينة تفتح مستند «تقرير رسمي» نفسه من قوالب نَسَق؛"}{" "}
        حرّك العناصر وغيّر أحجامها وحرّر نصوصها — التعديلات تبقى داخل هذه الجلسة
        ولا تُحفظ.
      </p>
    </div>
  );
}

function ToolButton({
  label,
  icon: Icon,
  action,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof Undo2;
  /** Stable hook for the homepage verification run (scripts/home-editor-check). */
  action: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      data-home-editor-action={action}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-[7px] border border-line bg-surface text-ink transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon className="size-[15px]" aria-hidden />
    </button>
  );
}
