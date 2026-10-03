import { useEditor } from "@/lib/editor/store";
import { strokeBinding, strokePatch, strokePixels } from "@/lib/editor/stroke";
import { ScrubInput } from "./ui/ScrubInput";

/**
 * Border width for the selection.
 *
 * ONE control for one value: the shared scrubber, which already drags, types,
 * nudges with the arrow keys and (on touch) carries ± steppers. The bar used to
 * pair it with a second `<input type="range">` for the same property — 88px of
 * duplicated chrome competing with the tools around it, and two places to be
 * wrong about the same number.
 */
function useStrokeControl() {
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
  return { value, mixed, apply, commit };
}

/** The border control as it appears in the selection bar. */
export function StrokeControls() {
  const control = useStrokeControl();
  if (!control) return null;
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
          value={control.value}
          placeholder={control.mixed ? "متعدد" : undefined}
          min={0}
          max={50}
          step={0.5}
          precision={2}
          suffix="px"
          onChange={control.apply}
          onCommit={control.commit}
        />
      </div>
    </>
  );
}

/**
 * The same border control for a drawer, where it is a labelled field rather
 * than a 76px cell — a drawer has the room to say what the number is.
 */
export function StrokeField() {
  const control = useStrokeControl();
  if (!control) return null;
  return (
    <ScrubInput
      label="سماكة الحد بالبكسل"
      value={control.value}
      placeholder={control.mixed ? "متعدد" : undefined}
      min={0}
      max={50}
      step={0.5}
      precision={2}
      suffix="px"
      onChange={control.apply}
      onCommit={control.commit}
    />
  );
}
