import { createFileRoute } from "@tanstack/react-router";
import {
  SharedPersonalTemplatePage,
  type SharedTemplateCard,
} from "@/components/site/SharedPersonalTemplatePage";
import { getSharedPersonalTemplateFn } from "@/lib/templates/personal-functions";
import { personalShareAbsoluteUrl } from "@/lib/templates/personal";
import { normalizeShortCode } from "@/lib/templates/short-code";

/**
 * `/s/<code>` — the SHORT public address of a personally shared template.
 *
 * Turning on sharing used to produce `/templates/share/<32-hex-token>`: correct,
 * but far too long to paste into a message or read over the phone. Every shared
 * row now also owns a seven-character code, and this route renders the same
 * sharing surface from it — server-side, so the link previews with the
 * template's own title and image, survives a refresh, and works when opened
 * directly in a new tab with no client state.
 *
 * The legacy `/templates/share/<token>` address keeps resolving exactly as
 * before; a code is never rotated once minted, so an already-sent link is
 * permanent.
 */
export const Route = createFileRoute("/s/$code")({
  ssr: true,
  loader: async ({ params }) => {
    const code = normalizeShortCode(params.code);
    if (!code) return { template: null as SharedTemplateCard | null };
    try {
      const result = await getSharedPersonalTemplateFn({ data: { token: code } });
      if (!result.ok || !result.template) return { template: null as SharedTemplateCard | null };
      return { template: result.template as SharedTemplateCard };
    } catch {
      return { template: null as SharedTemplateCard | null };
    }
  },
  head: ({ loaderData, params }) => {
    const template = loaderData?.template;
    const url = personalShareAbsoluteUrl(params.code) || "";
    const title = template ? `${template.title} | قالب نَسَق` : "قالب | نَسَق";
    const description = template?.description || "قالب نَسَق قابل للتحرير.";
    const meta: Array<Record<string, string>> = [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "نَسَق | NASAQ" },
      { property: "og:locale", content: "ar_SA" },
    ];
    if (url) meta.push({ property: "og:url", content: url });
    if (template?.thumbnail && /^https:\/\//.test(template.thumbnail)) {
      meta.push({ property: "og:image", content: template.thumbnail });
    }
    return { meta, links: url ? [{ rel: "canonical", href: url }] : [] };
  },
  component: ShortShareRoute,
});

function ShortShareRoute() {
  const data = Route.useLoaderData();
  return <SharedPersonalTemplatePage template={data.template} unavailable={!data.template} />;
}
