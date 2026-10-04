import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PublicTemplatePage } from "@/components/site/PublicTemplatePage";
import { TemplateDetailPage } from "@/components/site/TemplateDetailPage";
import { useCatalogEntries } from "@/components/site/useCatalog";
import { useEditor } from "@/lib/editor/store";
import { findEntryBySlug } from "@/lib/templates/entry-slug";
import { hydrateCustomTemplateStore } from "@/lib/templates/custom-templates";
import { getPublishedTemplateMetaFn } from "@/lib/admin/functions";
import { publishedTemplateAbsoluteUrl, templateDisplaySlug } from "@/lib/templates/published";
import { templateShareImage } from "@/lib/templates/share-image";
import { PageSkeleton } from "@/components/ui/Skeleton";

/**
 * `/templates/<idOrSlug>` — a template's OWN page.
 *
 * Two kinds of template answer to this address and both are real destinations:
 *
 *   · a published record from the platform catalogue (SSR-resolved below, so
 *     search engines and social previews see the real title, description and
 *     image), rendered by `PublicTemplatePage`;
 *   · an entry of the local catalogue (starter packs, single pages, the
 *     author's own templates), rendered by `TemplateDetailPage`.
 *
 * Neither opens the editor on arrival. The editor is entered only through
 * «استخدام القالب» / «تعديل القالب», and it then opens the project those
 * actions created — nowhere else.
 */
export const Route = createFileRoute("/templates/$templateId")({
  ssr: true,
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
  const published = loaderData?.template ?? null;
  if (published) {
    return <PublicTemplatePage templateId={templateId} initialTemplate={published} />;
  }
  return <LocalCatalogueTemplate templateId={templateId} />;
}

/**
 * The client-side half: resolve the local catalogue (which is browser state, not
 * server state) and render the template's page. Only when NEITHER kind of
 * template answers does the visitor see the «not available» screen — and that
 * screen never opens an editor either.
 */
function LocalCatalogueTemplate({ templateId }: { templateId: string }) {
  const hydrate = useEditor((s) => s.hydrate);
  const orgName = useEditor((s) => s.orgName);
  const theme = useEditor((s) => s.theme);
  const entries = useCatalogEntries(theme ?? "official", orgName);
  const [catalogueReady, setCatalogueReady] = useState(false);
  const [publishedFallback, setPublishedFallback] = useState<
    null | "missing" | "found"
  >(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    let alive = true;
    // The local catalogue is durable storage: wait for it before deciding the
    // template is gone, or a refresh would flash «غير متاح» for a saved design.
    void hydrateCustomTemplateStore()
      .catch(() => undefined)
      .finally(() => {
        if (alive) setCatalogueReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const entry = useMemo(() => findEntryBySlug(entries, templateId), [entries, templateId]);

  useEffect(() => {
    if (entry || !catalogueReady) return;
    let alive = true;
    void getPublishedTemplateMetaFn({ data: { idOrSlug: templateId } })
      .then((result) => {
        if (!alive) return;
        setPublishedFallback(result.ok && result.template ? "found" : "missing");
      })
      .catch(() => {
        if (alive) setPublishedFallback("missing");
      });
    return () => {
      alive = false;
    };
  }, [entry, catalogueReady, templateId]);

  if (entry) return <TemplateDetailPage slug={templateId} />;

  if (!catalogueReady || publishedFallback === "found") {
    return (
      <div className="min-h-screen bg-paper">
        <PageSkeleton />
      </div>
    );
  }
  if (publishedFallback === null) {
    return (
      <div className="min-h-screen bg-paper">
        <PageSkeleton />
      </div>
    );
  }
  return <PublicTemplatePage templateId={templateId} initialTemplate={null} />;
}
