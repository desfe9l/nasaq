import { createFileRoute } from "@tanstack/react-router";
import { TemplateCategoryPage } from "@/components/site/TemplateCategoryPage";
import { categorySurface } from "@/lib/templates/category-pages";
import { TEMPLATES_ROUTE, categoryPathFor } from "@/lib/site-routes";
import { SITE_ORIGIN } from "@/lib/og/share";

/**
 * `/templates/category/<id>` — one template category as a real page.
 *
 * The six public surfaces are declared in `category-pages.ts`, and each maps to
 * one or more of the generator's own `TEMPLATE_CATEGORIES` — so a category page
 * can never list templates the library does not have. An unknown id is not a
 * dead end: the page renders its own «فئة غير معروفة» surface with a way back to
 * `/templates`.
 */
export const Route = createFileRoute("/templates/category/$categoryId")({
  ssr: false,
  head: ({ params }) => {
    const surface = categorySurface(params.categoryId);
    const title = surface ? `${surface.title} — قوالب نَسَق` : "فئة قوالب | نَسَق";
    const description =
      surface?.purpose ||
      "تصفح فئات قوالب نَسَق الجاهزة للتقارير والمستندات المؤسسية.";
    const url = `${SITE_ORIGIN}${categoryPathFor(params.categoryId)}`;
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
      links: [
        { rel: "canonical", href: url },
        // The gallery is the parent surface of every category.
        { rel: "up", href: `${SITE_ORIGIN}${TEMPLATES_ROUTE}` },
      ],
    };
  },
  component: CategoryRoute,
});

function CategoryRoute() {
  const { categoryId } = Route.useParams();
  return <TemplateCategoryPage categoryId={categoryId} />;
}
