/**
 * The licensed account's front door: the NASAQ Home (`/home`).
 *
 * A licensed (or administrator) account starts from its Home — recent work,
 * «إنشاء مستند جديد» and the licensed templates — before entering the editor.
 * Every other session keeps the doors `editorEntryFor` already resolves
 * (`/editor` for a signed-in account, `/demo` for a visitor), so this hook can
 * never widen or narrow what a licence unlocks: it only picks the landing page.
 *
 * The licence state is the server's (`useLicense` → `getLicenseStatusFn`).
 */

import { useCurrentUserState } from "./use-current-user";
import { useLicense } from "@/lib/license/client";

export const WORKSPACE_HOME_PATH = "/home";

/** Fired on the Home page to open the new-document dialog without a reload. */
export const OPEN_NEW_DOCUMENT_EVENT = "nasaq:new-document";

export type WorkspaceEntry = {
  /** Session and licence resolved — safe to render a destination. */
  ready: boolean;
  /** Active licence or administrator access (not suspended). */
  licensed: boolean;
};

export function useWorkspaceEntry(): WorkspaceEntry {
  const { user, isPending } = useCurrentUserState();
  const license = useLicense(user?.id, user?.primaryEmail ?? null);
  if (isPending) return { ready: false, licensed: false };
  if (!user) return { ready: true, licensed: false };
  if (license.isLoading) return { ready: false, licensed: false };
  return {
    ready: true,
    licensed: !license.isSuspended && (license.hasLicense || license.isAdmin),
  };
}

/**
 * «إنشاء مستند جديد» for a licensed account — always through the configuration
 * dialog on Home. On Home itself the dialog opens in place; anywhere else the
 * Home opens with the dialog already up.
 */
export function openNewDocumentFlow(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === WORKSPACE_HOME_PATH) {
    window.dispatchEvent(new CustomEvent(OPEN_NEW_DOCUMENT_EVENT));
    return;
  }
  window.location.assign(`${WORKSPACE_HOME_PATH}?new=1`);
}
