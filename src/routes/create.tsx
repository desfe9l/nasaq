import { createFileRoute } from "@tanstack/react-router";
import { CreateDesignPage, type CreateDesignSearch } from "@/components/site/CreateDesignPage";
import { searchString } from "@/lib/router-search";

/**
 * `/create` — the professional creation screen.
 *
 * Format, page size, orientation and dimensions are chosen and SHOWN here,
 * with a live preview of the exact document that will be created; the editor
 * then opens at that document's own address. This is the door every «إنشاء
 * تصميم» / «مستند جديد» action leads to, and it can be pre-configured through
 * the search parameters (`?start=template&template=official`).
 */
export const Route = createFileRoute("/create")({
  ssr: false,
  head: () => ({ meta: [{ title: "إنشاء تصميم | نَسَق" }] }),
  validateSearch: (search: Record<string, unknown>): CreateDesignSearch => ({
    start:
      search.start === "template" ||
      search.start === "blank" ||
      search.start === "ai" ||
      search.start === "raw"
        ? search.start
        : undefined,
    template: searchString(search.template),
    size: searchString(search.size),
  }),
  component: CreateRoute,
});

function CreateRoute() {
  const search = Route.useSearch();
  return <CreateDesignPage search={search} />;
}
