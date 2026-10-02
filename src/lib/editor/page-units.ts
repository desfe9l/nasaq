/**
 * Page-size units: mm, cm, in and px in ONE consistent format.
 *
 * The document model stores page geometry in millimetres (print-first), but
 * authors think in different units — a screen designer in px, a print shop in
 * mm, an office author in cm or inches. This module is the single place that
 * converts, formats and remembers the author's preferred unit, so every size
 * field in the product speaks the same language and one stored choice applies
 * everywhere (new-document dialog, page-size fields, the summary readouts).
 *
 * Kept free of React and of the store so the Node test runner can exercise it,
 * like the other pure editor modules.
 */

/** The four units the UI offers. `mm` is the model's own unit. */
export type LengthUnit = "mm" | "cm" | "in" | "px";

export const LENGTH_UNITS: readonly LengthUnit[] = ["mm", "cm", "in", "px"];

export const LENGTH_UNIT_LABELS: Record<LengthUnit, string> = {
  mm: "مليمتر",
  cm: "سنتيمتر",
  in: "بوصة",
  px: "بكسل",
};

/** Millimetres per one unit. CSS px is defined as 1/96 of an inch. */
const MM_PER_UNIT: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
  px: 25.4 / 96,
};

export function isLengthUnit(value: unknown): value is LengthUnit {
  return typeof value === "string" && (LENGTH_UNITS as string[]).includes(value);
}

/** Convert a value expressed in `unit` into the model's millimetres. */
export function toMm(value: number, unit: LengthUnit): number {
  if (!Number.isFinite(value)) return Number.NaN;
  return value * MM_PER_UNIT[unit];
}

/** Convert model millimetres into `unit`. */
export function fromMm(mm: number, unit: LengthUnit): number {
  if (!Number.isFinite(mm)) return Number.NaN;
  return mm / MM_PER_UNIT[unit];
}

/** Decimal places each unit is shown with (px is a whole pixel). */
const UNIT_DECIMALS: Record<LengthUnit, number> = { mm: 1, cm: 2, in: 2, px: 0 };

/** Round a unit value to the precision the UI displays for it. */
export function roundUnit(value: number, unit: LengthUnit): number {
  const factor = 10 ** UNIT_DECIMALS[unit];
  return Math.round(value * factor) / factor;
}

/** Format one millimetre length in `unit` (number only, no unit suffix). */
export function formatLength(mm: number, unit: LengthUnit): string {
  const value = roundUnit(fromMm(mm, unit), unit);
  return String(value);
}

/**
 * One format for every dimension readout: «w × h unit», LTR digits.
 * A single shape everywhere instead of mm-only strings assembled ad hoc.
 */
export function describeSize(
  wMm: number,
  hMm: number,
  unit: LengthUnit,
): string {
  return `${formatLength(wMm, unit)} × ${formatLength(hMm, unit)} ${unit}`;
}

/** The unit suffix alone, for field labels like «العرض (سم)». */
export function unitSymbol(unit: LengthUnit): string {
  return unit;
}

/* -------------------------------------------------------------------------- */
/* The author's stored unit choice                                            */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = "nasaq.units.v1";
export const DEFAULT_LENGTH_UNIT: LengthUnit = "mm";

export function loadLengthUnit(): LengthUnit {
  if (typeof window === "undefined") return DEFAULT_LENGTH_UNIT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isLengthUnit(raw) ? raw : DEFAULT_LENGTH_UNIT;
  } catch {
    return DEFAULT_LENGTH_UNIT;
  }
}

export function saveLengthUnit(unit: LengthUnit): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, unit);
  } catch {
    /* private mode: the session simply starts back on the default */
  }
}

/* -------------------------------------------------------------------------- */
/* Standard paper sizes (mm, portrait-first)                                  */
/* -------------------------------------------------------------------------- */

export interface PagePreset {
  id: string;
  name: string;
  w: number;
  h: number;
}

/**
 * The recognisable sheet sizes, offered as one preset row.
 * Values are the ISO/ANSI definitions in millimetres; the slide is the one
 * screen-native preset (16:9 at 96 dpi).
 */
export const PAGE_PRESETS: readonly PagePreset[] = [
  { id: "a4", name: "A4", w: 210, h: 297 },
  { id: "a3", name: "A3", w: 297, h: 420 },
  { id: "letter", name: "Letter", w: 215.9, h: 279.4 },
  { id: "legal", name: "Legal", w: 215.9, h: 355.6 },
  { id: "slide", name: "16:9", w: 338.7, h: 190.5 },
];

/** The preset whose dimensions match (within half a mm), else null. */
export function presetOf(wMm: number, hMm: number): PagePreset | null {
  const long = Math.max(wMm, hMm);
  const short = Math.min(wMm, hMm);
  return (
    PAGE_PRESETS.find(
      (p) =>
        Math.abs(Math.max(p.w, p.h) - long) < 0.5 &&
        Math.abs(Math.min(p.w, p.h) - short) < 0.5,
    ) ?? null
  );
}
