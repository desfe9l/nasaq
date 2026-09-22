import { useEditor } from "@/lib/editor/store";
import type { AlignEdge } from "@/lib/editor/model";
import { Link, Unlink } from "lucide-react";

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
 * Arrangement bar for the current selection.
 */
export function ArrangeBar() {
  const count = useEditor((s) => s.selectedIds.length);
  const align = useEditor((s) => s.align);
  const distribute = useEditor((s) => s.distribute);
  const group = useEditor((s) => s.group);
  const ungroup = useEditor((s) => s.ungroup);
  const linkSelected = useEditor((s) => s.linkSelected);
  const unlinkSelected = useEditor((s) => s.unlinkSelected);
  const selectedId = useEditor((s) => s.selectedId);
  const groupsSelected = useEditor((s) => {
    const page = s.pages.find((p) => p.id === s.activePageId);
    const el = page?.elements.find((e) => e.id === s.selectedId);
    return el?.type === "group";
  });

  if (count < 1) return null;

  return (
    <div className="editor-arrange-bar arrange-bar" dir="rtl">
      <span className="arrange-count">{count === 1 ? "عنصر واحد" : `${count} عناصر`}</span>
      <span className="arrange-sep" />
      {ALIGN_BUTTONS.map((b) => (
        <button
          key={b.edge}
          type="button"
          className="arrange-btn"
          title={b.label}
          aria-label={b.label}
          onClick={() => align(b.edge, count === 1 ? "page" : "selection")}
        >
          <AlignIcon kind={b.icon} />
        </button>
      ))}
      {count > 1 && <span className="arrange-sep" />}
      {count > 1 && <button
        type="button"
        className="arrange-btn"
        title="توزيع أفقي متساوٍ"
        aria-label="توزيع أفقي متساوٍ"
        disabled={count < 3}
        onClick={() => distribute("h")}
      >
        <AlignIcon kind="dist-h" />
      </button>}
      {count > 1 && <button
        type="button"
        className="arrange-btn"
        title="توزيع رأسي متساوٍ"
        aria-label="توزيع رأسي متساوٍ"
        disabled={count < 3}
        onClick={() => distribute("v")}
      >
        <AlignIcon kind="dist-v" />
      </button>}
      {count > 1 && <span className="arrange-sep" />}
      {count > 1 && <button type="button" className="arrange-btn wide" title="تجميع (⌘G)" onClick={group}>
        تجميع
      </button>}
      {count > 1 && <button
        type="button"
        className="arrange-btn wide"
        title="فك التجميع (⇧⌘G)"
        disabled={!groupsSelected}
        onClick={ungroup}
      >
        فك التجميع
      </button>}
      {count > 1 && <button type="button" className="arrange-btn" title="ربط العناصر" aria-label="ربط العناصر" onClick={linkSelected}>
        <Link className="size-3.5" />
      </button>}
      {count > 1 && <button type="button" className="arrange-btn" title="فك ربط العناصر" aria-label="فك ربط العناصر" onClick={unlinkSelected}>
        <Unlink className="size-3.5" />
      </button>}
      {selectedId && <span className="sr-only">العنصر الأساسي محدد</span>}
    </div>
  );
}

/** Alignment glyphs shared with the toolbar's Alignment & Distribution menu. */
export function AlignIcon({ kind }: { kind: string }) {
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
