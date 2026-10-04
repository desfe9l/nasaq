import { createFileRoute, redirect } from "@tanstack/react-router";
import { templateIdFromShortToken } from "@/lib/templates/published";

/** Redirect the compact share URL to the public template detail route. */
export const Route = createFileRoute("/t/$token")({
  loader: ({ params }) => {
    const templateId = templateIdFromShortToken(params.token);
    if (!templateId) throw redirect({ href: "/templates", replace: true });
    throw redirect({
      to: "/templates/$templateId",
      params: { templateId },
      replace: true,
    });
  },
  component: () => null,
});
