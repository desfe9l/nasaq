/**
 * Large, faithful preview of an imported NASAQ page.
 *
 * The workbench's whole promise is «what you see is what will open in the
 * editor», so this paints the real element tree — groups, rotation, opacity,
 * blend, RTL text — at fit-to-view scale using the same mm→% maths the editor
 * stage uses. No canvas, no bitmap flattening: what renders here is the actual
 * document data.
 */

import { useMemo } from "react";
import { ImageOff } from "lucide-react";
import type { CanvasEl, Page, Project } from "@/lib/editor/model";
import { pageSize } from "@/lib/editor/model";
import { cn } from "@/lib/utils";

function ElementPreview({ el, ox, oy, pageW }: { el: CanvasEl; ox: number; oy: number; pageW: number }) {
  if (el.hidden) return null;
  const x = ((el.x + ox) / pageW) * 100;
  const y = ((el.y + oy) / pageW) * 100; // same unit so rotation matches the editor
  const w = (el.w / pageW) * 100;
  const h = (el.h / pageW) * 100;
  const common: React.CSSProperties = {
    left: `${x}%`,
    top: `${y}%`,
    width: `${w}%`,
    height: `${h}%`,
    opacity: el.opacity,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    zIndex: el.z,
    boxShadow: el.style.shadow,
    mixBlendMode: el.style.blendMode && el.style.blendMode !== "normal" ? el.style.blendMode : undefined,
  };
  const scale = (mm: number) => `${(mm / pageW) * 100}cqw`;

  if (el.type === "group") {
    return (
      <div className="absolute" style={common}>
        {(el.children || []).map((child) => (
          <ElementPreview key={child.id} el={child} ox={el.x + ox} oy={el.y + oy} pageW={pageW} />
        ))}
      </div>
    );
  }

  if (el.type === "image") {
    return (
      <div
        className="absolute overflow-hidden"
        style={{
          ...common,
          borderRadius: el.style.radius ? scale(el.style.radius) : undefined,
          border: el.style.borderWidth ? `${scale(el.style.borderWidth)} solid ${el.style.borderColor || "#172033"}` : undefined,
          transform: `${el.rotation ? `rotate(${el.rotation}deg) ` : ""}${el.style.flipX ? "scaleX(-1) " : ""}${el.style.flipY ? "scaleY(-1)" : ""}`.trim() || undefined,
        }}
      >
        {el.src ? (
          <img
            alt=""
            src={el.src}
            loading="lazy"
            decoding="async"
            className="h-full w-full"
            style={{ objectFit: el.style.objectFit || "fill" }}
          />
        ) : (
          <span className="grid h-full w-full place-items-center bg-line-2 text-muted">
            <ImageOff className="size-[3cqw]" aria-hidden />
          </span>
        )}
      </div>
    );
  }

  if (el.type === "text") {
    return (
      <div
        className="absolute overflow-visible whitespace-pre-wrap"
        style={{
          ...common,
          color: el.style.color,
          textAlign: el.style.textAlign,
          fontWeight: el.style.fontWeight,
          fontStyle: el.style.fontStyle === "italic" ? "italic" : undefined,
          textDecoration: el.style.underline ? "underline" : undefined,
          fontFamily: `"${el.style.fontFamily || "Tajawal"}", "Cairo", sans-serif`,
          fontSize: scale(((el.style.fontSize || 12) * 25.4) / 72),
          lineHeight: el.style.lineHeight || 1.45,
          letterSpacing: el.style.letterSpacing ? scale(el.style.letterSpacing) : undefined,
          textShadow: el.style.textShadow,
          direction: el.style.direction === "ltr" ? "ltr" : "rtl",
          writingMode: el.style.writingMode === "vertical" ? "vertical-rl" : undefined,
        }}
      >
        {el.content}
      </div>
    );
  }

  if (el.type === "table") {
    return (
      <div
        className="absolute grid overflow-hidden bg-white"
        style={{
          ...common,
          gridTemplateColumns: `repeat(${Math.max(1, el.style.cols || 1)}, 1fr)`,
          fontSize: scale(((el.style.fontSize || 11) * 25.4) / 72),
          color: el.style.color,
          direction: el.style.direction === "ltr" ? "ltr" : "rtl",
        }}
      >
        {String(el.content || "")
          .split("\n")
          .map((row, rowIndex) =>
            row
              .split("\t")
              .map((cell, cellIndex) => (
                <span
                  key={`${rowIndex}-${cellIndex}`}
                  className="flex items-center border border-line-2 px-[1cqw] py-[0.6cqw]"
                  style={{
                    background: rowIndex === 0 ? el.style.headerBg || "#071d3d" : undefined,
                    color: rowIndex === 0 ? el.style.headerColor || "#f7f6f3" : undefined,
                    textAlign: (el.style.cellAlign as "right" | "center" | "left") || "right",
                  }}
                >
                  {cell}
                </span>
              )),
          )}
      </div>
    );
  }

  // shapes, boxes, lines, dividers and everything else painted as a box
  return (
    <div
      className="absolute"
      style={{
        ...common,
        background: el.style.fill || el.style.background,
        borderRadius:
          el.style.shape === "circle" ? "999px" : el.style.radius ? scale(el.style.radius) : undefined,
        border: el.style.borderWidth
          ? `${scale(el.style.borderWidth)} ${el.style.borderDash ? "dashed" : "solid"} ${el.style.borderColor || "#172033"}`
          : undefined,
      }}
    />
  );
}

export function PagePreview({
  page,
  className,
  label,
}: {
  page: Page;
  className?: string;
  label?: string;
}) {
  const { w } = pageSize(page);
  const { h } = pageSize(page);
  return (
    <figure className={cn("relative", className)}>
      <div
        dir="rtl"
        className="relative mx-auto w-full overflow-hidden bg-white shadow-lg ring-1 ring-black/10"
        style={{ aspectRatio: `${w} / ${h}`, containerType: "inline-size" }}
      >
        {page.elements
          .slice()
          .sort((a, b) => a.z - b.z)
          .map((el) => (
            <ElementPreview key={el.id} el={el} ox={0} oy={0} pageW={w} />
          ))}
      </div>
      {label && (
        <figcaption className="mt-2 text-center text-[11px] font-extrabold text-muted">{label}</figcaption>
      )}
    </figure>
  );
}

/** Side-by-side or single preview of the whole document's pages. */
export function DocumentPreview({
  project,
  pageIndex,
  compareWith,
  compareLabels,
}: {
  project: Project;
  pageIndex: number;
  /** When set, renders a before/after pair instead of a single page. */
  compareWith?: Project | null;
  compareLabels?: [string, string];
}) {
  const page = project.pages[pageIndex];
  const other = compareWith?.pages[pageIndex];
  const grid = useMemo(() => (compareWith && other ? "md:grid-cols-2" : ""), [compareWith, other]);
  if (!page) return null;
  if (compareWith && other) {
    return (
      <div className={cn("grid items-center gap-5", grid)}>
        <PagePreview page={other} label={compareLabels?.[0]} />
        <PagePreview page={page} label={compareLabels?.[1]} />
      </div>
    );
  }
  return <PagePreview page={page} />;
}
