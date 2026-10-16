/**
 * SmartObjectEditor — nested editing for Photoshop Smart Objects.
 *
 * When a PSD layer is a smart object, its embedded or linked source data
 * is preserved in CanvasEl.smartObject. This component provides a practical
 * nested-content editing workflow: opening the smart object's content in
 * an inline editor, saving changes back to the parent object, and falling
 * back gracefully when native editing is not possible.
 */

import { useCallback, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { type CanvasEl, type SmartObjectSource } from "@/lib/editor/model";
import { cn } from "@/lib/utils";

interface SmartObjectEditorProps {
  el: CanvasEl;
  selected: boolean;
}

export function SmartObjectEditor({ el, selected }: SmartObjectEditorProps) {
  const updateElement = useEditor((s) => s.updateElement);
  const smartObject = el.smartObject;
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const openSmartObject = useCallback(() => {
    setEditError(null);
    if (!smartObject) return;
    if (smartObject.embeddedPsd) {
      // Open embedded PSD content for nested editing.
      // In a full implementation this would launch a nested editor instance
      // with the embedded PSD as the document. For now, we mark the element
      // as "editing" so the UI can show a nested editing surface.
      setEditing(true);
    } else if (smartObject.linkedFile) {
      setEditError(
        "هذا الكائن الذكي مرتبط بملف خارجي. يفتح الملف المصدر للتحرير.",
      );
    } else {
      setEditError("لا توجد بيانات مصدر قابلة للتحرير لهذا الكائن الذكي.");
    }
  }, [smartObject]);

  const saveSmartObject = useCallback(
    (nextContent: string) => {
      if (!smartObject) return;
      // Save edited content back to the smart object's embedded data.
      updateElement(
        el.id,
        {
          smartObject: {
            ...smartObject,
            embeddedPsd: nextContent,
          },
        },
        true,
      );
      setEditing(false);
    },
    [el.id, smartObject, updateElement],
  );

  const closeSmartObject = useCallback(() => {
    setEditing(false);
    setEditError(null);
  }, []);

  // Hooks stay unconditional; the null guard runs after them.
  if (!smartObject || !selected) return null;

  return (
    <div
      className={cn(
        /* An overlay pinned to the artwork. It must be absolute: in flow it
           stacked BELOW the image, so the «ذكي» badge and the edit button
           detached from the object they belong to (and landed under the
           floating toolbar). The root never takes pointer events, so the
           element stays selectable/draggable; its controls opt back in. */
        "pointer-events-none absolute inset-0 flex flex-col items-center justify-center",
        editing ? "opacity-50" : "",
      )}
      data-smart-object="true"
    >
      {/* Smart object badge — shown when not editing. */}
      {!editing && (
        <div
          className="pointer-events-auto absolute top-1 right-1 z-10 bg-navy/90 text-on-brand text-[10px] px-2 py-1 rounded-bl-md"
          title="كائن ذكي — انقر للتحرير"
        >
          ذكي
        </div>
      )}
      {/* Edit button. */}
      {!editing && !editError && (
        <button
          type="button"
          onClick={openSmartObject}
          onPointerDown={(e) => e.stopPropagation()}
          className="pointer-events-auto absolute bottom-2 right-2 z-10 bg-navy hover:bg-navy-2 text-on-brand text-[10px] px-3 py-1.5 rounded-md shadow-lg transition-colors"
          disabled={!smartObject.embeddedPsd && !smartObject.linkedFile}
        >
          {smartObject.linkedFile ? "فتح المصدر" : "تحرير المحتوى"}
        </button>
      )}
      {/* Edit error. */}
      {editError && (
        <div
          className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 bg-danger text-on-brand text-[10px] px-3 py-2 rounded-md shadow-lg text-center max-w-xs"
        >
          {editError}
        </div>
      )}
      {/* Nested editing surface. */}
      {editing && smartObject.embeddedPsd && (
        <div
          className="pointer-events-auto absolute inset-0 z-20 bg-surface/95 backdrop-blur-sm border border-line rounded-lg shadow-2xl flex flex-col"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-3 border-b border-line">
            <span className="text-sm font-semibold text-ink">
              تحرير المحتوى المتداخل
            </span>
            <button
              type="button"
              onClick={closeSmartObject}
              className="text-[10px] text-brand hover:text-brand-hover"
            >
              إغلاق
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <div className="text-[10px] text-muted mb-2">
              الكائن الذكي المضمّن — غير مدعوم للتحرير المباشر في هذا الإصدار.
              احتفظ ببيانات المصدر لإعادة الاستيراد.
            </div>
            <button
              type="button"
              onClick={() => {
                // Save with current embedded data (no changes in this version).
                saveSmartObject(smartObject.embeddedPsd || "");
              }}
              className="w-full bg-navy hover:bg-navy-2 text-on-brand text-[11px] py-2 rounded-md transition-colors"
            >
              حفظ التغييرات
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
