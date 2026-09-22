import { useState } from "react";
import { useEditor } from "@/lib/editor/store";
import type { AlignEdge } from "@/lib/editor/model";
import { Link, Unlink, ChevronDown, AlignLeft, AlignCenter, AlignRight, ArrowUp, ArrowDown, LayoutGrid } from "lucide-react";

/** Align/distribute/group controls for the current selection. */
const ALIGN_BUTTONS: { edge: AlignEdge; label: string; icon: string }[] = [
  { edge: "right", label: "محاذاة لليمين", icon: "right" },
  { edge: "center", label: "توسيط أفقي", icon: "center-h" },
  { edge: "left", label: "محاذاة لليسار", icon: "left" },
  { edge: "top", label: "محاذاة للأعلى", icon: "top" },
  { edge: "middle", label: "توسيط رأسي", icon: "center-v" },
  { edge: "bottom", label: "محاذاة للأسفل", icon: "bottom" },
];

/**
 * Arrangement bar — now a clear Alignment & Distribution control.
 * Larger hit area (44px touch), recognizable icon, readable tooltip, clear active state.
 * Groups related controls into dropdowns per PART 18, but keeps daily actions inline.
 */
export function ArrangeBar() {
  const count = useEditor((s) => s.selectedIds.length);
  const align = useEditor((s) => s.align);
  const distribute = useEditor((s) => s.distribute);
  const group = useEditor((s) => s.group);
  const ungroup = useEditor((s) => s.ungroup);
  const linkSelected = useEditor((s) => s.linkSelected);
  const unlinkSelected = useEditor((s) => s.unlinkSelected);
  const makeSameSize = useEditor((s) => s.makeSameSize);
  const bring = useEditor((s) => s.bring);
  const selectedId = useEditor((s) => s.selectedId);
  const groupsSelected = useEditor((s) => {
    const page = s.pages.find((p) => p.id === s.activePageId);
    const el = page?.elements.find((e) => e.id === s.selectedId);
    return el?.type === "group";
  });
  const [alignOpen, setAlignOpen] = useState(false);
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [frame, setFrame] = useState<"selection" | "page">("selection");

  if (count < 1) return null;

  return (
    <div className="editor-arrange-bar arrange-bar" dir="rtl" title="Alignment & Distribution">
      <span className="arrange-count">{count === 1 ? "عنصر واحد" : `${count} عناصر`}</span>
      <span className="arrange-sep" />
      {/* Primary alignment — always visible for daily use */}
      {ALIGN_BUTTONS.slice(0, 3).map((b) => (
        <button
          key={b.edge}
          type="button"
          className="arrange-btn"
          title={b.label}
          aria-label={b.label}
          onClick={() => align(b.edge, frame)}
        >
          <AlignIcon kind={b.icon} />
        </button>
      ))}
      {/* Dropdown: full Alignment & Distribution */}
      <div className="relative">
        <button
          type="button"
          className="arrange-btn wide"
          title="Alignment & Distribution — محاذاة وتوزيع"
          aria-label="Alignment & Distribution"
          aria-expanded={alignOpen}
          onClick={() => setAlignOpen((v) => !v)}
        >
          <LayoutGrid className="size-4" />
          <span className="hidden sm:inline">محاذاة وتوزيع</span>
          <ChevronDown className="size-3" />
        </button>
        {alignOpen && (
          <div className="absolute bottom-[calc(100%+8px)] left-1/2 z-30 w-[320px] -translate-x-1/2 rounded-[10px] border bg-white p-3 shadow-xl dark:bg-[#1e2635] dark:border-white/10">
            <div className="mb-2 flex items-center justify-between">
              <strong className="text-[11px]">محاذاة وتوزيع</strong>
              <div className="flex gap-1">
                <button type="button" onClick={() => setFrame("selection")} className={`h-7 rounded px-2 text-[10px] font-bold ${frame === "selection" ? "bg-navy text-white" : "border border-line dark:border-white/10"}`}>للتحديد</button>
                <button type="button" onClick={() => setFrame("page")} className={`h-7 rounded px-2 text-[10px] font-bold ${frame === "page" ? "bg-navy text-white" : "border border-line dark:border-white/10"}`}>للصفحة</button>
              </div>
            </div>
            <p className="mb-2 text-[10px] text-muted">أفقي</p>
            <div className="grid grid-cols-3 gap-1.5">
              {ALIGN_BUTTONS.filter((b) => ["right","center","left"].includes(b.edge)).map((b) => (
                <button key={b.edge} type="button" onClick={() => { align(b.edge, frame); }} className="flex h-9 items-center justify-center gap-1 rounded-[8px] border border-line text-[11px] font-bold dark:border-white/10">
                  <AlignIcon kind={b.icon} /> {b.label}
                </button>
              ))}
            </div>
            <p className="mt-3 mb-2 text-[10px] text-muted">رأسي</p>
            <div className="grid grid-cols-3 gap-1.5">
              {ALIGN_BUTTONS.filter((b) => ["top","middle","bottom"].includes(b.edge)).map((b) => (
                <button key={b.edge} type="button" onClick={() => { align(b.edge, frame); }} className="flex h-9 items-center justify-center gap-1 rounded-[8px] border border-line text-[11px] font-bold dark:border-white/10">
                  <AlignIcon kind={b.icon} /> {b.label}
                </button>
              ))}
            </div>
            <p className="mt-3 mb-2 text-[10px] text-muted">توزيع</p>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" disabled={count < 3} onClick={() => distribute("h")} className="h-9 rounded-[8px] border border-line text-[11px] font-bold disabled:opacity-40 dark:border-white/10">توزيع أفقي</button>
              <button type="button" disabled={count < 3} onClick={() => distribute("v")} className="h-9 rounded-[8px] border border-line text-[11px] font-bold disabled:opacity-40 dark:border-white/10">توزيع رأسي</button>
              <button type="button" disabled={count < 3} onClick={() => distribute("h")} className="h-9 rounded-[8px] border border-line text-[10px] font-bold disabled:opacity-40 dark:border-white/10">مسافات أفقية متساوية</button>
              <button type="button" disabled={count < 3} onClick={() => distribute("v")} className="h-9 rounded-[8px] border border-line text-[10px] font-bold disabled:opacity-40 dark:border-white/10">مسافات رأسية متساوية</button>
            </div>
            <p className="mt-3 mb-2 text-[10px] text-muted">نفس الحجم</p>
            <div className="grid grid-cols-3 gap-1.5">
              <button type="button" disabled={count < 2} onClick={() => makeSameSize("w")} className="h-9 rounded-[8px] border border-line text-[10px] font-bold disabled:opacity-40 dark:border-white/10">نفس العرض</button>
              <button type="button" disabled={count < 2} onClick={() => makeSameSize("h")} className="h-9 rounded-[8px] border border-line text-[10px] font-bold disabled:opacity-40 dark:border-white/10">نفس الارتفاع</button>
              <button type="button" disabled={count < 2} onClick={() => makeSameSize("both")} className="h-9 rounded-[8px] border border-line text-[10px] font-bold disabled:opacity-40 dark:border-white/10">نفس الحجم</button>
            </div>
            <button type="button" onClick={() => setAlignOpen(false)} className="mt-3 h-8 w-full rounded-[6px] border border-line text-[11px] dark:border-white/10">إغلاق</button>
          </div>
        )}
      </div>
      <span className="arrange-sep" />
      {/* Vertical quick */}
      {ALIGN_BUTTONS.slice(3, 6).map((b) => (
        <button
          key={b.edge}
          type="button"
          className="arrange-btn"
          title={b.label}
          aria-label={b.label}
          onClick={() => align(b.edge, frame)}
        >
          <AlignIcon kind={b.icon} />
        </button>
      ))}
      {count > 1 && <span className="arrange-sep" />}
      {/* Distribute quick */}
      {count > 1 && <button type="button" className="arrange-btn" title="توزيع أفقي متساوٍ" aria-label="توزيع أفقي متساوٍ" disabled={count < 3} onClick={() => distribute("h")}><AlignIcon kind="dist-h" /></button>}
      {count > 1 && <button type="button" className="arrange-btn" title="توزيع رأسي متساوٍ" aria-label="توزيع رأسي متساوٍ" disabled={count < 3} onClick={() => distribute("v")}><AlignIcon kind="dist-v" /></button>}
      {count > 1 && <span className="arrange-sep" />}
      {/* Arrange dropdown */}
      <div className="relative">
        <button type="button" className="arrange-btn wide" title="ترتيب الطبقات" aria-expanded={arrangeOpen} onClick={() => setArrangeOpen((v) => !v)}>
          ترتيب
          <ChevronDown className="size-3" />
        </button>
        {arrangeOpen && (
          <div className="absolute bottom-[calc(100%+8px)] left-1/2 z-30 w-[220px] -translate-x-1/2 rounded-[10px] border bg-white p-2 shadow-xl dark:bg-[#1e2635] dark:border-white/10">
            <button type="button" onClick={() => { bring("front"); setArrangeOpen(false); }} className="flex h-9 w-full items-center gap-2 rounded px-2 text-[11px] font-bold hover:bg-line-2 dark:hover:bg-white/5"><ArrowUp className="size-3.5" /> إحضار للمقدمة</button>
            <button type="button" onClick={() => { bring("forward"); setArrangeOpen(false); }} className="flex h-9 w-full items-center gap-2 rounded px-2 text-[11px] font-bold hover:bg-line-2 dark:hover:bg-white/5"><ArrowUp className="size-3.5" /> تقديم</button>
            <button type="button" onClick={() => { bring("back"); setArrangeOpen(false); }} className="flex h-9 w-full items-center gap-2 rounded px-2 text-[11px] font-bold hover:bg-line-2 dark:hover:bg-white/5"><ArrowDown className="size-3.5" /> تأخير</button>
            <button type="button" onClick={() => { bring("bottom"); setArrangeOpen(false); }} className="flex h-9 w-full items-center gap-2 rounded px-2 text-[11px] font-bold hover:bg-line-2 dark:hover:bg-white/5"><ArrowDown className="size-3.5" /> إرسال للخلفية</button>
            <button type="button" onClick={() => setArrangeOpen(false)} className="mt-1 h-8 w-full rounded-[6px] border border-line text-[11px] dark:border-white/10">إغلاق</button>
          </div>
        )}
      </div>
      {count > 1 && <button type="button" className="arrange-btn wide" title="تجميع (⌘G)" onClick={group}>تجميع</button>}
      {count > 1 && <button type="button" className="arrange-btn wide" title="فك التجميع (⇧⌘G)" disabled={!groupsSelected} onClick={ungroup}>فك التجميع</button>}
      {count > 1 && <button type="button" className="arrange-btn" title="ربط العناصر" aria-label="ربط العناصر" onClick={linkSelected}><Link className="size-3.5" /></button>}
      {count > 1 && <button type="button" className="arrange-btn" title="فك ربط العناصر" aria-label="فك ربط العناصر" onClick={unlinkSelected}><Unlink className="size-3.5" /></button>}
      {selectedId && <span className="sr-only">العنصر الأساسي محدد</span>}
    </div>
  );
}

