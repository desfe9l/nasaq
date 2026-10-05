/**
 * Remote/local version conflict handling.
 * Never silently overwrite newer remote data. Surface conflict and require choice.
 */

export interface ConflictInfo {
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  localId: string;
  type: string;
}

/** Compare timestamps with small clock-skew tolerance (2s). */
export function isRemoteNewer(localUpdatedAt: number, remoteUpdatedAt: number | null | undefined): boolean {
  if (remoteUpdatedAt == null) return false;
  return remoteUpdatedAt - localUpdatedAt > 2000;
}

/** Conflict event payload for UI */
export function emitConflict(conflict: ConflictInfo): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("nasaq:sync-conflict", { detail: conflict }));
  console.warn("[offline] sync conflict — remote is newer, local not pushed", conflict);
}
