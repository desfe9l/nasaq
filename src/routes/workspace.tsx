import { createFileRoute } from "@tanstack/react-router";
import { LicensedWorkspaceHome } from "@/components/site/WorkspaceHomePage";
import { RequireSignedIn } from "@/lib/auth/gates";

/**
 * `/workspace` — مساحة العمل: the licensed account's home before the editor.
 *
 * Recent work, «إنشاء مستند جديد» (which leads to the creation screen), the
 * licensed templates and the way into every other surface. It has its own
 * address so the header's «مساحة العمل» button, a bookmark and a shared link
 * all land on the workspace rather than in an editor session. `/home` — the
 * old address — redirects here.
 */
export const Route = createFileRoute("/workspace")({
  ssr: false,
  head: () => ({ meta: [{ title: "مساحة العمل | نَسَق" }] }),
  component: () => (
    <RequireSignedIn>
      <LicensedWorkspaceHome />
    </RequireSignedIn>
  ),
});
