import { Sparkles, StretchHorizontal } from "lucide-react";
import type { CanvasEl } from "@/lib/editor/model";
import { MACROS, macroValues, macroIdsIn } from "@/lib/editor/macros";
import { TYPOGRAPHY_PRESETS } from "@/lib/editor/typography";
import { useEditor } from "@/lib/editor/store";
import { getTextContext } from "@/lib/editor/text-render";
import { cn } from "@/lib/utils";

/**
 * Arabic typography controls for the selected text element.
 *
 * Three tools that belong together, because they all answer "make this Arabic
 * paragraph look right":
 *
 *  · **الأنماط الجاهزة** — intent-named presets («عنوان تقرير», «نص رسمي»).
 *    A preset writes style only, and takes its colours from the live theme, so
 *    applying one never fights the document palette.
 *  · **الكشيدة** — opt-in auto-justification per element (see `kashida.ts`).
 *  · **الرموز الديناميكية** — the five macro tokens, dropped in as TOKENS. The
 *    value shown beside each one is what it resolves to right now, which is how
 *    the author knows the entity name and the date are coming from the document
 *    rather than from what they typed last month.
 */
export function ArabicTextTools({ el }: { el: CanvasEl }) {
  const updateStyle = useEditor((s) => s.updateStyle);
  const applyPreset = useEditor((s) => s.applyPreset);
  const insertMacro = useEditor((s) => s.insertMacro);
  /*
   * Live macro values, built from the same four document facts `store.ts` feeds
   * into the render context — read through selectors so the panel re-renders the
   * moment any of them changes, rather than caching a date that goes stale.
   */
  const orgName = useEditor((s) => s.orgName);
  const transactionNo = useEditor((s) => s.transactionNo);
  const pageCount = useEditor((s) => s.pages.length);
  const pageNumber = useEditor((s) =>
    Math.max(1, s.pages.findIndex((p) => p.id === s.activePageId) + 1),
  );
  const values = macroValues({
    orgName,
    transactionNo,
    pageNumber,
    pageCount,
    now: getTextContext().now,
  });
  const used = macroIdsIn(String(el.content ?? ""));
  const kashidaOn = Boolean(el.style?.kashida);

  return (
    <>
      <div className="editor-subgroup">
        <h4 className="editor-subgroup-title">أنماط الطباعة العربية</h4>
        <div className="grid grid-cols-2 gap-1.5">
          {TYPOGRAPHY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset.id)}
              title={preset.hint}
              className="rounded-[8px] border border-line px-2 py-1.5 text-right text-[11px] font-extrabold hover:border-navy-2 dark:border-white/10"
            >
              <span className="block truncate">{preset.label}</span>
              <span
                className="mt-0.5 block truncate text-[10px] font-semibold text-muted"
                style={{
                  fontSize: `${Math.min(13, Math.max(9, preset.style.fontSize * 0.45))}px`,
                }}
              >
                {preset.preview}
              </span>
            </button>
          ))}
        </div>
        <p className="text-[10px] leading-4 text-muted">
          النمط يضبط الخط والحجم واللون من سمة المستند دون تغيير موضع العنصر أو
          مقاسه.
        </p>
      </div>

      <div className="editor-subgroup">
        <h4 className="editor-subgroup-title">الكشيدة (تمديد الأسطر)</h4>
        <label className="flex h-9 items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-[10px] font-extrabold dark:border-white/10">
          <span className="inline-flex items-center gap-1.5">
            <StretchHorizontal className="size-3.5 text-navy-2 dark:text-gold-2" />
            تمديد الأسطر بالكشيدة
          </span>
          <input
            type="checkbox"
            checked={kashidaOn}
            onChange={(e) => updateStyle(el.id, { kashida: e.target.checked })}
            className="accent-navy"
          />
        </label>
        <p className="text-[10px] leading-4 text-muted">
          يوسّع الكشيدة عند مواضع الاتصال المشروعة فقط (بين حرفين متصلين)، فلا
          تُفتح الكلمات ولا يتغيّر النص المقروء. يعمل مع محاذاة «ضبط» والمسافة
          المكتوبة تبقى كما هي.
        </p>
        {kashidaOn && (
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ["start", "السطر الأخير إلى اليمين"],
                ["stretch", "السطر الأخير ممتد"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => updateStyle(el.id, { justifyLastLine: value })}
                aria-pressed={(el.style?.justifyLastLine || "start") === value}
                className={cn(
                  "h-8 rounded-[6px] border text-[10px] font-extrabold",
                  (el.style?.justifyLastLine || "start") === value
                    ? "border-navy-2 bg-navy-2/5"
                    : "border-line dark:border-white/10",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="editor-subgroup">
        <h4 className="editor-subgroup-title">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-gold-2" />
            رموز ديناميكية
          </span>
        </h4>
        <div className="grid gap-1.5">
          {MACROS.map((macro) => {
            const value = values[macro.id];
            const active = used.includes(macro.id);
            return (
              <button
                key={macro.id}
                type="button"
                onClick={() => insertMacro(macro.token)}
                title={`${macro.hint} — القيمة الحالية: ${value}`}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-[8px] border px-2 py-1.5 text-right text-[11px] font-extrabold",
                  active
                    ? "border-navy-2 bg-navy-2/5"
                    : "border-line hover:border-navy-2 dark:border-white/10",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{macro.label}</span>
                <span className="max-w-[55%] truncate text-[10px] font-semibold text-muted">
                  {value}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-[10px] leading-4 text-muted">
          يُحفظ الرمز نفسه لا قيمته، فتتحدّث التواريخ ورقم الصفحة تلقائيًا عند
          كل عرض أو تصدير — حتى بعد إضافة صفحات لاحقًا.
        </p>
      </div>
    </>
  );
}
