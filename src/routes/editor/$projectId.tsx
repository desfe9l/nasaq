import { createFileRoute } from "@tanstack/react-router";
import { EditorProjectRoute } from "@/components/editor/EditorProjectRoute";

/**
 * `/editor/<projectId>` — the durable address of ONE document.
 *
 * This is where the editor opens a design: refresh, bookmark, share and the
 * back button all return to the same project. `/editor` alone is the entry and
 * sends an author to the creation screen instead (see `editor/index.tsx`).
 */
export const Route = createFileRoute("/editor/$projectId")({
  ssr: false,
  head: () => ({ meta: [{ title: "المحرر | نَسَق" }] }),
  component: EditorProject,
});

function EditorProject() {
  const { projectId } = Route.useParams();
  return <EditorProjectRoute projectId={projectId} />;
}
