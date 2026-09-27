import { createFileRoute } from "@tanstack/react-router";
import { PublicTemplatePage } from "@/components/site/PublicTemplatePage";
import { getPublishedTemplateMetaFn } from "@/lib/admin/functions";
import { publishedTemplateAbsoluteUrl, templateDisplaySlug } from "@/lib/templates/published";

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
    // og:image: use thumbnail if it's https url, else fallback to brand mark
    let ogImage = "https://nasaq-sa.vercel.app/nasaq-mark.svg";
    if (tpl?.thumbnail) {
      if (tpl.thumbnail.startsWith("https://") || tpl.thumbnail.startsWith("http://")) {
        ogImage = tpl.thumbnail;
      } else if (tpl.thumbnail.startsWith("data:image/")) {
        // data URLs are not crawlable for OG, keep fallback but still include data as secondary?
        // We'll keep fallback for crawlers, but also include data URL via meta if possible.
        // For now, keep fallback to ensure WhatsApp etc show brand.
        ogImage = "https://nasaq-sa.vercel.app/nasaq-mark.svg";
      }
    }

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

    // If thumbnail is data URL, also expose it as og:image:secure_url alternative? We'll add second og:image if data
    if (tpl?.thumbnail && tpl.thumbnail.startsWith("data:image/")) {
      // Some platforms accept data URLs, add as additional image
      meta.push({ property: "og:image:alt", content: tpl.title });
    }

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
