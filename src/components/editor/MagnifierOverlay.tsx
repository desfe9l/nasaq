import { useCallback, useEffect, useRef, useState } from "react";
import { Grip, Move, Search, X } from "lucide-react";
import { useEditor } from "@/lib/editor/store";

interface Box { left: number; top: number; width: number; height: number }
interface Point { x: number; y: number }

/**
 * A non-destructive artboard magnifier. It reuses the already-rendered page
 * subtree rather than creating a second document renderer: the selected page
 * is cloned as a visual snapshot and scaled inside a pointer-transparent lens.
 * Pointer selection, moving and resizing all share Pointer Events, so mouse,
 * Pencil and touch use exactly the same path.
 */
export function MagnifierOverlay({ active, onClose }: { active: boolean; onClose: () => void }) {
  const activePageId = useEditor((s) => s.activePageId);
  const pageVersion = useEditor((s) => s.pages.find((p) => p.id === s.activePageId));
  const [source, setSource] = useState<Box | null>(null);
  const [lens, setLens] = useState<Box>({ left: 72, top: 92, width: 360, height: 260 });
  const [dragBox, setDragBox] = useState<Box | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ mode: "select" | "move" | "resize"; id: number; start: Point; origin: Box } | null>(null);

  const renderSnapshot = useCallback(() => {
    if (!source || !contentRef.current) return;
    const page = document.querySelector<HTMLElement>(`.editor-canvas-stage [data-page-id="${CSS.escape(activePageId)}"]`);
    if (!page) return;
    const pageRect = page.getBoundingClientRect();
    const clone = page.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    Object.assign(clone.style, {
      position: "absolute",
      margin: "0",
      left: "0",
      top: "0",
      width: `${pageRect.width}px`,
      height: `${pageRect.height}px`,
      transformOrigin: "0 0",
      transform: `scale(2) translate(${-source.left}px, ${-source.top}px)`, 
      pointerEvents: "none",
    });
    contentRef.current.replaceChildren(clone);
  }, [activePageId, source]);

  useEffect(() => { renderSnapshot(); }, [renderSnapshot, pageVersion]);
  useEffect(() => {
    if (!active) { setSource(null); setDragBox(null); }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const stage = document.querySelector<HTMLElement>(".editor-canvas-stage");
    if (!stage) return;
    const down = (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest("[data-magnifier-ui]")) return;
      const page = (event.target as HTMLElement).closest<HTMLElement>("[data-page-id]");
      if (!page) return;
      event.preventDefault();
      event.stopPropagation();
      const r = page.getBoundingClientRect();
      const start = { x: Math.max(0, event.clientX - r.left), y: Math.max(0, event.clientY - r.top) };
      gesture.current = { mode: "select", id: event.pointerId, start, origin: { left: r.left, top: r.top, width: r.width, height: r.height } };
      setDragBox({ left: event.clientX, top: event.clientY, width: 1, height: 1 });
    };
    const move = (event: PointerEvent) => {
      const g = gesture.current;
      if (!g || g.mode !== "select" || g.id !== event.pointerId) return;
      const x = Math.max(g.origin.left, Math.min(event.clientX, g.origin.left + g.origin.width));
      const y = Math.max(g.origin.top, Math.min(event.clientY, g.origin.top + g.origin.height));
      setDragBox({ left: Math.min(g.origin.left + g.start.x, x), top: Math.min(g.origin.top + g.start.y, y), width: Math.abs(x - (g.origin.left + g.start.x)), height: Math.abs(y - (g.origin.top + g.start.y)) });
    };
    const up = (event: PointerEvent) => {
      const g = gesture.current;
      if (!g || g.mode !== "select" || g.id !== event.pointerId) return;
      const x = Math.max(0, Math.min(event.clientX - g.origin.left, g.origin.width));
      const y = Math.max(0, Math.min(event.clientY - g.origin.top, g.origin.height));
      const box = { left: Math.min(g.start.x, x), top: Math.min(g.start.y, y), width: Math.max(40, Math.abs(x - g.start.x)), height: Math.max(30, Math.abs(y - g.start.y)) };
      setSource(box);
      setLens((old) => ({ ...old, width: Math.min(520, Math.max(240, box.width * 2)), height: Math.min(400, Math.max(180, box.height * 2)) }));
      setDragBox(null);
      gesture.current = null;
    };
    stage.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => { stage.removeEventListener("pointerdown", down, true); window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); window.removeEventListener("pointercancel", up, true); };
  }, [active]);

  const beginLens = (mode: "move" | "resize") => (event: React.PointerEvent) => {
    event.preventDefault(); event.stopPropagation();
    gesture.current = { mode, id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: lens };
    const move = (ev: PointerEvent) => {
      const g = gesture.current; if (!g || g.id !== ev.pointerId || g.mode === "select") return;
      const dx = ev.clientX - g.start.x, dy = ev.clientY - g.start.y;
      setLens(g.mode === "move"
        ? { ...g.origin, left: Math.max(8, Math.min(innerWidth - g.origin.width - 8, g.origin.left + dx)), top: Math.max(8, Math.min(innerHeight - g.origin.height - 8, g.origin.top + dy)) }
        : { ...g.origin, width: Math.max(220, Math.min(innerWidth - g.origin.left - 8, g.origin.width + dx)), height: Math.max(160, Math.min(innerHeight - g.origin.top - 8, g.origin.height + dy)) });
    };
    const end = () => { gesture.current = null; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
  };

  if (!active) return null;
  return <>
    {!source && <div data-magnifier-ui className="magnifier-instruction" dir="rtl"><Search className="size-4" /> اسحب فوق أي جزء من الصفحة لتكبيره <button onClick={onClose} aria-label="إغلاق المكبرة"><X className="size-4" /></button></div>}
    {dragBox && <div className="magnifier-selection" style={dragBox} />}
    {source && <section data-magnifier-ui className="magnifier-window" style={lens} aria-label="منظر مكبر" dir="rtl">
      <header onPointerDown={beginLens("move")}><Move className="size-4" /><span>مكبرة ×2</span><button onPointerDown={(e) => e.stopPropagation()} onClick={onClose} title="إغلاق المكبرة" aria-label="إغلاق المكبرة"><X className="size-4" /></button></header>
      <div ref={contentRef} className="magnifier-content" aria-hidden />
      <button className="magnifier-resize" onPointerDown={beginLens("resize")} title="اسحب لتغيير الحجم" aria-label="تغيير حجم المكبرة"><Grip className="size-4" /></button>
    </section>}
  </>;
}
