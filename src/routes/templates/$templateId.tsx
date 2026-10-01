import { createFileRoute } from "@tanstack/react-router";
import { PublicTemplatePage } from "@/components/site/PublicTemplatePage";
import { getPublishedTemplateMetaFn } from "@/lib/admin/functions";
import { publishedTemplateAbsoluteUrl, templateDisplaySlug } from "@/lib/templates/published";

/**
 * Absolute URL of a template's own preview image.
 *
 * Crawlers fetch `og:image` themselves and ignore `data:` URLs, so the stored
 * preview is served from `/api/templates/thumbnail` — a real, cacheable HTTP
 * address. Without it every shared link fell back to the platform card and the
 * recipient saw NASAQ's branding instead of the template they were sent.
 */
function templateShareImageUrl(idOrSlug: string, thumbnail?: string | null): string {
  const card = `${publishedTemplateAbsoluteUrl(idOrSlug).split("/templates/")[0]}/og.jpg`;
  if (!thumbnail) return card;
  // An SVG preview is a document, not a share image: no major crawler renders
  // `og:image` as SVG, so the platform card is the honest fallback.
  if (thumbnail.startsWith("data:image/svg")) return card;
  const base = publishedTemplateAbsoluteUrl(idOrSlug).split("/templates/")[0];
  return `${base}/api/templates/thumbnail?id=${encodeURIComponent(idOrSlug)}`;
}

export const Route = createFileRoute("/templates/$templateId")({
  ssr: true,
  // SSR enabled for SEO/social preview
  loader: async ({ params }) => {
    const idOrSlug = params.templateId;
    try {
      const res = await getPublishedTemplateMetaFn({ data: { idOrSlug } });
      if (res.ok && res.template) return { template: res.template };
      return { template: null };
    } catch {
      return { template: null };
    }
  },
  head: ({ loaderData, params }) => {
    const tpl = loaderData?.template;
    const slug = tpl ? templateDisplaySlug(tpl) : params.templateId;
    const canonical = publishedTemplateAbsoluteUrl(slug);
    const title = tpl ? `${tpl.title} | نَسَق — قالب جاهز` : "قالب | نَسَق NASAQ";
    const description = tpl?.description?.trim()
      ? tpl.description.trim().slice(0, 160)
      : tpl
        ? `قالب ${tpl.title} من نَسَق — جاهز للتحرير والطباعة، مع دعم كامل للهوية المؤسسية والخطوط العربية.`
        : "قوالب نَسَق الاحترافية — تقارير، خطابات، عروض وإنفوجرافيك جاهزة للتحرير.";
    /*
     * The share image is the template's OWN preview when it has one, served
     * from a crawlable URL; otherwise the platform card (which carries the
     * current NASAQ mark — never the old stand-in logo).
     */
    const ogImage = templateShareImageUrl(slug, tpl?.thumbnail);

    const meta: any[] = [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:image", content: ogImage },
      { property: "og:type", content: "website" },
      { property: "og:url", content: canonical },
      { property: "og:site_name", content: "نَسَق | NASAQ" },
      { property: "og:locale", content: "ar_SA" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: ogImage },
    ];

    meta.push({ property: "og:image:alt", content: tpl?.title ?? "قالب نَسَق" });
    meta.push({ property: "og:image:type", content: ogImage.endsWith(".jpg") ? "image/jpeg" : "image/png" });

    return {
      meta,
      links: [{ rel: "canonical", href: canonical }],
    };
  },
  component: TemplateRouteComponent,
});

function TemplateRouteComponent() {
  const { templateId } = Route.useParams();
  const loaderData = Route.useLoaderData() as { template: any } | undefined;
  return <PublicTemplatePage templateId={templateId} initialTemplate={loaderData?.template ?? null} />;
}
