import { createFileRoute } from "@tanstack/react-router";
import { SharedPersonalTemplatePage, type SharedTemplateCard } from "@/components/site/SharedPersonalTemplatePage";
import { getSharedPersonalTemplateFn } from "@/lib/templates/personal-functions";
import { personalShareAbsoluteUrl } from "@/lib/templates/personal";

export const Route = createFileRoute("/templates/share/$token")({
  ssr: true,
  loader: async ({ params }) => {
    try {
      const result = await getSharedPersonalTemplateFn({ data: { token: params.token } });
      if (!result.ok || !result.template) return { template: null as SharedTemplateCard | null };
      return { template: result.template as SharedTemplateCard };
    } catch {
      return { template: null as SharedTemplateCard | null };
    }
  },
  head: ({ loaderData, params }) => {
    const template = loaderData?.template;
    const url = personalShareAbsoluteUrl(params.token) || "";
    const title = template ? `${template.title} | قالب نَسَق` : "قالب | نَسَق";
    const description = template?.description || "قالب نَسَق قابل للتحرير.";
    const meta: Array<Record<string, string>> = [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:type", content: "website" },
    ];
    if (template?.thumbnail && /^https:\/\//.test(template.thumbnail)) {
      meta.push({ property: "og:image", content: template.thumbnail });
    }
    return { meta, links: url ? [{ rel: "canonical", href: url }] : [] };
  },
  component: ShareRoute,
});

function ShareRoute() {
  const data = Route.useLoaderData();
  return <SharedPersonalTemplatePage template={data.template} unavailable={!data.template} />;
}
