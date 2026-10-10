/**
 * Licence scope — "which account ids was this licence verified FOR?"
 *
 * A Keygen licence is only usable by the account it was validated for: the row
 * records that account in `metadata.userScopeVerified`, and the provider's copy
 * of the licence carries `metadata.nasaqUserId`. When the first-party auth
 * migration minted a NEW id for the same person, both markers kept naming the
 * pre-migration id — so the recovered owner's own licence answered "this key
 * does not belong to you", and the entitlement read treated the row as scoped
 * to an id nobody signs in as.
 *
 * The durable owner binding is the proof that lets the scope follow its owner.
 * When the owner's orphaned id is reconciled onto the account they sign in
 * with, the reconciliation records the ids the licence was legitimately
 * verified for in `metadata.ownerReboundFrom` (comma separated). That field is
 * written ONLY by the server-side reconciliation, behind the same guard as the
 * binding itself, so these helpers may trust it — and they are the ONE place
 * the interpretation lives, so activation, revalidation and the entitlement
 * read can never drift apart.
 *
 * Nothing here grants access: a row still has to be ACTIVE and unexpired. It
 * only answers "was this row scoped to THIS owner", including the owner's
 * provable pre-migration id.
 */

/** Metadata key holding the ids a reconciled licence was verified for. */
export const OWNER_REBOUND_FROM = "ownerReboundFrom";

function metadataOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry != null) out[key] = String(entry).trim();
  }
  return out;
}

/**
 * The pre-migration ids this licence was moved from.
 *
 * Only the reconciliation writes this field, and only after the durable owner
 * binding proved the ids belonged to the same person — so a value here is
 * server-held state, exactly like the binding itself.
 */
export function reboundFromIds(metadata: unknown): string[] {
  const raw = metadataOf(metadata)[OWNER_REBOUND_FROM];
  if (!raw) return [];
  return [...new Set(raw.split(",").map((id) => id.trim()).filter((id) => id && id !== "dev-user"))];
}

/**
 * Does a scope marker this licence carries name its current owner — directly,
 * or as one of the orphaned ids the owner binding reconciled?
 */
function markerNamesOwner(marker: string, ownerId: string, rebound: string[]): boolean {
  const value = marker.trim();
  if (!value) return true;
  return value === ownerId.trim() || rebound.includes(value);
}

/**
 * Is a Keygen row still usable by its own owner column?
 *
 * Mirrors the historical check (`userScopeVerified === userId`) with the one
 * addition: a scope marker that names an id the binding proved is this owner's
 * pre-migration id counts as this owner's scope.
 *
 * A Keygen row is only ever written by `persistKeygenLicense`, and only with a
 * successful user-scoped provider validation, so it always carries
 * `userScopeVerified`. Its absence therefore means the row was never verified
 * for ANY account, and an absent marker is NOT proof of ownership — the
 * historical `=== userId` refused it and so does this. (Turning the absence
 * into a grant would let a locally re-pointed `user_id` unlock a key the
 * provider never scoped to the caller.)
 */
export function keygenScopeSatisfied(metadata: unknown, ownerUserId: string): boolean {
  const parsed = metadataOf(metadata);
  const scoped = parsed.userScopeVerified;
  if (!scoped) return false;
  return markerNamesOwner(scoped, ownerUserId, reboundFromIds(metadata));
}

/**
 * Does this licence belong to ANOTHER account than the caller's?
 *
 * Every scope marker the row carries must name the caller (or an id the owner
 * binding reconciled onto them); a marker naming a third party still refuses,
 * so a customer can never inherit someone else's licence.
 */
export function boundToAnotherOwner(
  metadata: unknown,
  rowUserId: string | null | undefined,
  sessionUserId: string,
): boolean {
  const parsed = metadataOf(metadata);
  const rebound = reboundFromIds(metadata);
  if (rowUserId && !markerNamesOwner(rowUserId, sessionUserId, rebound)) return true;
  for (const marker of [parsed.nasaqUserId, parsed.userScopeVerified]) {
    if (marker && !markerNamesOwner(marker, sessionUserId, rebound)) return true;
  }
  return false;
}

/**
 * The `ownerReboundFrom` value a reconciliation should write.
 *
 * Accumulates (a second reconciliation of the same row must not lose the first
 * proof) and never contains the destination id, so the field stays a list of
 * PRE-migration ids.
 */
export function nextReboundFrom(
  metadata: unknown,
  fromIds: readonly string[],
  toUserId: string,
): string | null {
  const existing = reboundFromIds(metadata);
  const next = [...new Set([...existing, ...fromIds])].filter(
    (id) => id && id !== toUserId && id !== "dev-user",
  );
  if (!next.length) return null;
  if (next.length === existing.length && next.every((id, index) => id === existing[index])) {
    return null; // unchanged — no write needed
  }
  return next.join(",");
}

/**
 * SQL twin of {@link keygenScopeSatisfied} for ownership queries.
 *
 * A marker is satisfied when it names the queried account (`$1`) directly, or
 * when it names one of the pre-migration ids the server-side reconciliation
 * recorded in `metadata.ownerReboundFrom` — a field only the reconciliation
 * writes, behind the owner binding, so it is as trustworthy as the binding
 * itself. Everything else still refuses, which keeps the historical protection:
 * a local reassignment of `user_id` can never make someone else's Keygen key
 * usable by the new account.
 *
 * The `userScopeVerified` marker is REQUIRED, matching
 * {@link keygenScopeSatisfied}: a Keygen row is always written with it, so its
 * absence is a row the provider never scoped to any account — refused, never
 * treated as a grant. `nasaqUserId` stays optional because a provider copy may
 * simply omit it.
 *
 * `column` is always a module constant (`metadata` / `l.metadata`), never input.
 */
export function keygenScopeSql(column: string): string {
  const rebound = `coalesce(string_to_array(coalesce(${column}->>'${OWNER_REBOUND_FROM}', ''), ','), '{}')`;
  const namesOwner = (key: string) =>
    `(${column}->>'${key}' = $1 OR ${column}->>'${key}' = ANY(${rebound}))`;
  const optionalNamesOwner = (key: string) =>
    `(${column}->>'${key}' IS NULL OR ${namesOwner(key)})`;
  return `(${optionalNamesOwner("nasaqUserId")} AND ${namesOwner("userScopeVerified")})`;
}
