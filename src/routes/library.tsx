import { createFileRoute } from "@tanstack/react-router";
import { LibraryPage } from "@/components/site/LibraryPage";

/**
 * `/library` — المكتبة: the account's stored assets (logos, images, uploaded
 * icons and dividers) with their folders, usage numbers and backup. Its own
 * address, so «المكتبة» is a destination in the navigation rather than a panel
 * that only exists inside a session.
 */
export const Route = createFileRoute("/library")({
  ssr: false,
  head: () => ({ meta: [{ title: "المكتبة | نَسَق" }] }),
  component: LibraryPage,
});
