import { createFileRoute } from "@tanstack/react-router";
import { EditorApp } from "@/components/editor/EditorApp";

/**
 * The editor is open to visitors: creating and previewing a design needs no
 * account. The sign-in requirement lives at the download step of the export
 * dialog (`SignInRequiredModal`), which is the only place a file leaves the app.
 */
export const Route = createFileRoute("/editor")({
  ssr: false,
  component: EditorApp,
});
