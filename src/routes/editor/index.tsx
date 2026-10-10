import { createFileRoute, Navigate } from "@tanstack/react-router";
import { EditorApp } from "@/components/editor/EditorApp";
import { CREATE_ROUTE } from "@/lib/site-routes";
import { searchString } from "@/lib/router-search";

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
  // The router's default search parser JSON-parses values, so `?showcase=1`
  // arrives as the NUMBER 1 — `searchString` keeps its text form instead of
  // silently dropping the parameter (which disabled the non-persisting
  // showcase boot entirely). See `src/lib/router-search.ts`.
  validateSearch: (search: Record<string, unknown>) => ({
    showcase: searchString(search.showcase),
    template: searchString(search.template),
    adminTemplate: searchString(search.adminTemplate),
    nsq: searchString(search.nsq),
    project: searchString(search.project),
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
