import { createFileRoute, redirect } from "@tanstack/react-router";
import { PublicTemplatePage } from "@/components/site/PublicTemplatePage";
import { getPublishedTemplateMetaFn } from "@/lib/admin/functions";
import { normalizeShortCode } from "@/lib/templates/short-code";
import {
  publishedTemplateAbsoluteUrl,
  templateDisplaySlug,
  templateIdFromShortToken,
} from "@/lib/templates/published";
import { templateShareImage } from "@/lib/templates/share-image";
import type { AdminTemplateSummary } from "@/lib/admin/types";

/**
 * `/t/<code>` — the SHORT public address of a published template.
 *
 * Sharing used to hand out the internal identifier:
 * `/templates/tpl_9f2c1a7e-4b0d-4a55-9c31-0aa9d0b21f44`. This route accepts the
 * seven-character code minted for the row (`/t/k7m2p9q`) and renders the very
 * same template page, server-side, with its own title, description and preview
 * image — so the short link previews correctly in WhatsApp, X and LinkedIn,
 * survives a refresh, and works when opened directly with no client state.
 *
 * The code is stable for the life of the template: it is minted once, stored on
 * the row, and never rotated, so a link that was already sent keeps resolving.
 * The long `/templates/<slug>` address keeps working as well.
 */
export const Route = createFileRoute("/t/$code")({
  ssr: true,
  loader: async ({ params }) => {
    const code = normalizeShortCode(params.code);
    if (code) {
      try {
        const res = await getPublishedTemplateMetaFn({ data: { idOrSlug: code } });
        if (res.ok && res.template) {
          return { template: res.template as AdminTemplateSummary | null };
        }
      } catch {
        /* Fall through: an unknown code and a legacy token share this path. */
      }
    }
    /*
     * COMPATIBILITY — before codes existed, the catalogue minted a reversible
     * 22-character token under this very path (`/t/<token>` → the template's
     * page). Those links are out in the world, so they still land there.
     */
    const legacyId = templateIdFromShortToken(String(params.code ?? ""));
    if (legacyId) {
      throw redirect({
        to: "/templates/$templateId",
        params: { templateId: legacyId },
        replace: true,
      });
    }
    return { template: null as AdminTemplateSummary | null };
  },
  head: ({ loaderData }) => {
    const tpl = loaderData?.template;
    const shortUrl = tpl?.shortCode ? `${originBase()}/t/${tpl.shortCode}` : "";
    /* The descriptive page stays canonical: one indexed address per template. */
    const canonical = tpl ? publishedTemplateAbsoluteUrl(templateDisplaySlug(tpl)) : shortUrl;
    const title = tpl ? `${tpl.title} | نَسَق — قالب جاهز` : "قالب | نَسَق NASAQ";
    const description = tpl?.description?.trim()
      ? tpl.description.trim().slice(0, 160)
      : "قوالب نَسَق الاحترافية — تقارير، خطابات، عروض وإنفوجرافيك جاهزة للتحرير.";
    const share = tpl ? templateShareImage(templateDisplaySlug(tpl), tpl.thumbnail) : null;
    const meta: Array<Record<string, string>> = [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "نَسَق | NASAQ" },
      { property: "og:locale", content: "ar_SA" },
    ];
    if (shortUrl) meta.push({ property: "og:url", content: shortUrl });
    if (share) {
      meta.push(
        { property: "og:image", content: share.url },
        { property: "og:image:secure_url", content: share.url },
        { property: "og:image:type", content: share.type },
        { property: "og:image:width", content: String(share.width) },
        { property: "og:image:height", content: String(share.height) },
        { property: "og:image:alt", content: tpl?.title ?? "قالب نَسَق" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: share.url },
        { name: "twitter:image:alt", content: tpl?.title ?? "قالب نَسَق" },
      );
    }
    return { meta, links: canonical ? [{ rel: "canonical", href: canonical }] : [] };
  },
  component: ShortTemplateRoute,
});

/**
 * Absolute origin for `og:url`. Server-rendered requests carry one; a client
 * navigation falls back to the canonical marketing origin used elsewhere.
 */
function originBase(): string {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "https://nasaq-sa.vercel.app";
}

function ShortTemplateRoute() {
  const { code } = Route.useParams();
  const data = Route.useLoaderData();
  const template = data?.template ?? null;
  /*
   * The page is the template's own page: `PublicTemplatePage` resolves the
   * document by slug or id exactly as `/templates/<slug>` does, so «استخدام
   * القالب» and the preview behave identically from either address.
   */
  const templateId = template ? templateDisplaySlug(template) : code;
  return <PublicTemplatePage templateId={templateId} initialTemplate={template} />;
}
