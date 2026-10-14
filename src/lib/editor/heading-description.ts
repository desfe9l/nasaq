/**
 * Heading descriptions — الوصف التعريفي للعناوين.
 *
 * A heading's description/subtitle is an INDEPENDENT part of the composition:
 * it is marked on the element (`headingPart: "description"`), it can be shown,
 * edited or removed without touching the heading itself, and nothing forces
 * unwanted placeholder text into the report — new compositions ship with the
 * description hidden until the author asks for it.
 *
 * Everything here is a pure tree transform over the existing element model:
 * no parallel structures, no special rendering. Older documents that predate
 * the marker are recognised by the legacy subtitle names, so every heading
 * already in a file gets the same controls.
 */

import {
  clone,
  createElement,
  findElement,
  flattenElements,
  type CanvasEl,
} from "./model";

/** Legacy names the pre-marker compositions used for their subtitle line. */
const LEGACY_DESCRIPTION_NAMES = new Set([
  "سطر الغلاف",
  "سطر تحت الختم",
  "سطر وصفي",
  "وصف العنوان",
  "الوصف",
]);

/** Names that identify a heading title inside a composition. */
const TITLE_NAME_HINT = /عنوان|الغلاف|الختم/;

export function isHeadingDescription(el: CanvasEl): boolean {
  return (
    el.headingPart === "description" ||
    (el.headingPart == null &&
      LEGACY_DESCRIPTION_NAMES.has((el.name ?? "").trim()))
  );
}

/**
 * True for elements the description controls apply to: a composition that
 * carries (or carried) a description, a heading-like group, or a heading text.
 */
export function isHeadingLike(el: CanvasEl): boolean {
  if (isHeadingDescription(el)) return true;
  if (findHeadingDescription(el)) return true;
  if (el.type === "group") {
    return el.children?.some((c) => TITLE_NAME_HINT.test(c.name ?? "")) ?? false;
  }
  return el.type === "text" && TITLE_NAME_HINT.test(el.name ?? "");
}

/** Direct description child of a heading group, if any. */
export function findHeadingDescription(el: CanvasEl): CanvasEl | undefined {
  if (isHeadingDescription(el)) return el;
  return el.children?.find((c) => isHeadingDescription(c));
}

export interface HeadingDescriptionState {
  /** The heading (group or element) the description belongs to. */
  heading: CanvasEl;
  /** The description element itself, when one exists. */
  description?: CanvasEl;
  present: boolean;
  visible: boolean;
  text: string;
}

/**
 * Resolve `id` (a heading OR its description) to the full description state.
 * Returns null when the element is not a heading-like node at all.
 */
export function headingDescriptionState(
  els: CanvasEl[],
  id: string,
): HeadingDescriptionState | null {
  const hit = findElement(els, id);
  if (!hit) return null;
  const { el } = hit;
  if (isHeadingDescription(el)) {
    // The description of a grouped heading: its parent group is the heading.
    const parent = findParent(els, el.id);
    const heading = parent ?? el;
    return {
      heading,
      description: el,
      present: true,
      visible: !el.hidden,
      text: el.content ?? "",
    };
  }
  if (!isHeadingLike(el)) return null;
  // Grouped headings carry the line as a child; standalone headings link it
  // as a sibling (`linkId`), so both layouts resolve to one state.
  const linked =
    el.linkId != null
      ? flattenElements(els).find(
          (c) => c.id !== el.id && isHeadingDescription(c) && c.linkId === el.linkId,
        )
      : undefined;
  const description = findHeadingDescription(el) ?? linked;
  return {
    heading: el,
    description,
    present: Boolean(description),
    visible: Boolean(description && !description.hidden),
    text: description?.content ?? "",
  };
}

