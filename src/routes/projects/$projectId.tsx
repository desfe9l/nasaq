import { createFileRoute } from "@tanstack/react-router";
import { ProjectDetailPage } from "@/components/site/ProjectDetailPage";

/**
 * `/projects/<projectId>` — a project's own page.
 *
 * Opening a project is a two-step, explicit flow: the shelf lists it, this page
 * describes it, and «فتح في المحرر» opens the editor AT it. Visiting a project
 * page never creates or replaces a document.
 */
export const Route = createFileRoute("/projects/$projectId")({
  ssr: false,
  head: () => ({ meta: [{ title: "مشروع | نَسَق" }] }),
  component: ProjectDetail,
});

function ProjectDetail() {
  const { projectId } = Route.useParams();
  return <ProjectDetailPage projectId={projectId} />;
}
