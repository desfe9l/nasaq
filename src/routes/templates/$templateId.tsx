import { createFileRoute } from "@tanstack/react-router";
import { PublicTemplatePage } from "@/components/site/PublicTemplatePage";
import { getPublishedTemplateMetaFn } from "@/lib/admin/functions";
import { publishedTemplateAbsoluteUrl, templateDisplaySlug } from "@/lib/templates/published";
import { templateShareImage } from "@/lib/templates/share-image";

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
     * The share image is the template's OWN preview. SVG thumbnails are
     * rasterised to PNG by `/api/templates/thumbnail`, because chats and
     * tweets do not render SVG. The link itself stays the template page.
     */
    const share = templateShareImage(slug, tpl?.thumbnail);
    const ogImage = share.url;

    const meta: any[] = [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:image", content: ogImage },
      { property: "og:image:secure_url", content: ogImage },
      { property: "og:image:type", content: share.type },
      { property: "og:image:width", content: String(share.width) },
      { property: "og:image:height", content: String(share.height) },
      { property: "og:image:alt", content: tpl?.title ?? "قالب نَسَق" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: canonical },
      { property: "og:site_name", content: "نَسَق | NASAQ" },
      { property: "og:locale", content: "ar_SA" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: ogImage },
      { name: "twitter:image:alt", content: tpl?.title ?? "قالب نَسَق" },
    ];

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
