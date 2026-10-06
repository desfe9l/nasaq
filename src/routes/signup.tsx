import { createFileRoute } from "@tanstack/react-router";
import { SignUpPage } from "@/components/site/SignUpPage";
import { SITE_ORIGIN } from "@/lib/og/share";
import { SIGN_UP_ROUTE } from "@/lib/site-routes";

/**
 * `/signup?redirect=<path>` — account creation with email + password.
 *
 * A first-class destination: linkable, bookmarkable, refreshable, and the
 * `redirect` search parameter carries the page a guarded route was reached from,
 * so a shared link to `/workspace`, `/editor/...` or `/projects/<id>` is honoured
 * after creating an account instead of dropping the visitor on the account page.
 * Only a site-internal path is accepted.
 */
export const Route = createFileRoute("/signup")({
  ssr: false,
  head: () => {
    const title = "إنشاء حساب | نَسَق";
    const description =
      "أنشئ حسابك في نَسَق (NASAQ) بالبريد الإلكتروني وكلمة المرور لحفظ مشاريعك ومستنداتك، والدخول إلى المحرر وأدوات الذكاء الاصطناعي.";
    const url = `${SITE_ORIGIN}${SIGN_UP_ROUTE}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: url },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  validateSearch: (search: Record<string, unknown>) => ({
    redirect:
      typeof search.redirect === "string" && search.redirect.startsWith("/")
        ? search.redirect
        : undefined,
  }),
  component: SignUpRoute,
});

function SignUpRoute() {
  const { redirect } = Route.useSearch();
  return <SignUpPage redirect={redirect} />;
}
