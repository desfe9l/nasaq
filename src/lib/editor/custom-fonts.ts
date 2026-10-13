/**
 * Persistent custom fonts — خطوط المستخدم المخصصة.
 *
 * Font files imported from the author's device are validated, stored per
 * account (owner-scoped, like every library row), and reloaded into the font
 * library on every later session — so a font imported once is available in
 * every document, on every visit, without re-importing.
 *
 * Persistence rides the EXISTING settings store (`./storage`), which is
 * already owner-scoped and already falls back gracefully when IndexedDB is
 * unavailable. Nothing here touches the document model: a document records
 * only the family name it uses (as always), while the bytes live in the
 * author's own library.
 */

import {
  getSetting,
  setSetting,
  type SettingsKey,
} from "./storage";
import {
  loadEmbeddedFonts,
  rememberUploadedFont,
  uploadedFontSources,
} from "../nsq/fonts";

export const CUSTOM_FONTS_KEY: SettingsKey = "customFonts";

/** Per-file ceiling: large enough for a full Arabic family subset, small enough to stay responsive. */
export const FONT_MAX_FILE_BYTES = 8 * 1024 * 1024;
/** Whole-library ceiling per account. */
export const FONT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
/** Count ceiling per account. */
export const FONT_MAX_COUNT = 40;

export interface CustomFontRecord {
  family: string;
  /** `data:` URL — the same normalised form documents embed. */
  dataUrl: string;
  addedAt: number;
  bytes: number;
  format: FontFormat;
}

export type FontFormat = "truetype" | "opentype" | "woff" | "woff2";

const EXT_FORMAT: Record<string, FontFormat> = {
  ttf: "truetype",
  otf: "opentype",
  woff: "woff",
  woff2: "woff2",
};

function sniffFormat(bytes: Uint8Array): FontFormat | null {
  // wOFF / wOF2 / OTTO / TrueType (00 01 00 00) — the only containers whose
  // metrics the browser FontFace API can actually load from a raw file.
  if (bytes.length < 4) return null;
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag === "wOFF") return "woff";
  if (tag === "wOF2") return "woff2";
  if (tag === "OTTO") return "opentype";
  if (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00)
    return "truetype";
  if (tag === "true" || tag === "ttcf") return "truetype";
  return null;
}

export function fontFamilyFromFileName(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim()
      .slice(0, 60) || "خط مخصص"
  );
}

/**
 * Validate one imported file against format, size and library limits.
 * Returns the ready-to-store record, or throws with a user-facing message.
 */
export async function validateFontFile(
  file: File,
  existing: CustomFontRecord[],
): Promise<Omit<CustomFontRecord, "addedAt">> {
  const format = EXT_FORMAT[(file.name.split(".").pop() || "").toLowerCase()];
  if (!format) throw new Error("صيغة غير مدعومة — المقبول TTF و OTF و WOFF و WOFF2.");
  if (file.size <= 0) throw new Error("ملف الخط فارغ.");
  if (file.size > FONT_MAX_FILE_BYTES)
    throw new Error("حجم ملف الخط يتجاوز الحد (8 ميجابايت).");
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const sniffed = sniffFormat(head);
  if (!sniffed)
    throw new Error("الملف ليس خطًا صالحًا — تأكد من صيغة الملف.");
  if (existing.length >= FONT_MAX_COUNT)
    throw new Error(`بلغت الحد الأقصى لعدد الخطوط (${FONT_MAX_COUNT}).`);
  const total = existing.reduce((sum, f) => sum + (f.bytes || 0), 0);
  if (total + file.size > FONT_MAX_TOTAL_BYTES)
    throw new Error("مساحة مكتبة الخطوط ممتلئة — احذف خطوطًا غير مستخدمة.");
  const family = fontFamilyFromFileName(file.name);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("تعذر قراءة ملف الخط"));
    reader.readAsDataURL(file);
  });
  return { family, dataUrl, bytes: file.size, format: sniffed };
}

function parseRecords(raw: unknown): CustomFontRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomFontRecord[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const family = String(item.family || "").trim();
    const dataUrl = String(item.dataUrl || "");
    // Browsers name the TTF/OTF MIME differently per platform — accept any
    // base64 data URL here; format is enforced at import time (magic bytes).
    if (!family || !/^data:[^;,]+;base64,[A-Za-z0-9+/=]+$/i.test(dataUrl)) continue;
    out.push({
      family,
      dataUrl,
      addedAt: Number(item.addedAt) || 0,
      bytes: Number(item.bytes) || Math.round(dataUrl.length * 0.75),
      format: (["truetype", "opentype", "woff", "woff2"] as FontFormat[]).includes(
        item.format as FontFormat,
      )
        ? (item.format as FontFormat)
        : "truetype",
    });
  }
  return out;
}

/** Read the owner's persisted font library. */
export async function listCustomFonts(): Promise<CustomFontRecord[]> {
  try {
    return parseRecords(await getSetting(CUSTOM_FONTS_KEY));
  } catch {
    return [];
  }
}

/**
 * Store one validated font persistently AND register it with the live session
 * (FontFace + the editor's font list). Same owner-scope check as every other
 * library write — account switches never leak bytes across users.
 */
export async function persistCustomFont(
  record: Omit<CustomFontRecord, "addedAt">,
  register: (family: string) => void,
): Promise<CustomFontRecord> {
  const existing = await listCustomFonts();
  const withoutDuplicate = existing.filter((f) => f.family !== record.family);
  const saved: CustomFontRecord = { ...record, addedAt: Date.now() };
  await setSetting(CUSTOM_FONTS_KEY, [saved, ...withoutDuplicate]);
  await loadEmbeddedFonts([saved], register);
  rememberUploadedFont(saved.family, saved.dataUrl);
  return saved;
}

/** Remove one imported font (bytes and registration) from the library. */
export async function forgetCustomFont(family: string): Promise<void> {
  const existing = await listCustomFonts();
  await setSetting(
    CUSTOM_FONTS_KEY,
    existing.filter((f) => f.family !== family),
  );
}

/**
 * Reload every persisted font into the live session. Called on editor boot and
 * after an account switch; safe to call repeatedly (a family already loaded is
 * re-registered, not re-decoded).
 */
export async function restoreCustomFonts(
  register: (family: string) => void,
  stillCurrent: () => boolean = () => true,
): Promise<string[]> {
  const records = await listCustomFonts();
  if (!records.length) return [];
  const loaded = await loadEmbeddedFonts(records, register, stillCurrent);
  return records.filter((r) => loaded.has(r.family)).map((r) => r.family);
}

/** Session-upload sources (for document embeds) merged with the persisted library. */
export function allUploadedFontSources(): { family: string; dataUrl: string }[] {
  const seen = new Map<string, string>();
  for (const f of uploadedFontSources()) seen.set(f.family, f.dataUrl);
  return [...seen].map(([family, dataUrl]) => ({ family, dataUrl }));
}
