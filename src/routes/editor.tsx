import { createFileRoute } from "@tanstack/react-router";
import { EditorApp } from "@/components/editor/EditorApp";
import { RequireSignedIn } from "@/lib/auth/gates";

export const Route = createFileRoute("/editor")({
  ssr: false,
  component: () => (
    <RequireSignedIn>
      <EditorApp />
    </RequireSignedIn>
  ),
});
