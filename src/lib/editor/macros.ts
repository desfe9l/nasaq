/**
 * Dynamic text macros.
 *
 * A formal Arabic report repeats the same five facts on every page: the Hijri
 * and Gregorian dates, «صفحة ٣ من ٧», the entity's name and the transaction
 * number. Typing them by hand is how a 40-page report ends up with three
 * different spellings of the entity and a stale date on the cover.
 *
 * A macro is a token the author drops into any text element; it is resolved at
 * RENDER time — canvas, HTML export, Word/PowerPoint writers and the print
 * pipeline all call `resolveMacros` through `prepareText` — so the value is
 * always the live one, and re-opening the document next month shows the new
 * date without touching the text.
 *
 * Resolution is deliberately forgiving: `{التاريخ_الهجري}`,
 * `{ التاريخ الهجري }` and `{التاريخ الهجرى}` all match the same macro, because
 * the token is compared after Arabic normalisation (alef/ya/ta-marbuta forms,
 * tatweel and spacing), not as a raw string.
 */

import { toArabicDigits, toWesternDigits, type Numerals } from "./arabic.ts";

export type MacroId =
  | "hijri_date"
  | "gregorian_date"
  | "page_of_total"
  | "org_name"
  | "transaction_no";

export interface MacroDef {
  id: MacroId;
  /** The canonical token the insert menu writes into the text. */
  token: string;
  label: string;
  hint: string;
  /** What the token looks like once resolved — used by the insert menu. */
  sample: string;
}

export const MACROS: MacroDef[] = [
  {
    id: "hijri_date",
    token: "{التاريخ_الهجري}",
    label: "التاريخ الهجري",
    hint: "تاريخ اليوم بتقويم أم القرى",
    sample: "١٤ محرم ١٤٤٨ هـ",
  },
  {
    id: "gregorian_date",
    token: "{التاريخ_الميلادي}",
    label: "التاريخ الميلادي",
    hint: "تاريخ اليوم بالتقويم الميلادي",
    sample: "٢ سبتمبر ٢٠٢٦",
  },
  {
    id: "page_of_total",
    token: "{رقم_الصفحة_من_الكل}",
    label: "رقم الصفحة من الكل",
    hint: "يتحدّث تلقائيًا في كل صفحة",
    sample: "صفحة 3 من 7",
  },
  {
    id: "org_name",
    token: "{اسم_الجهة}",
    label: "اسم الجهة",
    hint: "اسم الجهة من إعدادات المشروع",
    sample: "أمانة منطقة الحدود الشمالية",
  },
  {
    id: "transaction_no",
    token: "{رقم_المعاملة}",
    label: "رقم المعاملة / الصادر",
    hint: "الرقم الرسمي للمعاملة",
    sample: "١٢٣٤٥٦",
  },
];

/** Suggestion for a project that has not set a transaction number yet. */
export const TRANSACTION_PLACEHOLDER = "……………";

export interface MacroContext {
  /** The date to print; defaults to now. Kept injectable so documents are testable. */
  now?: Date;
  pageNumber?: number;
  pageCount?: number;
  orgName?: string;
  transactionNo?: string;
  /** Numeral style the element uses — macros follow it like any other text. */
  numerals?: Numerals;
}

const AR_MONTHS = [
  "محرم",
  "صفر",
  "ربيع الأول",
  "ربيع الآخر",
  "جمادى الأولى",
  "جمادى الآخرة",
  "رجب",
  "شعبان",
  "رمضان",
  "شوال",
  "ذو القعدة",
  "ذو الحجة",
];

const GREGORIAN_AR_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

/**
 * Gregorian → Hijri by the Kuwaiti (tabular) algorithm.
 *
 * Used when `Intl` has no Umm al-Qura calendar — old engines, some embedded
 * webviews and the Node test runner without full ICU. It agrees with the
 * Umm al-Qura calendar to within a day, which is the right trade for a fallback:
 * a document must never print a blank date.
 */
export function hijriFromDate(date: Date): { y: number; m: number; d: number } {
  const jd =
    Math.floor((date.getTime() + date.getTimezoneOffset() * 60000) / 86400000) +
    2440588;
  const l = jd - 1948440 + 10632;
  const n = Math.floor((l - 1) / 10631);
  let l2 = l - 10631 * n + 354;
  const j =
    Math.floor((10985 - l2) / 5316) * Math.floor((50 * l2) / 17719) +
    Math.floor(l2 / 5670) * Math.floor((43 * l2) / 15238);
  l2 =
    l2 -
    Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
    Math.floor(j / 16) * Math.floor((15238 * j) / 43) +
    29;
  const m = Math.floor((24 * l2) / 709);
  const d = l2 - Math.floor((709 * m) / 24);
  const y = 30 * n + j - 30;
  return { y, m, d };
}

