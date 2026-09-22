/*
 * Real template previews.
 *
 * Every preview is painted from the template's OWN `Page` — the same objects
 * the editor loads and the exporters write — so a card shows the document that
 * will actually be created: real titles, real columns, real accent bars, real
 * table grids, real logos. Nothing here is a grey placeholder box.
 *
 * How the scaling works: the paper element is a container-query container
 * (`container-type: inline-size`), and every measurement is converted from the
 * document's own units into `cqw` (percent of the paper's width). One CSS rule
 * therefore renders the same page correctly at 180px (catalog card) and at
 * 900px (quick view), with no JavaScript measurement and no re-layout on
 * resize:
 *
 *   • mm  → cqw   `value / pageWidthMm * 100`
 *   • pt  → cqw   `value * 25.4/72 / pageWidthMm * 100`
 *
 * Text is resolved through the editor's own `prepareText` (Arabic normalisation,
 * numeral style, auto-fit) and boxes/lines/tables mirror the canvas styling in
 * `ElementNode`, so the preview and the artboard agree.
 */

import { ICONS, cssFont, pageSize, parseTable, type CanvasEl, type Page } from "@/lib/editor/model";
import { applyNumerals } from "@/lib/editor/arabic";
import { safeImageSrc } from "@/lib/editor/images";
import { prepareText, textPadding } from "@/lib/editor/text-render";
import { applySvgColors, sanitizeSvgContent } from "@/lib/editor/svg";
import { cn } from "@/lib/utils";

/** Millimetres per point — the document model stores type sizes in pt. */
const MM_PER_PT = 25.4 / 72;

interface Scale {
  /** Page width in mm — the reference every other measurement is relative to. */
  pw: number;
  /** Page height in mm. */
  ph: number;
}

/** A length in mm as a share of the page width. */
function mm(value: number, s: Scale): string {
  return `${((Number(value) || 0) / s.pw) * 100}cqw`;
}

/** A type size in pt as a share of the page width. */
function pt(value: number, s: Scale): string {
  return `${(((Number(value) || 0) * MM_PER_PT) / s.pw) * 100}cqw`;
}

/** A coordinate as a share of its own axis. */
function pc(value: number, total: number): string {
  return `${((Number(value) || 0) / (total || 1)) * 100}%`;
}

export interface TemplatePreviewProps {
  page: Page;
  className?: string;
  /** Extra classes for the paper itself (the zoom/transition layer). */
  paperClassName?: string;
}

/**
 * One page, painted at whatever size the surrounding box gives it.
 *
 * The wrapper keeps the document's exact aspect ratio, so a slide template
 * (338.7 × 190.5mm) previews as a slide and an A4 page previews as A4.
 */
export function TemplatePreview({ page, className, paperClassName }: TemplatePreviewProps) {
  const size = pageSize(page);
  const scale: Scale = { pw: size.w, ph: size.h };
  const elements = [...(page.elements ?? [])]
    .filter((el) => !el.hidden)
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

  return (
    <div
      className={cn("tpl-paper relative overflow-hidden bg-white", className)}
      style={{
        aspectRatio: `${size.w} / ${size.h}`,
        containerType: "inline-size",
        background: page.bg || "#fff",
        direction: "rtl",
      }}
    >
      <div className={cn("absolute inset-0", paperClassName)}>
        {elements.map((el) => (
          <PreviewElement key={el.id} el={el} scale={scale} />
        ))}
      </div>
    </div>
  );
}

/**
 * A multi-page preview: the active page on top, with the next pages peeking out
 * behind it. Used by pack cards so "6 صفحات" is visible, not just written.
 */
export function TemplateStackPreview({
  pages,
  index = 0,
  className,
  paperClassName,
  style,
}: {
  pages: Page[];
  index?: number;
  className?: string;
  paperClassName?: string;
  /**
   * Box sizing for the stack. The caller owns ONE definite dimension — the
   * height for a portrait sheet, the width for a landscape one — and the page's
   * own aspect ratio supplies the other, so a card of any width previews
   * correctly with no measurement.
   */
  style?: React.CSSProperties;
}) {
  const behind = Math.min(2, Math.max(0, pages.length - index - 1));
  return (
    <div className={cn("relative", className)} style={style}>
      {Array.from({ length: behind }, (_, i) => {
        const depth = i + 1;
        return (
          <div
            key={depth}
            aria-hidden
            className="absolute inset-0 rounded-[3px] border border-line/70 bg-white dark:border-white/10"
            style={{ transform: `translate(${depth * 3}%, ${depth * 2.2}%) scale(${1 - depth * 0.045})` }}
          />
        );
      })}
      <div className="relative h-full w-full">
        <TemplatePreview
          page={pages[index]}
          className={cn("h-full w-full", paperClassName)}
        />
      </div>
    </div>
  );
}

