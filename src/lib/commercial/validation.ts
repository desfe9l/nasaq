/**
 * Shared input validators for the admin server functions.
 *
 * Kept in one module so every admin handler trims and bounds its inputs the same
 * way — inconsistent per-handler limits are how one endpoint ends up accepting a
 * 10 MB "note".
 */

/** A required, trimmed, length-bounded identifier. */
export function requireId(value: unknown, message: string): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) throw new Error(message);
  return id;
}

/**
 * An optional free-text note.
 *
 * Returns `null` (not `undefined`) for an empty note: the server modules type
 * this as `string | null` to match the nullable `admin_note` column, so `null`
 * is the one representation of "no note" all the way to the database. Without
 * this, `undefined` reaches the SQL layer as an unbound parameter.
 */
export function optionalNote(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** A positive whole number of days, bounded to a sane maximum (10 years). */
export function requirePositiveDays(value: unknown, max = 3650): number {
  const days = Number(value);
  if (!Number.isInteger(days) || days <= 0 || days > max) {
    throw new Error("عدد الأيام غير صالح.");
  }
  return days;
}