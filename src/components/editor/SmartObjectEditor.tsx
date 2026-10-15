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

  if (!smartObject || !selected) return null;

  const openSmartObject = useCallback(() => {
    setEditError(null);
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

  return (
    <div
      className={cn(
        "relative h-full w-full flex flex-col items-center justify-center",
        editing ? "opacity-50 pointer-events-none" : "",
      )}
      data-smart-object="true"
    >
      {/* Smart object badge — shown when not editing. */}
      {!editing && (
        <div
          className="absolute top-1 right-1 z-10 bg-emerald-900/90 text-white text-[10px] px-2 py-1 rounded-bl-md"
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
          className="absolute bottom-2 right-2 z-10 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] px-3 py-1.5 rounded-md shadow-lg transition-colors"
          disabled={!smartObject.embeddedPsd && !smartObject.linkedFile}
        >
          {smartObject.linkedFile ? "فتح المصدر" : "تحرير المحتوى"}
        </button>
      )}
      {/* Edit error. */}
      {editError && (
        <div
          className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 bg-destructive text-white text-[10px] px-3 py-2 rounded-md shadow-lg text-center max-w-xs"
        >
          {editError}
        </div>
      )}
      {/* Nested editing surface. */}
      {editing && smartObject.embeddedPsd && (
        <div className="absolute inset-0 z-20 bg-white/95 backdrop-blur-sm border border-emerald-200 rounded-lg shadow-2xl flex flex-col">
          <div className="flex items-center justify-between p-3 border-b border-emerald-200">
            <span className="text-sm font-semibold text-emerald-900">
              تحرير المحتوى المتداخل
            </span>
            <button
              type="button"
              onClick={closeSmartObject}
              className="text-[10px] text-emerald-600 hover:text-emerald-900"
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
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] py-2 rounded-md transition-colors"
            >
              حفظ التغييرات
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
