import { createFileRoute } from "@tanstack/react-router";
import { LicensedWorkspaceHome } from "@/components/site/WorkspaceHomePage";
import { RequireSignedIn } from "@/lib/auth/gates";

/**
 * NASAQ Home — the licensed account's starting point before the editor:
 * introduction, «إنشاء مستند جديد», recent work and the licensed templates.
 * Unlicensed accounts are sent on to `/editor` exactly as before.
 */
export const Route = createFileRoute("/home")({
  ssr: false,
  component: () => (
    <RequireSignedIn>
      <LicensedWorkspaceHome />
    </RequireSignedIn>
  ),
});
