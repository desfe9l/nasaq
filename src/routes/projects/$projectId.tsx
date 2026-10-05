import { createFileRoute } from "@tanstack/react-router";
import { ProjectDetailPage } from "@/components/site/ProjectDetailPage";
import { RequireSignedIn } from "@/lib/auth/gates";

/**
 * `/projects/<projectId>` — a project's own page.
 *
 * Opening a project is a two-step, explicit flow: the shelf lists it, this page
 * describes it, and «فتح في المحرر» opens the editor AT it. Visiting a project
 * page never creates or replaces a document.
 *
 * The page belongs to the account that owns the document, so it is guarded
 * exactly like the shelf: a typed URL, a refreshed tab, a Back/Forward step or
 * a shared deep link all pass through the same session check, and a visitor is
 * sent to sign-in (and returned here afterwards) instead of seeing anything.
 */
export const Route = createFileRoute("/projects/$projectId")({
  ssr: false,
  head: () => ({ meta: [{ title: "مشروع | نَسَق" }] }),
  component: ProjectDetail,
});

function ProjectDetail() {
  const { projectId } = Route.useParams();
  return (
    <RequireSignedIn>
      <ProjectDetailPage projectId={projectId} />
    </RequireSignedIn>
  );
}
