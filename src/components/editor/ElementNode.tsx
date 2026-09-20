import { useEffect, useRef } from "react";
import { ICONS, cssFont, parseTable, type CanvasEl } from "@/lib/editor/model";
import { prepareText, textPadding } from "@/lib/editor/text-render";
import { useEditor } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { applyNumerals } from "@/lib/editor/arabic";
import { safeImageSrc } from "@/lib/editor/images";
import { ShapeGlyph } from "./ShapeGlyph";

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

interface Props {
  el: CanvasEl;
  selected: boolean;
  interactive: boolean;
  showControls?: boolean;
  onPointerDown: (e: React.PointerEvent, kind: "move" | "resize" | "rotate", handle?: string) => void;
}

/** Types whose text can be edited in place with a double click. */
const EDITABLE = new Set(["text", "box", "stat", "stamp", "progress"]);

export function ElementNode({
  el,
  selected,
  interactive,
  showControls = true,
  onPointerDown,
  multi,
  onEnterGroup,
}: Props & { multi?: boolean; onEnterGroup?: () => void }) {
  const updateElement = useEditor((s) => s.updateElement);
  const fitTextBox = useEditor((s) => s.fitTextBox);
  const commit = useEditor((s) => s.commit);
  const textRef = useRef<HTMLDivElement>(null);
  const editing = useRef(false);

  // A remount (undo, page switch) must never leave a stale contentEditable DOM
  // node behind: the rendered `{el.content}` would be out of sync with it.
  useEffect(() => {
    if (editing.current && textRef.current && textRef.current.isContentEditable) {
      editing.current = false;
      textRef.current.contentEditable = "false";
      textRef.current.classList.remove("editing");
    }
  }, [el.id]);

  const startEdit = (e: React.MouseEvent) => {
    if (!interactive || el.locked) return;
    // Double-clicking a group steps inside it rather than editing text, which is
    // the only way to reach members that are selectable individually.
    if (el.type === "group") {
      if (onEnterGroup) {
        e.stopPropagation();
        onEnterGroup();
      }
      return;
    }
    if (!EDITABLE.has(el.type)) return;
    e.stopPropagation();
    const node = textRef.current;
    if (!node) return;
    editing.current = true;
    node.contentEditable = "true";
    node.classList.add("editing");
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const finishEdit = () => {
    const node = textRef.current;
    if (!node || !editing.current) return;
    editing.current = false;
    node.contentEditable = "false";
    node.classList.remove("editing");
    const next = node.innerText;
    const changed = next !== el.content;
    if (changed) updateElement(el.id, { content: next });
    // Re-measure after committing: an auto-height box has to grow now, not on
    // the next unrelated render, or the author sees their text cut mid-typing.
    if (changed) fitTextBox(el.id);
    commit();
  };

  const handleEditKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      finishEdit();
    }
  };

  if (el.hidden) return null;

  return (
    <div
      data-el-id={el.id}
      className={cn(
        "canvas-el",
        selected && interactive && "selected",
        selected && multi && "is-secondary",
        el.locked && "locked",
      )}
      style={{
        left: `${el.x}mm`,
        top: `${el.y}mm`,
        width: `${el.w}mm`,
        height: `${el.h}mm`,
        transform: `rotate(${el.rotation || 0}deg)`,
        opacity: el.opacity ?? 1,
        zIndex: el.z,
        boxShadow: el.style?.shadow || undefined,
        cursor: el.locked ? "not-allowed" : interactive ? "move" : "default",
      }}
      onPointerDown={(e) => {
        if (!interactive) return;
        if ((e.target as HTMLElement).closest(".handle, .rotate-handle")) return;
        onPointerDown(e, "move");
      }}
      onDoubleClick={startEdit}
    >
      <ElementContent el={el} textRef={textRef} onBlur={finishEdit} onKeyDown={handleEditKey} />
      {showControls && selected && interactive && !el.locked && !multi && (
        <>
          {HANDLES.map((h) => (
            <div
              key={h}
              className={cn("handle", h)}
              onPointerDown={(e) => {
                e.stopPropagation();
                onPointerDown(e, "resize", h);
              }}
            />
          ))}
          <div
            className="rotate-handle"
            onPointerDown={(e) => {
              e.stopPropagation();
              onPointerDown(e, "rotate");
            }}
          />
        </>
      )}
    </div>
  );
}