function PreviewElement({ el, scale }: { el: CanvasEl; scale: Scale }) {
  const s = el.style || {};
  const box: React.CSSProperties = {
    position: "absolute",
    left: pc(el.x, scale.pw),
    top: pc(el.y, scale.ph),
    width: pc(el.w, scale.pw),
    height: pc(el.h, scale.ph),
    opacity: el.opacity ?? 1,
    zIndex: el.z ?? 0,
    transform: `rotate(${el.rotation || 0}deg)${s.flipX ? " scaleX(-1)" : ""}${s.flipY ? " scaleY(-1)" : ""}`,
    overflow: s.overflowVisible ? "visible" : "hidden",
  };

  if (el.type === "group") {
    return (
      <div style={box}>
        {(el.children ?? [])
          .filter((child) => !child.hidden)
          .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
          .map((child) => (
            <PreviewElement key={child.id} el={child} scale={scale} />
          ))}
      </div>
    );
  }

  const text = prepareText(el);
  const pad = textPadding(el);
  const textCss: React.CSSProperties = {
    fontFamily: cssFont(s.fontFamily),
    fontSize: pt(text.fontSize, scale),
    fontWeight: (s.fontWeight as React.CSSProperties["fontWeight"]) || 600,
    fontStyle: (s.fontStyle as React.CSSProperties["fontStyle"]) || "normal",
    color: s.color || "#172033",
    textAlign: (s.textAlign as React.CSSProperties["textAlign"]) || "right",
    lineHeight: s.lineHeight || 1.45,
    whiteSpace: "pre-wrap",
    direction: "rtl",
    textDecoration: s.underline ? "underline" : undefined,
  };
  const fill = s.fill || s.background;
  const border =
    Number(s.borderWidth) > 0
      ? `${mm(Number(s.borderWidth), scale)} solid ${s.borderColor || "#d9dee8"}`
      : undefined;

  if (el.type === "text") {
    return (
      <div style={{ ...box, ...textCss, padding: pad ? mm(pad, scale) : undefined }}>
        {text.text}
      </div>
    );
  }

  if (el.type === "box" || el.type === "stat") {
    return (
      <div
        style={{
          ...box,
          ...textCss,
          background: fill || "#f7f8fb",
          border,
          borderRadius: s.radius ? mm(s.radius, scale) : undefined,
          padding: mm(pad, scale),
          display: "flex",
          alignItems: el.type === "stat" ? "center" : "flex-start",
          justifyContent:
            s.textAlign === "center" ? "center" : s.textAlign === "left" ? "flex-end" : "flex-start",
        }}
      >
        {text.text}
      </div>
    );
  }

  if (el.type === "progress") {
    const value = Math.max(0, Math.min(100, Number(s.value) || 0));
    const shown = `${applyNumerals(String(value), s.numerals)}%`;
    const variant = s.variant || "bar";
    const container: React.CSSProperties = {
      ...box,
      ...textCss,
      display: "flex",
      flexDirection: "column",
      justifyContent: variant === "ring" ? "center" : "center",
      alignItems: variant === "ring" ? "center" : undefined,
      gap: mm(1.4, scale),
    };

    if (variant === "steps") {
      const total = Math.max(2, Math.min(12, Number(s.steps) || 5));
      const filled = Math.round((value / 100) * total);
      const dot = Math.max(2.4, Math.min(el.h * 0.34, 7));
      return (
        <div style={container}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: mm(2, scale), alignItems: "baseline" }}>
            <span style={{ flex: 1, minWidth: 0 }}>{text.text}</span>
            {s.showValue !== false && <span style={{ color: s.fill || "#006c35" }}>{shown}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: mm(dot * 0.55, scale) }}>
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                style={{
                  width: mm(dot, scale),
                  height: mm(dot, scale),
                  borderRadius: "999px",
                  background: i < filled ? s.fill || "#006c35" : s.background || "#e8ecf3",
                }}
              />
            ))}
          </div>
        </div>
      );
    }

    if (variant === "ring") {
      const size = Math.max(8, Math.min(el.w, el.h));
      const thickness = Math.max(1.5, size * 0.11);
      const r = (size - thickness) / 2;
      const c = 2 * Math.PI * r;
      return (
        <div style={container}>
          <div style={{ position: "relative", width: mm(size, scale), height: mm(size, scale) }}>
            <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%">
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.background || "#e8ecf3"} strokeWidth={thickness} />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.fill || "#006c35"}
                strokeWidth={thickness}
                strokeLinecap="round"
                strokeDasharray={`${(c * value) / 100} ${c}`}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            </svg>
            {s.showValue !== false && (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>{shown}</div>
            )}
          </div>
          <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {text.text}
          </span>
        </div>
      );
    }

    const barHeight = Math.max(2, el.h * 0.3);
    return (
      <div style={container}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: mm(2, scale), alignItems: "baseline" }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {text.text}
          </span>
          {s.showValue !== false && <span style={{ color: s.fill || "#006c35" }}>{shown}</span>}
        </div>
        <div
          style={{
            height: mm(barHeight, scale),
            background: s.background || "#e8ecf3",
            borderRadius: mm(s.radius ?? 3, scale),
            overflow: "hidden",
          }}
        >
          <div style={{ width: `${value}%`, height: "100%", background: s.fill || "#006c35" }} />
        </div>
      </div>
    );
  }

  if (el.type === "line") {
    const vertical = el.h > el.w;
    const thickness = mm(s.stroke || 0.8, scale);
    return (
      <div style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            background: s.color || "#c9a86a",
            width: vertical ? thickness : "100%",
            height: vertical ? "100%" : thickness,
          }}
        />
      </div>
    );
  }

  if (el.type === "divider") {
    const c = s.color || "#c9a86a";
    const thickness = mm(s.stroke || 0.5, scale);
    const diamond = mm(3.6, scale);
    return (
      <div style={{ ...box, display: "flex", alignItems: "center", gap: mm(1.5, scale), padding: `0 ${mm(1, scale)}` }}>
        <span style={{ flex: 1, background: c, height: thickness }} />
        <span style={{ width: diamond, height: diamond, border: `${mm(0.4, scale)} solid ${c}`, transform: "rotate(45deg)" }} />
        <span style={{ flex: 1, background: c, height: thickness }} />
      </div>
    );
  }

  if (el.type === "image" || el.type === "logo" || el.type === "qr") {
    const src = safeImageSrc(el.src);
    if (!src) {
      /* No source yet: a soft frame reads better than an empty hole. */
      return (
        <div
          style={{
            ...box,
            background: "repeating-linear-gradient(45deg, #eef2f7, #eef2f7 2px, #e2e8f0 2px, #e2e8f0 4px)",
            borderRadius: s.radius ? mm(s.radius, scale) : undefined,
          }}
        />
      );
    }
    return (
      /* Real artwork from the document: a data-URL or a remote image, exactly
         as the canvas paints it. */
      <img
        alt=""
        src={src}
        draggable={false}
        loading="lazy"
        decoding="async"
        style={{
          ...box,
          objectFit: (s.objectFit as React.CSSProperties["objectFit"]) ||
            (el.type === "logo" || el.type === "qr" ? "contain" : "cover"),
          objectPosition: `${s.objectX ?? 50}% ${s.objectY ?? 50}%`,
          borderRadius: s.radius ? mm(s.radius, scale) : undefined,
        }}
      />
    );
  }

  if (el.type === "svg") {
    const markup = applySvgColors(sanitizeSvgContent(el.content), {
      fill: s.svgFill,
      stroke: s.svgStroke,
      strokeWidth: s.svgStrokeWidth,
    });
    if (!markup) return null;
    return (
      <div
        style={{ ...box, color: s.color || "#172033", display: "grid", placeItems: "center" }}
        // Sanitised above by the editor's own allow-list walk.
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    );
  }

  if (el.type === "icon") {
    const d = ICONS[el.icon || "star"] || ICONS.star;
    return (
      <div style={{ ...box, color: s.color || "#c9a86a", display: "grid", placeItems: "center" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={s.stroke || 1.8} strokeLinecap="round" strokeLinejoin="round" width="100%" height="100%">
          <path d={d} />
        </svg>
      </div>
    );
  }

  if (el.type === "shape") {
    const shapeId = String(s.shapeId || s.shape || "rect");
    const round = shapeId === "circle" || shapeId === "ellipse" || shapeId === "seal";
    return (
      <div
        style={{
          ...box,
          background: round ? undefined : fill || undefined,
          border,
          borderRadius: round ? "50%" : s.radius ? mm(s.radius, scale) : undefined,
        }}
      />
    );
  }

  if (el.type === "stamp") {
    return (
      <div
        style={{
          ...box,
          ...textCss,
          fontWeight: 700,
          display: "grid",
          placeItems: "center",
          textAlign: "center",
          borderRadius: "999px",
          border: `${mm(0.7, scale)} double ${s.borderColor || s.color || "#c9a86a"}`,
          color: s.color || "#c9a86a",
          transform: `${box.transform} rotate(-12deg)`,
        }}
      >
        {text.text || "معتمد"}
      </div>
    );
  }

  if (el.type === "table") {
    const cols = Number(s.cols) || 3;
    const rows = Number(s.rows) || 4;
    const data = parseTable(el.content, cols, rows);
    const stripe = s.stripeBg;
    return (
      <div style={box}>
        <table
          style={{
            width: "100%",
            height: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
            fontFamily: cssFont(s.fontFamily),
            fontSize: pt(Number(s.fontSize) || 11, scale),
            direction: "rtl",
          }}
        >
          <tbody>
            {data.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => {
                  const zebra = stripe && ri > 0 && ri % 2 === 0 ? stripe : undefined;
                  return (
                    <td
                      key={ci}
                      style={{
                        border: `${mm(Number(s.borderWidth) || 0.3, scale)} solid ${s.borderColor || "#bfc7d6"}`,
                        padding: mm(1.6, scale),
                        background: ri === 0 ? s.headerBg || "#006c35" : zebra || s.tableBg || "#fff",
                        color: ri === 0 ? s.headerColor || "#fff" : s.color || "#172033",
                        fontWeight: ri === 0 ? 800 : 500,
                        textAlign: (s.cellAlign as React.CSSProperties["textAlign"]) || "right",
                        verticalAlign: "top",
                        overflow: "hidden",
                      }}
                    >
                      {applyNumerals(cell, s.numerals)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return null;
}
