import { createFileRoute } from "@tanstack/react-router";
import { RawToDocumentPage } from "@/components/site/RawToDocumentPage";
import { SITE_ORIGIN } from "@/lib/og/share";
import { AI_RAW_ROUTE } from "@/lib/site-routes";

/**
 * `/ai` — «من محتوى خام إلى مستند».
 *
 * The page runs the platform's own pipeline (measure → compose → critic) on the
 * visitor's own text and ends in a real editable NASAQ document, so the demo has
 * to be reachable and indexable as its own address rather than hidden inside a
 * marketing section.
 */
export const Route = createFileRoute("/ai")({
  ssr: false,
  head: () => {
    const title = "من محتوى خام إلى مستند مؤسسي | نَسَق";
    const description =
      "الصق نصًا خامًا — تقريرًا أو محضرًا أو ملاحظات — فيقيسه محرك نَسَق، ويكوّنه مستندًا بمقاس A4، ويعرض «قبل/بعد» بالدرجة والمحاور قبل فتحه في المحرر.";
    const url = `${SITE_ORIGIN}${AI_RAW_ROUTE}`;
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
        { rel: "up", href: `${SITE_ORIGIN}/templates` },
      ],
    };
  },
  component: RawToDocumentPage,
});