function ElementContent({
  el,
  textRef,
  onBlur,
  onKeyDown,
}: {
  el: CanvasEl;
  textRef: React.RefObject<HTMLDivElement | null>;
  onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
}) {
  const s = el.style || {};
  const prepared = prepareText(el);
  const vertical = s.writingMode === "vertical";
  const pad = textPadding(el);
  /*
   * Arabic leading is measured from the baseline, not the em box, so a single
   * `line-height` value renders unevenly across fonts that place their
   * ascenders and descenders differently. Hyphenation stays off (there is no
   * Arabic hyphenation worth trusting), and justified text keeps its closing
   * line flush to the right unless the author asks for it to stretch too.
   */
  const textStyle: React.CSSProperties = {
    fontFamily: cssFont(s.fontFamily),
    fontSize: `${prepared.fontSize}pt`,
    color: s.color || "#172033",
    fontWeight: s.fontWeight || 600,
    fontStyle: (s.fontStyle as React.CSSProperties["fontStyle"]) || "normal",
    textAlign: s.textAlign || "right",
    lineHeight: s.lineHeight || 1.45,
    letterSpacing: s.letterSpacing ? `${s.letterSpacing}mm` : undefined,
    textShadow: s.textShadow || "none",
    direction: "rtl",
    writingMode: vertical ? "vertical-rl" : undefined,
    textOrientation: vertical ? "mixed" : undefined,
    hyphens: "none",
    padding: pad ? `${pad}mm` : undefined,
    overflow: s.overflowVisible ? "visible" : undefined,
    ...(s.textAlign === "justify" && s.justifyLastLine === "stretch"
      ? { textAlignLast: "justify" as const }
      : {}),
  };

  // While a text node is being edited it is contentEditable, and re-rendering the
  // normalised string would fight the caret. `isContentEditable` distinguishes
  // that state without extra React state, so raw content is shown mid-edit and
  // the cleaned string appears once editing ends.
  const renderText = (fallback: string) => (textRef.current?.isContentEditable ? el.content || "" : prepared.text || fallback);

  if (el.type === "text") {
    return (
      <div
        ref={textRef}
        className="el-text"
        style={textStyle}
        onPointerDown={(e) => e.currentTarget.isContentEditable && e.stopPropagation()}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        {renderText("")}
      </div>
    );
  }

  if (el.type === "box" || el.type === "stat") {
    return (
      <div
        ref={textRef}
        className="el-box"
        style={{
          ...textStyle,
          background: s.fill || s.background || "#f7f8fb",
          border: `${s.borderWidth ?? 0.35}mm solid ${s.borderColor || "#d9dee8"}`,
          borderRadius: `${s.radius ?? 4}mm`,
          padding: `${pad}mm`,
          display: "flex",
          alignItems: el.type === "stat" ? "center" : "flex-start",
          justifyContent:
            s.textAlign === "center" ? "center" : s.textAlign === "left" ? "flex-end" : "flex-start",
        }}
        onPointerDown={(e) => e.currentTarget.isContentEditable && e.stopPropagation()}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        {renderText("")}
      </div>
    );
  }

  if (el.type === "progress") {
    const value = Math.max(0, Math.min(100, Number(s.value) || 0));
    const shown = s.numerals ? `${applyNumerals(String(value), s.numerals)}%` : `${value}%`;
    // `textRef` sits on the caption alone. Putting it on the flex container would
    // make the percentage and the bar part of `innerText`, so committing an edit
    // would write "نسبة الإنجاز70%" back into the element's content.
    const caption = (
      <span
        ref={textRef}
        className="progress-caption"
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          outline: "none",
        }}
        onPointerDown={(e) => e.currentTarget.isContentEditable && e.stopPropagation()}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        {renderText("")}
      </span>
    );

    if (s.variant === "ring") {
      const size = Math.max(8, Math.min(el.w, el.h));
      const thickness = Math.max(1.5, size * 0.11);
      const r = (size - thickness) / 2;
      const c = 2 * Math.PI * r;
      return (
        <div
          className="el-box"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1mm",
            direction: "rtl",
            fontFamily: cssFont(s.fontFamily),
            color: s.color || "#172033",
            overflow: "hidden",
          }}
        >
          <div style={{ position: "relative", width: `${size}mm`, height: `${size}mm`, flexShrink: 0 }}>
            <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%">
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.background || "#e8ecf3"}
                strokeWidth={thickness}
              />
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
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  fontSize: `${prepared.fontSize}pt`,
                  fontWeight: s.fontWeight || 700,
                }}
              >
                {shown}
              </div>
            )}
          </div>
          {caption}
        </div>
      );
    }

    const barHeight = Math.max(2, el.h * 0.3);
    return (
      <div
        className="el-box"
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: "1.4mm",
          direction: "rtl",
          fontFamily: cssFont(s.fontFamily),
          fontSize: `${prepared.fontSize}pt`,
          color: s.color || "#172033",
          fontWeight: s.fontWeight || 700,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "2mm" }}>
          {caption}
          {s.showValue !== false && (
            <span style={{ color: s.fill || "#006c35", flexShrink: 0 }}>{shown}</span>
          )}
        </div>
        <div
          style={{
            height: `${barHeight}mm`,
            background: s.background || "#e8ecf3",
            borderRadius: `${s.radius ?? 3}mm`,
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <div style={{ width: `${value}%`, height: "100%", background: s.fill || "#006c35" }} />
        </div>
      </div>
    );
  }

  if (el.type === "group") {
    return (
      <div className="relative h-full w-full">
        {(el.children || [])
          .slice()
          .sort((a, b) => a.z - b.z)
          .map((child) => (
            <ElementNode
              key={child.id}
              el={{ ...child, hidden: child.hidden }}
              selected={false}
              interactive={false}
              onPointerDown={() => {}}
            />
          ))}
      </div>
    );
  }

  if (el.type === "shape") {
    return (
      <ShapeGlyph
        style={s}
        fill={s.fill || "#006c35"}
        stroke={s.borderColor || "transparent"}
        borderWidthMm={Number(s.borderWidth) || 0}
        box={{ w: el.w, h: el.h }}
      />
    );
  }

  if (el.type === "line") {
    const vertical = el.h > el.w;
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div
          style={{
            background: s.color || "#c9a86a",
            width: vertical ? `${s.stroke || 0.8}mm` : "100%",
            height: vertical ? "100%" : `${s.stroke || 0.8}mm`,
          }}
        />
      </div>
    );
  }

  if (el.type === "divider") {
    const c = s.color || "#c9a86a";
    return (
      <div className="flex h-full w-full items-center gap-1.5 px-1">
        <span className="h-px flex-1" style={{ background: c, height: `${s.stroke || 0.5}mm` }} />
        <span
          className="shrink-0"
          style={{
            width: "3.6mm",
            height: "3.6mm",
            border: `0.4mm solid ${c}`,
            transform: "rotate(45deg)",
          }}
        />
        <span className="h-px flex-1" style={{ background: c, height: `${s.stroke || 0.5}mm` }} />
      </div>
    );
  }

  if (el.type === "image" || el.type === "logo" || el.type === "qr") {
    const src = safeImageSrc(el.src);
    if (!src) {
      return (
        <div className="grid h-full w-full place-items-center bg-[#f4f6fa] text-[9pt] font-bold text-muted">
          لا توجد صورة
        </div>
      );
    }
    return (
      <img
        alt=""
        src={src}
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: s.objectFit || (el.type === "logo" || el.type === "qr" ? "contain" : "cover"),
          objectPosition: `${s.objectX ?? 50}% ${s.objectY ?? 50}%`,
          borderRadius: `${s.radius || 0}mm`,
          pointerEvents: "none",
        }}
      />
    );
  }

  if (el.type === "icon") {
    const d = ICONS[el.icon || "star"] || ICONS.star;
    return (
      <div className="grid h-full w-full place-items-center" style={{ color: s.color || "#c9a86a" }}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={s.stroke || 1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-full w-full"
        >
          <path d={d} />
        </svg>
      </div>
    );
  }

  if (el.type === "stamp") {
    return (
      <div
        ref={textRef}
        className="grid h-full w-full place-items-center text-center"
        style={{
          borderRadius: "999px",
          border: `0.7mm double ${s.borderColor || s.color || "#c9a86a"}`,
          color: s.color || "#c9a86a",
          fontFamily: cssFont(s.fontFamily || "Amiri"),
          fontWeight: 700,
          fontSize: `${prepared.fontSize}pt`,
          transform: "rotate(-12deg)",
          lineHeight: 1.2,
          whiteSpace: "pre-wrap",
          overflow: "hidden",
        }}
        onPointerDown={(e) => e.currentTarget.isContentEditable && e.stopPropagation()}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        {renderText("معتمد")}
      </div>
    );
  }

  if (el.type === "table") {
    const cols = s.cols || 3;
    const rows = s.rows || 4;
    const data = parseTable(el.content, cols, rows);
    const stripe = s.stripeBg;
    return (
      <table
        className="h-full w-full border-collapse"
        style={{
          tableLayout: "fixed",
          fontFamily: cssFont(s.fontFamily),
          fontSize: `${s.fontSize || 11}pt`,
          direction: "rtl",
        }}
      >
        <tbody>
          {data.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => {
                const Tag = ri === 0 ? "th" : "td";
                const zebra = stripe && ri > 0 && ri % 2 === 0 ? stripe : undefined;
                return (
                  <Tag
                    key={ci}
                    style={{
                      border: `${s.borderWidth ?? 0.3}mm solid ${s.borderColor || "#bfc7d6"}`,
                      padding: "1.6mm",
                      background: ri === 0 ? s.headerBg || "#006c35" : zebra || s.tableBg || "#fff",
                      color: ri === 0 ? s.headerColor || "#fff" : s.color || "#172033",
                      fontWeight: ri === 0 ? 800 : 500,
                      textAlign: s.cellAlign || "right",
                      verticalAlign: "top",
                      overflow: "hidden",
                    }}
                  >
                    {applyNumerals(cell, s.numerals)}
                  </Tag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return null;
}