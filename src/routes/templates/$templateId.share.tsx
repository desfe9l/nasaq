import { createFileRoute } from "@tanstack/react-router";
import { TemplateSharePage } from "@/components/site/TemplateSharePage";

/**
 * `/templates/<idOrSlug>/share` — every template has a linkable, copyable share
 * address. Sending the link shows the template (and its preview) without
 * opening — or touching — anyone's editor, and the recipient decides for
 * themselves whether to use the template.
 */
export const Route = createFileRoute("/templates/$templateId/share")({
  ssr: false,
  head: () => ({ meta: [{ title: "مشاركة قالب | نَسَق" }] }),
  component: ShareRoute,
});

function ShareRoute() {
  const { templateId } = Route.useParams();
  return <TemplateSharePage slug={templateId} />;
}
