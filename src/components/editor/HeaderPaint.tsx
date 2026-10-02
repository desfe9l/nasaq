import { useShallow } from "zustand/react/shallow";
import { useEditor } from "@/lib/editor/store";
import type { Gradient } from "@/lib/editor/gradient";
import type { CanvasEl } from "@/lib/editor/model";
import { ColorField } from "./ui/ColorField";
import { FillField } from "./ui/FillField";

/**
 * «التلوين والتدرج» in the header — one swatch pair beside the text and
 * shape tools, always within reach:
 *
 *   • with a selection, it paints the PRIMARY selected element: its fill
 *     (solid or gradient where the element type supports one) and its border /
 *     stroke colour, using the same bindings the floating bubble and the
 *     inspector use, so the three never disagree;
 *   • with nothing selected, it paints the active PAGE's background (solid or
 *     gradient) — the most common «لوّن الصفحة» request, without a trip to
 *     the page options.
 *
 * Live changes stream through `live = true` (no history entry per step); the
 * commit lands once when the picker closes.
 */
const GRADIENT_TYPES = new Set(["shape", "box", "stat", "progress", "svg"]);
const FILL_TYPES = new Set([
  "shape",
  "box",
  "stat",
  "progress",
  "svg",
  "icon",
  "line",
  "divider",
  "text",
  "stamp",
]);

function fillOf(el: CanvasEl): string | undefined {
  const style = el.style || {};
  if (el.type === "svg") return style.svgFill;
  if (["icon", "line", "divider", "text", "stamp"].includes(el.type))
    return style.color;
  return style.fill;
}
function fillPatch(
  el: CanvasEl,
  v: string,
  gradient?: Gradient,
): CanvasEl["style"] {
  if (el.type === "svg") return { svgFill: v, gradient };
  if (["icon", "line", "divider", "text", "stamp"].includes(el.type))
    return { color: v };
  return { fill: v, gradient };
}
function borderOf(el: CanvasEl): string | undefined {
  const style = el.style || {};
  if (el.type === "line" || el.type === "divider") return style.color;
  if (el.type === "svg" || el.type === "icon") return style.svgStroke;
  return style.borderColor;
}
function borderPatch(el: CanvasEl, v: string): CanvasEl["style"] {
  if (el.type === "line" || el.type === "divider") return { color: v };
  if (el.type === "svg" || el.type === "icon") return { svgStroke: v };
  return { borderColor: v };
}

export function HeaderPaint() {
  const { el, page } = useEditor(
    useShallow((s) => {
      const page =
        s.pages.find((p) => p.id === s.activePageId) ?? s.pages[0] ?? null;
      const id = s.selectedIds[0];
      const el = id && page ? (page.elements.find((e) => e.id === id) ?? null) : null;
      return { el, page };
    }),
  );
  const updateStyle = useEditor((s) => s.updateStyle);
  const setPageBackground = useEditor((s) => s.setPageBackground);

  if (!page) return null;

  if (el && FILL_TYPES.has(el.type)) {
    const style = el.style || {};
    const gradientOk = GRADIENT_TYPES.has(el.type);
    const isLine = el.type === "line" || el.type === "divider";
    return (
      <div
        className="editor-header-paint"
        role="group"
        aria-label="تلوين العنصر المحدد"
        data-tour="paint"
      >
        <FillField
          className="editor-header-swatch"
          label={gradientOk ? "لون التعبئة والتدرج للعنصر" : "لون العنصر"}
          value={fillOf(el)}
          gradient={gradientOk ? style.gradient : undefined}
          allowGradient={gradientOk}
          fallback={style.background || "#006c35"}
          onChange={(v, g) => updateStyle(el.id, fillPatch(el, v, g), true)}
          onCommit={(v, g) => updateStyle(el.id, fillPatch(el, v, g))}
        />
        {!isLine && (
          <ColorField
            className="editor-header-swatch is-border"
            label="لون الإطار / الحد"
            value={borderOf(el)}
            fallback={style.color || "#c9a86a"}
            onChange={(v) => updateStyle(el.id, borderPatch(el, v), true)}
            onCommit={(v) => updateStyle(el.id, borderPatch(el, v))}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className="editor-header-paint"
      role="group"
      aria-label="خلفية الصفحة"
      data-tour="paint"
    >
      <FillField
        className="editor-header-swatch"
        label="خلفية الصفحة — لون أو تدرج"
        value={page.bg || "#ffffff"}
        gradient={page.bgGradient}
        fallback="#ffffff"
        onChange={(v, g) =>
          setPageBackground(page.id, { bg: v, bgGradient: g }, true)
        }
        onCommit={(v, g) => setPageBackground(page.id, { bg: v, bgGradient: g })}
      />
    </div>
  );
}
