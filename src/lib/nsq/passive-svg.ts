/** Conservative, environment-independent passive-SVG validation, not a renderer.
 * Reject executable/remote content instead of silently changing a design. The
 * editor still applies its existing SVG allowlist at the rendering boundary.
 */
import { NsqError } from "./format.ts";
const tags = new Set(
  "svg g defs symbol use title desc path rect circle ellipse line polyline polygon text tspan marker clipPath mask pattern linearGradient radialGradient stop filter feFlood feBlend feColorMatrix feComposite feGaussianBlur feOffset image"
    .toLowerCase()
    .split(" "),
);
const entities = (s: string) =>
  s
    .replace(/&#(x[\da-f]+|\d+);?/gi, (_, code: string) =>
      String.fromCodePoint(
        Math.min(
          0x10ffff,
          code[0].toLowerCase() === "x"
            ? parseInt(code.slice(1), 16)
            : Number(code),
        ),
      ),
    )
    .replace(/&(?:colon|tab|newline);/gi, ":");
export function assertPassiveSvg(svg: string): void {
  const fail = (): never => {
    throw new NsqError(
      "invalid",
      "SVG contains active, external or unsupported content",
    );
  };
  if (
    !/^\s*(?:<\?xml[^?]*\?>\s*)?<svg[\s/>]/i.test(svg) ||
    /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(svg)
  )
    fail();
  const clean = svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?xml[^?]*\?>/g, "");
  const tokens = clean.match(/<[^>]*>/g) || [];
  const stack: string[] = [];
  let roots = 0,
    cursor = 0;
  for (const token of tokens) {
    const at = clean.indexOf(token, cursor);
    if (!stack.length && clean.slice(cursor, at).trim()) fail();
    cursor = at + token.length;
    const match = /^<\/?\s*([\w:-]+)/.exec(token);
    if (!match || !tags.has(match[1].toLowerCase())) fail();
    const tag = match![1].toLowerCase();
    if (token.startsWith("</")) {
      if (stack.pop() !== tag || !/^<\/\s*[\w:-]+\s*>$/.test(token)) fail();
      continue;
    }
    if (!stack.length && (++roots !== 1 || tag !== "svg")) fail();
    if (!/\/\s*>$/.test(token)) stack.push(tag);
    const attrs = token.slice(match![0].length).replace(/\/?\s*>$/, "");
    const seen = new Set<string>();
    let rest = attrs;
    const attrPattern = /\s+([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/g;
    rest = rest.replace(attrPattern, (_, name: string, quoted: string) => {
      const key = name.toLowerCase(),
        value = entities(quoted.slice(1, -1)).trim();
      if (
        seen.has(key) ||
        (key === "xmlns" && value !== "http://www.w3.org/2000/svg")
      )
        fail();
      seen.add(key);
      if (
        key.startsWith("on") ||
        /javascript:|vbscript:|expression\s*\(|@import|\\/i.test(value)
      )
        fail();
      if (
        (key === "href" || key === "xlink:href") &&
        !/^#[\w:.-]+$/.test(value) &&
        !/^data:image\/(png|jpeg|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i.test(
          value,
        )
      )
        fail();
      for (const url of value.matchAll(/url\s*\((.*?)\)/gi))
        if (!/^["']?#[\w:.-]+["']?$/.test(url[1].trim())) fail();
      return "";
    });
    if (rest.trim()) fail();
  }
  if (
    clean.slice(cursor).trim() ||
    stack.length ||
    roots !== 1 ||
    clean.replace(/<[^>]*>/g, "").includes("<")
  )
    fail();
}