/** Parent group of `id`, or null for a top-level element. */
export function findParent(
  els: CanvasEl[],
  id: string,
): CanvasEl | null {
  for (const el of els) {
    if (el.children?.some((c) => c.id === id)) return el;
    if (el.children?.length) {
      const hit = findParent(el.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

function mapTree(
  els: CanvasEl[],
  id: string,
  fn: (el: CanvasEl) => CanvasEl | null,
): CanvasEl[] {
  let changed = false;
  const walk = (list: CanvasEl[]): CanvasEl[] =>
    list.map((el) => {
      if (el.id === id) {
        changed = true;
        const next = fn(clone(el));
        return next as CanvasEl;
      }
      if (el.children?.length) {
        const kids = walk(el.children);
        if (kids !== el.children) return { ...clone(el), children: kids };
      }
      return el;
    });
  const out = walk(els);
  return changed ? out.filter((el): el is CanvasEl => el !== null) : els;
}

/**
 * Show/hide or rewrite the description of the heading that owns `id`.
 * Hiding keeps the element in the file (one tap brings it back); the text is
 * never re-injected — an author who cleared it stays cleared.
 */
export function setHeadingDescription(
  els: CanvasEl[],
  id: string,
  patch: { text?: string; visible?: boolean },
): CanvasEl[] {
  const state = headingDescriptionState(els, id);
  if (!state || !state.description) return els;
  const descId = state.description.id;
  return mapTree(els, descId, (el) => ({
    ...el,
    ...(patch.text !== undefined ? { content: patch.text } : {}),
    ...(patch.visible !== undefined ? { hidden: !patch.visible } : {}),
  }));
}

/**
 * Remove the description element entirely. The heading keeps its layout; a
 * later «إضافة وصف» recreates the line on demand.
 */
export function removeHeadingDescription(
  els: CanvasEl[],
  id: string,
): { els: CanvasEl[]; removedId: string | null } {
  const state = headingDescriptionState(els, id);
  if (!state?.description) return { els, removedId: null };
  const removedId = state.description.id;
  const headingId = state.heading.id;
  // If the description IS the selection, leaving it selected would show an
  // empty panel — callers reselect the heading.
  const next = mapTree(els, state.heading.id, (el) => ({
    ...el,
    children: el.children?.filter((c) => c.id !== removedId),
  })).filter((el) => el.id !== removedId);
  void headingId;
  return { els: next, removedId };
}

/**
 * Attach a description line to a heading that has none. Grouped headings get
 * an inner text element sized to the group; standalone headings get a linked
 * sibling placed just under the box (linkId keeps the two moving together).
 * Starts HIDDEN — the author opts in to showing it.
 */
export function addHeadingDescription(
  els: CanvasEl[],
  id: string,
  themeInk: string,
): { els: CanvasEl[]; descriptionId: string | null } {
  const state = headingDescriptionState(els, id);
  if (!state || state.description) return { els, descriptionId: state?.description?.id ?? null };
  const heading = state.heading;
  const make = (x: number, y: number, w: number): CanvasEl =>
    createElement(
      "text",
      {
        name: "وصف العنوان",
        x,
        y,
        w,
        h: Math.max(5, Math.min(10, heading.h * 0.35)),
        content: "",
        headingPart: "description",
        hidden: true,
        opacity: 0.78,
        style: {
          fontFamily: "Cairo",
          fontSize: 8.5,
          fontWeight: 600,
          color: themeInk,
          textAlign: "right",
          lineHeight: 1.4,
          textFit: "shrink",
        },
      },
    );

  if (heading.type === "group" && heading.children) {
    const desc = make(0, heading.h, heading.w);
    const next = mapTree(els, heading.id, (el) => ({
      ...el,
      children: [...(el.children ?? []), desc],
    }));
    return { els: next, descriptionId: desc.id };
  }

  const desc = make(heading.x, heading.y + heading.h + 1, heading.w);
  desc.linkId = heading.linkId ?? heading.id;
  const next = els.flatMap((el) =>
    el.id === heading.id
      ? [{ ...clone(el), linkId: desc.linkId }, desc]
      : [el],
  );
  return { els: next, descriptionId: desc.id };
}

/** Human label for the control row. */
export function headingLabel(el: CanvasEl): string {
  return el.name?.trim() || "عنوان";
}