/**
 * Force the element's numeral style onto a formatted date.
 *
 * An unset style means the document's own default, which is Western digits
 * everywhere else in the editor — so a date never arrives in Arabic-Indic
 * numerals on its own and breaks the look of the paragraph it sits in.
 */
function inNumerals(value: string, numerals?: Numerals): string {
  return numerals === "arabic" ? toArabicDigits(value) : toWesternDigits(value);
}

/** «١٢ محرم ١٤٤٨ هـ» — Hijri, in the element's numeral style. */
export function formatHijriDate(date: Date, numerals?: Numerals): string {
  try {
    const formatter = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const parts = formatter.formatToParts(date);
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    const year = parts.find((p) => p.type === "year")?.value;
    if (month && day && year) {
      // `Intl` prints Hijri as «month day year هـ»; Arabic documents put the day
      // first, and NASAQ shows the era marker once, at the end.
      const cleanYear = year.replace(/\s*هـ?\s*/g, "");
      return inNumerals(`${day} ${month} ${cleanYear} هـ`, numerals);
    }
  } catch {
    /* fall through to the arithmetic calendar */
  }
  const h = hijriFromDate(date);
  return inNumerals(`${h.d} ${AR_MONTHS[h.m - 1] ?? ""} ${h.y} هـ`, numerals);
}

/** «٢ سبتمبر ٢٠٢٦» — Gregorian, in Arabic month names. */
export function formatGregorianDate(date: Date, numerals?: Numerals): string {
  const d = date.getDate();
  const month = GREGORIAN_AR_MONTHS[date.getMonth()] ?? "";
  const y = date.getFullYear();
  return inNumerals(`${d} ${month} ${y}`, numerals);
}

/** Normalise a macro name for tolerant matching. */
function macroKey(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/[{}]/g, "")
    .replace(/[\s_\u0640\u200f\u200e]+/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/[ةه]/g, "ه")
    .replace(/[\u064B-\u0652\u0670]/g, "");
}

/** Macro name → id, normalised, derived from `MACROS` so they can never drift. */
const MACRO_LOOKUP: Map<string, MacroId> = new Map(
  MACROS.map((m) => [macroKey(m.token), m.id]),
);

const TOKEN_RE = /\{([^{}\n]{1,40})\}/g;

/** Is this a macro token (rather than a brace the author typed by accident)? */
export function macroIdOf(token: string): MacroId | null {
  return MACRO_LOOKUP.get(macroKey(token)) ?? null;
}

/** True when the text contains at least one recognised macro. */
export function hasMacro(text: string): boolean {
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(String(text ?? "")))) {
    if (macroIdOf(match[1])) return true;
  }
  return false;
}

/** Every macro the text uses, in order of first appearance, de-duplicated. */
export function macroIdsIn(text: string): MacroId[] {
  const found: MacroId[] = [];
  const re = new RegExp(TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(String(text ?? "")))) {
    const id = macroIdOf(match[1]);
    if (id && !found.includes(id)) found.push(id);
  }
  return found;
}

/** Resolved values for one context — the single place the five facts are built. */
export function macroValues(ctx: MacroContext = {}): Record<MacroId, string> {
  const now = ctx.now ?? new Date();
  const numerals = ctx.numerals;
  const page = Math.max(1, Math.round(ctx.pageNumber ?? 1));
  const total = Math.max(page, Math.round(ctx.pageCount ?? page));
  /*
   * One numeral rule for all five macros: `inNumerals` follows the element's
   * style, and an unset style means Western digits — the editor's own default
   * (a numeral style is only applied when the author picks one). A page number
   * that disagreed with the date beside it would be a bug the author could not
   * explain.
   */
  const numbers = `${inNumerals(String(page), numerals)} من ${inNumerals(String(total), numerals)}`;
  return {
    hijri_date: formatHijriDate(now, numerals),
    gregorian_date: formatGregorianDate(now, numerals),
    page_of_total: `صفحة ${numbers}`,
    org_name: (ctx.orgName || "").trim() || "—",
    transaction_no: inNumerals(
      (ctx.transactionNo || "").trim() || TRANSACTION_PLACEHOLDER,
      numerals,
    ),
  };
}

/**
 * Replace every macro token with its live value.
 *
 * Unknown braces are left exactly as typed: refusing to silently delete text the
 * author wrote is more important than tidiness.
 */
export function resolveMacros(text: string, ctx: MacroContext = {}): string {
  const source = String(text ?? "");
  if (!source.includes("{")) return source;
  const values = macroValues(ctx);
  return source.replace(TOKEN_RE, (whole, inner: string) => {
    const id = macroIdOf(inner);
    return id ? values[id] : whole;
  });
}

/** Count of unresolved-placeholder fills — used by the pre-flight checker. */
export function unresolvedMacros(text: string): string[] {
  const source = String(text ?? "");
  const out: string[] = [];
  const re = new RegExp(TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    if (macroIdOf(match[1])) continue; // recognised macro — resolved at render
    out.push(match[0]);
  }
  return out;
}
