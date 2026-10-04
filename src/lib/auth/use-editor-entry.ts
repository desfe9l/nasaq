/**
 * Session-aware "open the editor" entry point.
 *
 * One resolver (`editorEntryFor`) decides the destination, so the site chrome,
 * the home starter card and the demo page cannot disagree about where a
 * signed-in account is sent. Licence state plays no part here: an unlicensed,
 * trial, expired or revoked account enters the same `/editor` and keeps the
 * restrictions the server already resolved for it.
 */

import { useCallback } from "react";
import { useCurrentUserState } from "./use-current-user";
import { editorEntryFor, type EditorEntry } from "./editor-entry";
import { CREATE_ROUTE } from "@/lib/site-routes";

export function useEditorEntry(): {
  entry: EditorEntry;
  /** Walk through the door the session earns — no project is created. */
  openEditor: () => void;
  /** «مستند جديد»: create a blank project first, then enter the editor. */
  openNewDocument: () => Promise<void>;
} {
  const { user, isPending } = useCurrentUserState();
  const entry = editorEntryFor({ isPending, hasUser: Boolean(user) });

  const openEditor = useCallback(() => {
    if (!entry.ready) return; // session still resolving — nothing to commit to
    window.location.assign(entry.href);
  }, [entry]);

  /**
   * «إنشاء مستند جديد» — always through the creation screen.
   *
   * Nobody is dropped into an empty canvas: the screen asks for the document
   * type, the page size and the orientation, shows the resulting dimensions,
   * and only then creates the document and opens the editor at its own
   * address. The signed-out visitor gets the same screen with the trial
   * ceilings applied — never a blank project created on their behalf.
   */
  const openNewDocument = useCallback(async () => {
    if (!entry.ready) return;
    window.location.assign(CREATE_ROUTE);
  }, [entry]);

  return { entry, openEditor, openNewDocument };
}
