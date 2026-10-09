/** Untrusted model geometry, expressed as percentages of the existing canvas.
 * No HTML, URLs, executable styles, IDs or storage references cross this boundary.
 */
export interface DesignCompositionElement {
  type: "text" | "shape" | "table";
  x: number;
  y: number;
  w: number;
  h: number;
  content: string;
  role: "display" | "body" | "meta";
  fill: "paper" | "field" | "accent" | "none";
  color: "ink" | "onField" | "accent";
  shape: "rect" | "circle" | "diamond";
}
export interface DesignComposition {
  elements: DesignCompositionElement[];
}

/** Reject an incomplete plan; never silently substitute a stock composition. */
export function normalizeCompositions(
  value: unknown,
  pages: number,
): DesignComposition[] {
  if (!Array.isArray(value) || value.length !== pages)
    throw new Error("invalid_composition");
  return value.map((page) => {
    if (
      !page ||
      !Array.isArray(page.elements) ||
      page.elements.length < 2 ||
      page.elements.length > 32
    )
      throw new Error("invalid_composition");
    const elements = page.elements.map(
      (raw: Record<string, unknown>): DesignCompositionElement => {
        if (
          !raw ||
          (raw.type !== "text" && raw.type !== "shape" && raw.type !== "table")
        )
          throw new Error("invalid_composition");
        const { x, y, w, h } = raw;
        if (
          ![x, y, w, h].every(
            (n) => typeof n === "number" && Number.isFinite(n),
          ) ||
          (x as number) < 0 ||
          (y as number) < 0 ||
          (w as number) < 1 ||
          (h as number) < 1 ||
          (x as number) + (w as number) > 100 ||
          (y as number) + (h as number) > 100
        )
          throw new Error("invalid_composition");
        const content =
          typeof raw.content === "string"
            ? raw.content.trim().slice(0, 1200)
            : "";
        if ((raw.type === "text" || raw.type === "table") && !content)
          throw new Error("invalid_composition");
        if (raw.type === "table") {
          const rows = content.split("\n").map((row) => row.split("\t"));
          if (
            rows.length < 2 ||
            rows.length > 12 ||
            rows[0].length < 2 ||
            rows[0].length > 6 ||
            rows.some((row) => row.length !== rows[0].length)
          )
            throw new Error("invalid_composition");
        }
        return {
          type: raw.type,
          x: x as number,
          y: y as number,
          w: w as number,
          h: h as number,
          content,
          role:
            raw.role === "display" || raw.role === "meta" ? raw.role : "body",
          fill:
            raw.fill === "field" || raw.fill === "accent" || raw.fill === "none"
              ? raw.fill
              : "paper",
          color:
            raw.color === "onField" || raw.color === "accent"
              ? raw.color
              : "ink",
          shape:
            raw.shape === "circle" || raw.shape === "diamond"
              ? raw.shape
              : "rect",
        };
      },
    );
    if (!elements.some((el: DesignCompositionElement) => el.type === "text"))
      throw new Error("invalid_composition");
    return { elements };
  });
}

/** Ignores copy, colours, generated IDs and decoration: compare actual geometry. */
export function compositionSignature(
  pages: readonly DesignComposition[],
): string {
  return JSON.stringify(
    pages.map((p) =>
      p.elements.map(({ type, x, y, w, h }) => [type, x, y, w, h]),
    ),
  );
}
