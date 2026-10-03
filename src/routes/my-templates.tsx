import { createFileRoute } from "@tanstack/react-router";
import { MyTemplatesPage } from "@/components/site/MyTemplatesPage";

export const Route = createFileRoute("/my-templates")({
  ssr: false,
  head: () => ({ meta: [{ title: "قوالبي | نَسَق" }] }),
  component: MyTemplatesPage,
});
