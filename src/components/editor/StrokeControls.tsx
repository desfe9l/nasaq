import { useEditor } from "@/lib/editor/store";
import { strokeBinding, strokePatch, strokePixels } from "@/lib/editor/stroke";
import { ScrubInput } from "./ui/ScrubInput";

/** One history step per gesture, including heterogeneous multi-selections. */
export function StrokeControls() {
  useEditor((s) => s.pages);
  useEditor((s) => s.selectedIds);
  const elements = useEditor
    .getState()
    .selectedElements()
    .filter((el) => !el.locked && strokeBinding(el));
  if (!elements.length) return null;
  const values = elements.map(strokePixels);
  const mixed =
    values.some((value) => value !== values[0]) || values[0] === undefined;
  const value = mixed ? undefined : values[0];
  const apply = (pixels: number) => {
    const state = useEditor.getState();
    for (const el of state.selectedElements()) {
      const patch = !el.locked && strokePatch(el, pixels);
      if (patch) state.updateStyle(el.id, patch, true);
    }
  };
  const commit = () => useEditor.getState().commit();
  return (
    <>
    {/* The separator belongs to the control: a selection with no stroke
        support must not leave a stray divider behind. */}
    <span className="floating-toolbar-sep" aria-hidden />
    <div
      className="floating-toolbar-section"
      role="group"
      aria-label="سماكة الحد"
    >
      <ScrubInput
        label="سماكة الحد بالبكسل"
        className="floating-toolbar-stroke"
        value={value}
        placeholder={mixed ? "متعدد" : undefined}
        min={0}
        max={50}
        step={0.5}
        precision={2}
        suffix="px"
        onChange={apply}
        onCommit={commit}
      />
      <input
        type="range"
        className="floating-toolbar-range"
        aria-label="منزلق سماكة الحد"
        aria-valuetext={mixed ? "قيم متعددة — اسحب لتوحيدها" : `${value} px`}
        min={0}
        max={50}
        step={0.5}
        value={value ?? 0}
        dir="ltr"
        onChange={(e) => apply(Number(e.currentTarget.value))}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </div>
    </>
  );
}
