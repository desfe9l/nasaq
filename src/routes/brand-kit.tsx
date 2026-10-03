import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy /brand-kit path — permanently moved to /الهوية.
 * Kept as a redirect so old links and bookmarks keep working.
 */
export const Route = createFileRoute("/brand-kit")({
  beforeLoad: () => {
    throw redirect({ to: "/الهوية", replace: true, statusCode: 301 });
  },
});
