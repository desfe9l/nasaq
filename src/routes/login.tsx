import { createFileRoute } from "@tanstack/react-router";
import { SignInPage } from "@/components/site/SignInPage";
import { sessionEndedReasonFrom } from "@/lib/auth/session-recovery";

/**
 * `/login?redirect=<path>&ended=<reason>` — the sign-in page carries the
 * destination a guarded page was reached from, so a shared link to `/workspace`,
 * `/projects/<id>` or `/admin/...` is honoured after signing in instead of
 * dropping the visitor on the account page. Only a site-internal path is
 * accepted.
 *
 * `ended` is added when the visitor was sent here by the background session
 * revalidation (`SessionWatch`): the session they were using expired, was
 * revoked, or their account was suspended. The page then says so in plain
 * Arabic instead of silently showing a sign-in form the visitor did not ask for.
 */
export const Route = createFileRoute("/login")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    redirect:
      typeof search.redirect === "string" && search.redirect.startsWith("/")
        ? search.redirect
        : undefined,
    ended: sessionEndedReasonFrom(
      typeof search.ended === "string" ? `ended=${search.ended}` : "",
    ),
  }),
  component: SignInRoute,
});

function SignInRoute() {
  const { redirect, ended } = Route.useSearch();
  return <SignInPage redirect={redirect} ended={ended ?? undefined} />;
}
