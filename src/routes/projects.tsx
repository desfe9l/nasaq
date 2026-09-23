import { createFileRoute } from "@tanstack/react-router";
import { ProjectsPage } from "@/components/site/ProjectsPage";
import { RequireSignedIn } from "@/lib/auth/gates";

export const Route = createFileRoute("/projects")({
  ssr: false,
  component: () => (
    <RequireSignedIn>
      <ProjectsPage />
    </RequireSignedIn>
  ),
});
