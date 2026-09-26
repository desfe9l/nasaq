/**
 * Which door the "open the editor" call-to-action uses.
 *
 * The editor route itself has never required an account — what changed is the
 * LINK that leads to it. A signed-in account (licensed, trial, expired, revoked
 * or simply registered without a licence) is taken straight to `/editor`; only a
 * visitor with no session is sent through the limited `/demo` page first.
 *
 * Restrictions are NOT decided here. They are the editor's own business, applied
 * from the server-resolved entitlements (`getLicenseStatusFn` → `setEntitlements`),
 * so this resolver can never widen or narrow what a licence unlocks.
 *
 * Kept import-free and pure so the node test runner can exercise it.
 */

export type EditorEntryState = {
  /** Session still resolving — the caller must not commit to a destination yet. */
  isPending: boolean;
  /** A verified session exists (any licence state, including none). */
  hasUser: boolean;
};

export type EditorEntry =
  | { ready: false }
  | { ready: true; direct: true; href: "/editor"; label: string }
  | { ready: true; direct: false; href: "/demo"; label: string };

/** «افتح المحرر» — a signed-in account walks straight in. */
export const EDITOR_ENTRY_DIRECT_LABEL = "افتح المحرر";
/** «تجربة المحرر» — the limited demo page, for visitors with no session. */
export const EDITOR_ENTRY_DEMO_LABEL = "تجربة المحرر";

export function editorEntryFor(state: EditorEntryState): EditorEntry {
  if (state.isPending) return { ready: false };
  if (state.hasUser) {
    return { ready: true, direct: true, href: "/editor", label: EDITOR_ENTRY_DIRECT_LABEL };
  }
  return { ready: true, direct: false, href: "/demo", label: EDITOR_ENTRY_DEMO_LABEL };
}
