/**
 * Pointer-based drag for library cards — enables Drag & Drop via touch/pen where
 * HTML5 DataTransfer is not available (iPad + Apple Pencil).
 *
 * Creates a floating ghost that follows the pointer and on release tries to
 * insert the payload at the drop point using the same anchoring logic as the
 * HTML5 path (insertLibraryDrop).
 */

import { insertLibraryDrop, type LibraryDropPayload } from "./library-dnd";
import { pageSize } from "./model";
import type { ElType, CanvasEl } from "./model";
import { useEditor } from "./store";

type DropResolver = (
  type: string,
  over: Record<string, unknown>,
  center?: { x: number; y: number },
) => { x: number; y: number; w: number; h: number } | undefined;

function findPageElementAt(clientX: number, clientY: number): HTMLElement | null {
  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  return el?.closest<HTMLElement>("[data-page-id]") || null;
}

function computeDropPoint(
  clientX: number,
  clientY: number,
): { x: number; y: number; pageId: string } | null {
  const pages = useEditor.getState().pages;
  const activePageId = useEditor.getState().activePageId;
  // أولاً: هل نحن فوق صفحة مباشرة؟
  const direct = findPageElementAt(clientX, clientY);
  if (direct) {
    const pageId = direct.dataset.pageId!;
    const page = pages.find((p) => p.id === pageId);
    if (!page) return null;
    const size = pageSize(page);
    const rect = direct.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * size.w;
    const y = ((clientY - rect.top) / rect.height) * size.h;
    return { pageId, x, y };
  }
  // ثانياً: أقرب صفحة — لا نلغي السحب بسبب حدود الـArtboard
  let closest: { page: typeof pages[0]; rect: DOMRect; dist: number } | null = null;
  for (const page of pages) {
    const el = document.querySelector<HTMLElement>(`[data-page-id="${CSS.escape(page.id)}"]`);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(clientX - cx, clientY - cy);
    if (!closest || dist < closest.dist) {
      closest = { page, rect, dist };
    }
  }
  if (closest) {
    const size = pageSize(closest.page);
    const clampedX = Math.max(
      closest.rect.left,
      Math.min(clientX, closest.rect.right),
    );
    const clampedY = Math.max(
      closest.rect.top,
      Math.min(clientY, closest.rect.bottom),
    );
    const x = ((clampedX - closest.rect.left) / closest.rect.width) * size.w;
    const y = ((clampedY - closest.rect.top) / closest.rect.height) * size.h;
    return { pageId: closest.page.id, x, y };
  }
  const active = pages.find((p) => p.id === activePageId) || pages[0];
  if (!active) return null;
  const ref = document.querySelector<HTMLElement>(`[data-page-id="${CSS.escape(active.id)}"]`);
  if (!ref) return null;
  const size = pageSize(active);
  const rect = ref.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * size.w;
  const y = ((clientY - rect.top) / rect.height) * size.h;
  return { pageId: active.id, x, y };
}

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
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;

  const createGhost = () => {
    ghost = document.createElement("div");
    ghost.textContent = label || "عنصر";
    ghost.style.position = "fixed";
    ghost.style.left = `${startX + 12}px`;
    ghost.style.top = `${startY + 12}px`;
    ghost.style.zIndex = "9999";
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
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    try {
      target.releasePointerCapture?.(pointerId);
    } catch {}
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const dist = Math.hypot(dx, dy);
    if (dist > 8) {
      moved = true;
      if (!ghost) createGhost();
      moveGhost(ev.clientX, ev.clientY);
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = undefined;
      }
      // منع التمرير الافتراضي أثناء السحب
      ev.preventDefault();
    }
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    cleanup();
    if (!moved) return;
    const drop = computeDropPoint(ev.clientX, ev.clientY);
    const store = useEditor.getState();
    if (drop) store.setActivePage(drop.pageId);
    const resolver: DropResolver = (type, over, center) => {
      const el = store.addElementAt(
        type as ElType,
        over as Partial<CanvasEl>,
        center,
      );
      return el ? { x: el.x, y: el.y, w: el.w, h: el.h } : undefined;
    };
    insertLibraryDrop(payload, drop ? { x: drop.x, y: drop.y } : null, resolver);
  };

  const onCancel = () => {
    cleanup();
  };

  try {
    target.setPointerCapture?.(pointerId);
  } catch {}
  // تأخير بسيط لتجنب التعارض مع tap
  longPressTimer = setTimeout(() => {
    // إذا لم يتحرك بعد 500ms، لا نبدأ سحب — قد يكون ضغط مطوّل للقائمة
  }, 500);

  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
}
