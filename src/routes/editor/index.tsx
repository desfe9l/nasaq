import { createFileRoute, Navigate } from "@tanstack/react-router";
import { EditorApp } from "@/components/editor/EditorApp";
import { CREATE_ROUTE } from "@/lib/site-routes";

/**
 * `/editor` — the editor ENTRY, never a blank canvas.
 *
 * Three requests legitimately boot the studio from this address:
 *
 *   · `?showcase=1` (with `?template=` or `?adminTemplate=`) — the marketing
 *     site's live product preview: non-persisting, and the only visitor that
 *     may boot a starter document without choosing anything.
 *   · `?nsq=resume` — a received `.nsq` file already validated and preserved
 *     by `/open`, waiting to be opened by the editor (sign-in returns here).
 *
 * Everything else — a bookmark, a typed address, a link that only knew the
 * editor's home — is sent to the creation screen, where the format, the size
 * and the orientation are chosen before any document exists. A document's own
 * address is `/editor/<projectId>`.
 */
export const Route = createFileRoute("/editor/")({
  ssr: false,
  head: () => ({ meta: [{ title: "المحرر | نَسَق" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    showcase: typeof search.showcase === "string" ? search.showcase : undefined,
    template: typeof search.template === "string" ? search.template : undefined,
    adminTemplate:
      typeof search.adminTemplate === "string" ? search.adminTemplate : undefined,
    nsq: typeof search.nsq === "string" ? search.nsq : undefined,
    project: typeof search.project === "string" ? search.project : undefined,
  }),
  component: EditorEntry,
});

function EditorEntry() {
  const search = Route.useSearch();
  if (search.project) {
    return <Navigate to="/editor/$projectId" params={{ projectId: search.project }} replace />;
  }
  const directBoot =
    search.showcase === "1" ||
    search.nsq === "resume" ||
    Boolean(search.template) ||
    Boolean(search.adminTemplate);
  if (directBoot) return <EditorApp />;
  /* No document was named: configure one first. */
  return <Navigate to={CREATE_ROUTE} replace />;
}
