import { createFileRoute } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { AITemplateStudio } from "@/components/studio/AITemplateStudio";

export const Route = createFileRoute("/studio")({
  ssr: false,
  head: () => ({ meta: [{ title: "استوديو التوليد بالذكاء الاصطناعي | نَسَق" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    prompt: typeof search.prompt === "string" ? search.prompt : undefined,
  }),
  component: StudioRoutePage,
});

function StudioRoutePage() {
  const search = Route.useSearch();
  return (
    <div className="min-h-full bg-paper flex flex-col justify-between">
      <SiteHeader current="/studio" />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 md:py-10 flex-1">
        <AITemplateStudio initialPrompt={search.prompt} />
      </main>
      <SiteFooter />
    </div>
  );
}
