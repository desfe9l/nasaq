/*
 * «إجراءات المحتوى المحدد» — contextual AI on the selected element.
 *
 * WHY IT LIVES IN THE TEXT SECTION
 * -------------------------------
 * `ArabicTextTools` answers "make this Arabic paragraph look right" with
 * deterministic typography. This answers the other half of the same moment —
 * "make this paragraph SAY it right" — so it sits directly beneath it, on the
 * same selection, with no second inspector and no upload step.
 *
 * THREE RULES IT KEEPS
 * --------------------
 *   1. The selection is the whole input. Only the element's own text is sent;
 *      the rest of the document is not, and nothing else is touched on the way
 *      back.
 *   2. Nothing changes until the author accepts it. The result is previewed in
 *      the panel; «تطبيق» replaces the element's content, «إلغاء» leaves the
 *      document exactly as it was. Applying is one history entry, so undo works.
 *   3. «تحويل إلى جدول» produces a REAL NASAQ table element built through the
 *      same `createElement("table")` + `serializeTable` path the canvas uses —
 *      not a picture of a table.
 */

import { useMemo, useState } from "react";
import { Check, Loader2, Sparkles, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import type { CanvasEl } from "@/lib/editor/model";
import { createElement } from "@/lib/editor/model";
import { serializeTable } from "@/lib/editor/tables";
import { useEditor } from "@/lib/editor/store";
import { THEMES } from "@/lib/editor/model";
import { LICENSE_ROUTE } from "@/lib/site-routes";
import {
  SELECTION_ACTIONS,
  describeSelectionResult,
  rowsForSelection,
  type SelectionActionId,
} from "@/lib/ai/selection-contract";
import { transformSelectionFn } from "@/lib/ai/functions";
import { cn } from "@/lib/utils";

/** The element's own text. Tables carry a JSON matrix, everything else content. */
function elementText(el: CanvasEl): string {
  if (el.type === "table") {
    try {
      const rows = JSON.parse(String(el.content ?? "[]")) as unknown;
      if (Array.isArray(rows)) {
        return rows
          .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")).join(" | ") : String(row)))
          .join("\n");
      }
    } catch {
      /* fall through to the raw content */
    }
  }
  const content = String(el.content ?? "");
  if (el.children?.length) {
    return [content, ...el.children.map((child) => String(child.content ?? ""))]
      .filter((line) => line.trim())
      .join("\n");
  }
  return content;
}

export function SelectionAiActions({ el }: { el: CanvasEl }) {
  const updateElement = useEditor((s) => s.updateElement);
  const replaceElement = useEditor((s) => s.replaceElement);
  const theme = useEditor((s) => s.theme);
  const entitlements = useEditor((s) => s.entitlements);

  const [busy, setBusy] = useState<SelectionActionId | null>(null);
  const [instructions, setInstructions] = useState("");
  const [pending, setPending] = useState<{ action: SelectionActionId; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const source = useMemo(() => elementText(el), [el]);
  const available = entitlements.ai_report;

  const run = async (action: SelectionActionId) => {
    if (!source.trim()) {
      toast.error("لا يوجد نص في العنصر المحدد");
      return;
    }
    setBusy(action);
    setError(null);
    setPending(null);
    try {
      const result = await transformSelectionFn({
        data: {
          action,
          text: source.slice(0, 6_000),
          instructions,
          language: "ar",
        },
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setPending({ action, text: result.text });
    } catch {
      setError("تعذر الاتصال بخدمة الذكاء الاصطناعي. لم يتغير العنصر.");
    } finally {
      setBusy(null);
    }
  };

  const apply = () => {
    if (!pending) return;
    if (pending.action === "table") {
      const rows = rowsForSelection(pending.text);
      if (!rows.length) {
        setError("لم يُعد المزود صفوفًا صالحة للجدول. لم يتغير العنصر.");
        return;
      }
      const cols = Math.min(12, Math.max(...rows.map((row) => row.length)));
      const table = createElement(
        "table",
        {
          id: el.id,
          name: el.name || "جدول من نص محدد",
          x: el.x,
          y: el.y,
          z: el.z,
          // A table needs room for its columns; the element's own height is kept
          // when it is already taller than the minimum useful table.
          w: Math.max(el.w, 120),
          h: Math.max(el.h, 30 + rows.length * 8),
          content: serializeTable(rows),
          style: { ...el.style, cols, rows: rows.length },
        },
        THEMES[theme],
      );
      replaceElement(table);
      toast.success(`حُوّل النص إلى جدول قابل للتحرير (${rows.length} صفًا)`);
    } else {
      updateElement(el.id, { content: pending.text });
      toast.success("تم تطبيق النص على العنصر المحدد");
    }
    setPending(null);
    setInstructions("");
  };

  if (!available) {
    return (
      <div className="editor-subgroup">
        <h4 className="editor-subgroup-title">إجراءات الذكاء الاصطناعي</h4>
        <p className="text-[11px] leading-5 text-muted">
          إعادة الصياغة والتلخيص والتحويل إلى جدول متاحة مع النسخة الكاملة.
        </p>
        <a
          href={LICENSE_ROUTE}
          className="mt-1 inline-flex h-8 items-center rounded-[8px] border border-line px-2.5 text-[11px] font-bold text-ink transition hover:border-brand"
        >
          تفعيل الترخيص
        </a>
      </div>
    );
  }

  return (
    <div className="editor-subgroup">
      <h4 className="editor-subgroup-title flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-gold" aria-hidden />
        إجراءات المحتوى المحدد
      </h4>

      <div className="grid grid-cols-2 gap-1.5">
        {SELECTION_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            title={action.hint}
            disabled={busy !== null}
            onClick={() => void run(action.id)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-[8px] border border-line px-2 py-1.5 text-[11px] font-extrabold transition hover:border-navy-2 disabled:opacity-50",
              pending?.action === action.id && "border-brand bg-navy/5 text-brand",
            )}
          >
            {busy === action.id ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : action.id === "table" ? (
              <Wand2 className="size-3" aria-hidden />
            ) : null}
            {action.label}
          </button>
        ))}
      </div>

      <input
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        placeholder="تعليمات إضافية (اختياري)"
        className="mt-2 h-8 w-full rounded-[8px] border border-line bg-page px-2 text-[11px] font-semibold focus:border-brand focus:outline-none"
      />

      {error && (
        <p className="mt-2 rounded-[8px] border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] leading-5 text-red-700">
          {error}
        </p>
      )}

      {pending && (
        <div className="mt-2 rounded-[10px] border border-line bg-page p-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold text-muted">
              الناتج — {describeSelectionResult(pending.action, pending.text)}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={apply}
                className="inline-flex h-7 items-center gap-1 rounded-[7px] bg-navy px-2 text-[11px] font-extrabold text-on-brand transition hover:bg-navy-2"
              >
                <Check className="size-3" aria-hidden />
                تطبيق
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-line px-2 text-[11px] font-bold text-muted transition hover:border-brand"
              >
                <X className="size-3" aria-hidden />
                إلغاء
              </button>
            </div>
          </div>
          <p className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-ink">
            {pending.action === "table"
              ? rowsForSelection(pending.text)
                  .map((row) => row.join("  |  "))
                  .join("\n")
              : pending.text}
          </p>
        </div>
      )}

      <p className="mt-1.5 text-[10px] leading-4 text-muted">
        يُرسل نص العنصر المحدد فقط، ولا يتغير المستند حتى تضغط «تطبيق».
      </p>
    </div>
  );
}
