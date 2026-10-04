import { createFileRoute } from "@tanstack/react-router";
import { SignInPage } from "@/components/site/SignInPage";

/**
 * `/login?redirect=<path>` — the sign-in page carries the destination a guarded
 * page was reached from, so a shared link to `/workspace`, `/projects/<id>` or
 * `/admin/...` is honoured after signing in instead of dropping the visitor on
 * the account page. Only a site-internal path is accepted.
 */
export const Route = createFileRoute("/login")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    redirect:
      typeof search.redirect === "string" && search.redirect.startsWith("/")
        ? search.redirect
        : undefined,
  }),
  component: SignInRoute,
});

function SignInRoute() {
  const { redirect } = Route.useSearch();
  return <SignInPage redirect={redirect} />;
}
