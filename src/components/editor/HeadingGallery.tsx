import type { CSSProperties, ReactNode } from "react";
import { GRAPHIC_HEADINGS, type GraphicHeadingId } from "@/lib/editor/graphic-headings";
import { THEMES } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { cn } from "@/lib/utils";

export const GRAPHIC_HEADING_MIME = "application/x-nasaq-graphic-heading";

/**
 * «العناوين الجرافيكية» — the visual heading gallery.
 *
 * Built to the same standard as the image-frame gallery this editor already
 * trusts: the PREVIEW is the label. Each tile draws the composition itself —
 * band, seal, image, rules, real Arabic sample type in the document's live
 * theme — not a paragraph describing it. One click inserts a real editable
 * group; drag drops it where the pointer says. After insertion everything the
 * heading is made of (text, shapes, the replaceable picture) stays ordinary
 * elements: replace, resize, rotate, undo — nothing special, nothing to break.
 */
export function HeadingGallery({
  onPick,
  disabled,
}: {
  onPick: (id: GraphicHeadingId) => void;
  disabled?: boolean;
}) {
  const themeId = useEditor((s) => s.theme);
  const theme = THEMES[themeId] ?? THEMES.official;
  return (
    <div className="heading-gallery grid grid-cols-2 gap-2" dir="rtl">
      {GRAPHIC_HEADINGS.map((h) => (
        <button
          key={h.id}
          type="button"
          draggable={!disabled}
          onDragStart={(e) => {
            e.dataTransfer.setData(GRAPHIC_HEADING_MIME, h.id);
            e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => !disabled && onPick(h.id)}
          disabled={disabled}
          title={`${h.label} — ${h.hint}`}
          aria-label={h.label}
          className={cn(
            "heading-tile group flex min-h-16 flex-col justify-between overflow-hidden rounded-[10px] border border-line bg-surface p-1.5 text-right transition",
            "hover:border-navy-2 hover:shadow-sm active:scale-[0.99]",
            disabled && "pointer-events-none opacity-45",
          )}
        >
          <span className="heading-tile-stage relative block h-[38px] w-full overflow-hidden rounded-[6px]">
            <HeadingPreview id={h.id} theme={theme} />
          </span>
          <span className="mt-1 block truncate text-[10px] font-extrabold leading-3.5 text-ink">
            {h.label}
          </span>
        </button>
      ))}
    </div>
  );
}

type PreviewTheme = (typeof THEMES)[keyof typeof THEMES];

/** The mini composition — one honest drawing per heading id. */
function HeadingPreview({ id, theme }: { id: GraphicHeadingId; theme: PreviewTheme }) {
  const paper = { background: "#ffffff" } as const;
  const band = (color: string) => ({ background: color }) as const;
  const gold = theme.accent;
  const deep = theme.primary;
  const ink = theme.ink;
  const soft = theme.muted;
  const line = theme.line;
  const sample = "عنوان التقرير";
  const text = (color: string, size = 9, weight = 800) => (
    <span
      className="block truncate font-extrabold leading-none"
      style={{ color, fontSize: size, fontWeight: weight }}
    >
      {sample}
    </span>
  );
  const image = (radius: number, size = "26px") => (
    <span
      className="block shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: `linear-gradient(135deg, ${line}, ${deep}33)`,
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,.06)",
      }}
      aria-hidden
    />
  );
  const row = (children: ReactNode, extra: CSSProperties = {}) => (
    <span
      className="absolute inset-0 flex items-center gap-1.5 px-1.5"
      style={extra}
    >
      {children}
    </span>
  );

  switch (id) {
    case "main":
      return (
        <span className="absolute inset-0 flex flex-col items-end justify-center gap-1 px-1.5" style={paper}>
          {text(deep, 11)}
          <span className="h-[2px] w-8 rounded" style={band(gold)} />
        </span>
      );
    case "section":
      return row(
        <>
          <span className="h-5 w-[3px] rounded" style={band(deep)} />
          {text(ink)}
        </>,
        { ...paper, justifyContent: "flex-end" },
      );
    case "sub":
      return row(
        <>
          <span className="h-1.5 w-1.5 rounded-full" style={band(gold)} />
          {text(ink, 8, 700)}
        </>,
        { ...paper, justifyContent: "flex-end" },
      );
    case "bar":
      return (
        <span className="absolute inset-0 flex items-center justify-end rounded-[5px] px-2" style={band(deep)}>
          <span className="block truncate text-[9px] font-extrabold leading-none text-white">{sample}</span>
        </span>
      );
    case "card":
      return (
        <span
          className="absolute inset-0.5 flex items-center justify-end gap-1.5 rounded-[5px] border bg-white px-2 shadow-sm"
          style={{ borderColor: line }}
        >
          {text(ink)}
          <span className="h-5 w-[3px] rounded" style={band(gold)} />
        </span>
      );
    case "numbered":
      return row(
        <>
          <span
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[8px] font-black text-white"
            style={band(deep)}
          >
            ١
          </span>
          {text(ink)}
        </>,
        { ...paper, justifyContent: "flex-end" },
      );
    case "separator":
      return (
        <span className="absolute inset-0 flex items-center gap-1 px-1" style={paper}>
          <span className="h-px flex-1" style={{ background: line }} />
          <span className="h-1 w-1 rounded-full" style={band(gold)} />
          {text(ink, 8)}
        </span>
      );
    case "institutional":
      return (
        <span
          className="absolute inset-0.5 flex items-center justify-center rounded-[3px] border-t-2 bg-white px-1"
          style={{ borderColor: line, borderTopColor: deep }}
        >
          <span className="block truncate text-[9px] font-black" style={{ color: deep, fontFamily: "Amiri, serif" }}>
            {sample}
          </span>
        </span>
      );
    case "modern":
      return (
        <span
          className="absolute inset-0 flex items-center justify-end gap-1.5 overflow-hidden rounded-[5px] border"
          style={{ borderColor: line, background: theme.surface }}
        >
          {text(ink)}
          <span className="h-full w-6" style={band(deep)} />
        </span>
      );
    case "simple":
      return row(<>{text(ink, 9, 700)}</>, { ...paper, justifyContent: "flex-end" });
    case "coverBand":
      return (
        <span className="absolute inset-0 flex items-center gap-1.5 rounded-[5px] px-1.5" style={band(deep)}>
          {image(4, "22px")}
          <span className="flex min-w-0 flex-1 flex-col items-end gap-0.5">
            <span className="block w-full truncate text-right text-[9px] font-black leading-none text-white">{sample}</span>
            <span className="block h-[1px] w-8" style={{ background: "rgba(255,255,255,.55)" }} />
          </span>
          <span className="h-6 w-[2px] rounded" style={band(gold)} />
        </span>
      );
    case "sealTitle":
      return (
        <span className="absolute inset-0 flex items-center justify-end gap-1.5 px-1" style={paper}>
          <span className="flex min-w-0 flex-col items-end gap-0.5">
            <span className="block w-full truncate text-right text-[9px] font-black leading-none" style={{ color: deep }}>
              {sample}
            </span>
            <span className="block w-full truncate text-right text-[6px] font-bold leading-none" style={{ color: soft }}>
              التقرير السنوي
            </span>
          </span>
          {image(999, "20px")}
        </span>
      );
    case "sideImage":
      return (
        <span
          className="absolute inset-0 flex items-center justify-end gap-1.5 rounded-[5px] border bg-white px-1"
          style={{ borderColor: line }}
        >
          {text(ink, 9)}
          <span className="h-5 w-[2px] rounded" style={band(gold)} />
          {image(4, "20px")}
        </span>
      );
    default:
      return row(<>{text(ink)}</>, paper);
  }
}
