/**
 * Pointer-based drag for library cards — enables Drag & Drop via touch/pen where
 * HTML5 DataTransfer is not available (iPad + Apple Pencil).
 *
 * Creates a floating ghost that follows the pointer and on release tries to
 * insert the payload at the drop point using the same anchoring logic as the
 * HTML5 path (insertLibraryDrop).
 */

import type { LibraryDropPayload } from "./library-dnd";
import { canvasDropPoint } from "./canvas-space";
import { isOverlayViewport } from "./ui-state";
import { useEditor } from "./store";

export function startPointerLibraryDrag(
  e: React.PointerEvent,
  payload: LibraryDropPayload,
  label: string,
) {
  // فقط للمس والقلم — الماوس يستخدم HTML5 drag الافتراضي
  if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
  // لا تبدأ إذا كان الضغط طويل جداً قد يكون Context Menu
  const startX = e.clientX;
  const startY = e.clientY;
  const pointerId = e.pointerId;
  const target = e.currentTarget as HTMLElement;

  let ghost: HTMLDivElement | null = null;
  let moved = false;
  let overlayPanel: { node: HTMLElement; pointerEvents: string } | null = null;

  const createGhost = () => {
    ghost = document.createElement("div");
    ghost.textContent = label || "عنصر";
    ghost.style.position = "fixed";
    ghost.style.left = `${startX + 12}px`;
    ghost.style.top = `${startY + 12}px`;
    ghost.style.zIndex = "var(--z-bubble)";
    ghost.style.pointerEvents = "none";
    ghost.style.padding = "6px 10px";
    ghost.style.borderRadius = "8px";
    ghost.style.background = "rgba(15,23,42,0.92)";
    ghost.style.color = "#fff";
    ghost.style.fontSize = "11px";
    ghost.style.fontWeight = "700";
    ghost.style.boxShadow = "0 8px 24px rgba(0,0,0,0.35)";
    ghost.style.transform = "translate(-50%, -50%)";
    ghost.style.opacity = "0.95";
    document.body.appendChild(ghost);
  };

  const moveGhost = (x: number, y: number) => {
    if (!ghost) return;
    ghost.style.left = `${x + 12}px`;
    ghost.style.top = `${y + 12}px`;
  };

  const cleanup = () => {
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
    if (overlayPanel) {
      overlayPanel.node.style.pointerEvents = overlayPanel.pointerEvents;
      overlayPanel = null;
    }
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    try {
      target.releasePointerCapture?.(pointerId);
    } catch {
      /* capture already released or target detached */
    }
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const dist = Math.hypot(dx, dy);
    if (dist > 8) {
      if (!moved && isOverlayViewport()) {
        const panel = target.closest<HTMLElement>(".editor-floating-panel");
        if (panel) {
          overlayPanel = { node: panel, pointerEvents: panel.style.pointerEvents };
          panel.style.pointerEvents = "none";
        }
      }
      moved = true;
      if (!ghost) createGhost();
      moveGhost(ev.clientX, ev.clientY);
      // منع التمرير الافتراضي أثناء السحب
      ev.preventDefault();
    }
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const drop = moved
      ? canvasDropPoint(
          document.querySelector<HTMLElement>(".editor-canvas-stage"),
          useEditor.getState().pages,
          ev.clientX,
          ev.clientY,
        )
      : null;
    cleanup();
    if (!moved) return;
    const stopClick = (click: MouseEvent) => {
      click.preventDefault();
      click.stopImmediatePropagation();
    };
    target.addEventListener("click", stopClick, { capture: true, once: true });
    window.setTimeout(
      () => target.removeEventListener("click", stopClick, true),
      500,
    );
    if (!drop) return;
    const store = useEditor.getState();
    store.insertLibraryElements(payload, drop, drop.pageId);
    // Keep the captured source mounted until the drop completes. Closing it
    // after insertion still reveals the canvas on an overlay viewport.
    if (isOverlayViewport()) useEditor.getState().closeFloatingPanels();
  };

  const onCancel = () => {
    cleanup();
  };

  try {
    target.setPointerCapture?.(pointerId);
  } catch {
    /* pointer already gone (detached target) — drag still works via window listeners */
  }
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
}
