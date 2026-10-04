import { createFileRoute } from "@tanstack/react-router";
import { TemplatesPage } from "@/components/site/TemplatesPage";

/**
 * `/templates` — the template gallery.
 *
 * The filters are addressable (`?pill=custom`, `?q=تقرير`) so a filtered
 * gallery can be linked and bookmarked, and every card points at the
 * template's own page rather than at a transient quick-view.
 */
export const Route = createFileRoute("/templates/")({
  ssr: false,
  head: () => ({ meta: [{ title: "القوالب | نَسَق" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    pill: typeof search.pill === "string" ? search.pill : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  component: TemplatesRoute,
});

function TemplatesRoute() {
  const search = Route.useSearch();
  return <TemplatesPage initialPill={search.pill} initialQuery={search.q} />;
}
