import { useState } from "react";
import { Eye, EyeOff, Plus, TextCursorInput, Trash2 } from "lucide-react";
import { useEditor } from "@/lib/editor/store";
import {
  headingDescriptionState,
  isHeadingLike,
} from "@/lib/editor/heading-description";
import { cn } from "@/lib/utils";

/**
 * «الوصف التعريفي» — the compact floating description control.
 *
 * Appears only when a heading (or its description) is selected. One chip,
 * three honest actions — show/hide, edit, remove — plus «إضافة وصف» for
 * headings that never had one. The description is NEVER forced into the
 * report: hidden means hidden, and removing it deletes only the description
 * line, never the heading.
 */
export function HeadingDescriptionControl() {
  const setHeadingDescription = useEditor((s) => s.setHeadingDescription);
  const removeHeadingDescription = useEditor((s) => s.removeHeadingDescription);
  const addHeadingDescription = useEditor((s) => s.addHeadingDescription);
  const selectedId = useEditor((s) => s.selectedId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Read the LIVE state from the page tree (identity-stable subscription on
  // the selection only; the state is derived at render).
  const state = useEditor((s) => {
    const page = s.pages.find((p) => p.id === s.activePageId);
    if (!page || !selectedId) return null;
    return headingDescriptionState(page.elements, selectedId);
  });

  if (!state || !isHeadingLike(state.heading)) return null;

  const { heading, description, present, visible, text } = state;

  const startEdit = () => {
    setDraft(text);
    setEditing(true);
  };
  const commitEdit = () => {
    if (description) setHeadingDescription(heading.id, { text: draft });
    setEditing(false);
  };

  return (
    <div
      className="floating-toolbar-section heading-description-control"
      dir="rtl"
      role="group"
      aria-label={`وصف ${heading.name || "العنوان"}`}
    >
      {!present ? (
        <button
          type="button"
          title="إضافة سطر وصف قابل للإظهار والإخفاء"
          aria-label="إضافة وصف العنوان"
          className="floating-toolbar-btn"
          onClick={() => {
            const id = addHeadingDescription(heading.id);
            if (id) {
              // Land the author straight in the text field of the new line.
              setHeadingDescription(heading.id, { visible: true });
              startEdit();
            }
          }}
        >
          <Plus />
        </button>
      ) : (
        <>
          <button
            type="button"
            title={visible ? "إخفاء وصف العنوان" : "إظهار وصف العنوان"}
            aria-label={visible ? "إخفاء وصف العنوان" : "إظهار وصف العنوان"}
            aria-pressed={visible}
            className={cn("floating-toolbar-btn", visible && "is-active")}
            onClick={() => setHeadingDescription(heading.id, { visible: !visible })}
          >
            {visible ? (
              <Eye />
            ) : (
              <EyeOff />
            )}
          </button>
          <button
            type="button"
            title="تحرير نص الوصف"
            aria-label="تحرير نص الوصف"
            className={cn("floating-toolbar-btn", editing && "is-active")}
            onClick={() => (editing ? commitEdit() : startEdit())}
          >
            <TextCursorInput />
          </button>
          <button
            type="button"
            title="حذف سطر الوصف نهائيًا (العنوان يبقى)"
            aria-label="حذف سطر الوصف"
            className="floating-toolbar-btn text-error"
            onClick={() => {
              removeHeadingDescription(heading.id);
              setEditing(false);
            }}
          >
            <Trash2 />
          </button>
        </>
      )}
      {editing && (
        <input
          autoFocus
          value={draft}
          placeholder="نص الوصف — اتركه فارغًا لإخفائه"
          aria-label="نص وصف العنوان"
          className="floating-toolbar-select h-7 w-40"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      )}
    </div>
  );
}