function AlignIcon({ kind }: { kind: string }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.3,
    strokeLinecap: "round" as const,
  };
  const bars = (a: React.ReactNode) => (
    <svg {...common} aria-hidden>
      {a}
    </svg>
  );
  switch (kind) {
    case "right":
      return bars(
        <>
          <path d="M14 2v12" />
          <rect x="3" y="3" width="8" height="3.4" />
          <rect x="5" y="9.6" width="6" height="3.4" />
        </>,
      );
    case "left":
      return bars(
        <>
          <path d="M2 2v12" />
          <rect x="5" y="3" width="8" height="3.4" />
          <rect x="5" y="9.6" width="6" height="3.4" />
        </>,
      );
    case "center-h":
      return bars(
        <>
          <path d="M8 2v12" />
          <rect x="3" y="3" width="10" height="3.4" />
          <rect x="4.5" y="9.6" width="7" height="3.4" />
        </>,
      );
    case "top":
      return bars(
        <>
          <path d="M2 2h12" />
          <rect x="3" y="5" width="3.4" height="8" />
          <rect x="9.6" y="5" width="3.4" height="6" />
        </>,
      );
    case "bottom":
      return bars(
        <>
          <path d="M2 14h12" />
          <rect x="3" y="3" width="3.4" height="8" />
          <rect x="9.6" y="5" width="3.4" height="6" />
        </>,
      );
    case "center-v":
      return bars(
        <>
          <path d="M2 8h12" />
          <rect x="3" y="3" width="3.4" height="10" />
          <rect x="9.6" y="4.5" width="3.4" height="7" />
        </>,
      );
    case "dist-h":
      return bars(
        <>
          <path d="M2 2v12M14 2v12" />
          <rect x="6.5" y="4" width="3" height="8" />
        </>,
      );
    case "dist-v":
      return bars(
        <>
          <path d="M2 2h12M2 14h12" />
          <rect x="4" y="6.5" width="8" height="3" />
        </>,
      );
    default:
      return null;
  }
}
