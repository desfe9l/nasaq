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

  const openNewDocument = useCallback(async () => {
    if (!entry.ready) return;
    if (!entry.direct) {
      window.location.assign(entry.href);
      return;
    }
    // Imported lazily: the site chrome renders on pages that never touch the
    // editor store, and this hook is mounted there.
    const { useEditor } = await import("@/lib/editor/store");
    // A refused create (the free/unlicensed project ceiling) still enters the
    // editor — access is never gated on creating another file.
    await useEditor
      .getState()
      .createProject("blank")
      .catch(() => false);
    window.location.assign("/editor");
  }, [entry]);

  return { entry, openEditor, openNewDocument };
}
