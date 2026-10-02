/**
 * Match a PSD face to a family NASAQ already ships.
 *
 * An unknown face keeps its own name. Substituting Cairo or Tajawal for
 * Arial would move the line breaks, so a missing font stays missing and the
 * report asks the owner to upload it.
 */

import { FONTS } from "../model";

export interface ResolvedFont {
  fontName: string;
  family: string;
  weight: number;
  italic: boolean;
  status: "library" | "missing";
}

const LIBRARY: { family: string; keys: string[] }[] = [
  { family: "Tajawal", keys: ["tajawal"] },
  { family: "Cairo", keys: ["cairo"] },
  { family: "IBM Plex Sans Arabic", keys: ["ibm plex sans arabic", "ibmplexarabic", "plex arabic"] },
  { family: "Noto Sans Arabic", keys: ["noto sans arabic", "notosansarabic"] },
  { family: "Noto Naskh Arabic", keys: ["noto naskh arabic", "notonaskharabic"] },
  { family: "Noto Kufi Arabic", keys: ["noto kufi arabic", "notokufiarabic"] },
  { family: "Amiri", keys: ["amiri"] },
  { family: "Reem Kufi", keys: ["reem kufi", "reemkufi"] },
];

function stripControls(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) out += ch;
  }
  return out;
}

function keyOf(name: string): string {
  return stripControls(name)
    .replace(
      /[-_]?(bold|italic|oblique|regular|medium|light|semibold|semi bold|black|thin|extrabold|extra bold|mt|ps|mtpro)\b/gi,
      " ",
    )
    .replace(/[^a-z0-9\u0600-\u06FF ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function weightOf(name: string, fauxBold: boolean): number {
  const n = name.toLowerCase();
  if (fauxBold || /\b(bold|black|heavy)\b/.test(n)) return 700;
  if (/semi\s?bold|semibold|demi/.test(n)) return 600;
  if (/\bmedium\b/.test(n)) return 500;
  if (/\b(light|thin)\b/.test(n)) return 300;
  return 400;
}

export function resolvePsdFont(
  fontName: string,
  fauxBold: boolean,
  fauxItalic: boolean,
): ResolvedFont {
  const raw = stripControls(String(fontName || "")).trim();
  const requested = raw.slice(0, 80) || "Unknown";
  const key = keyOf(requested);
  const hit = LIBRARY.find((row) => row.keys.some((k) => key === k || key.includes(k)));
  const family = hit && (FONTS as readonly string[]).includes(hit.family) ? hit.family : requested;
  const italic = fauxItalic || /\b(italic|oblique)\b/i.test(requested);
  return {
    fontName: requested,
    family,
    weight: weightOf(requested, fauxBold),
    italic,
    status: hit ? "library" : "missing",
  };
}

export function textDirection(content: string): "rtl" | "ltr" {
  const arabic = (content.match(/[\u0600-\u06FF]/g) || []).length;
  const latin = (content.match(/[A-Za-z]/g) || []).length;
  if (arabic === 0 && latin > 0) return "ltr";
  return "rtl";
}
