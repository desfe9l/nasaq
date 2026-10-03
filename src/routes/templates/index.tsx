import { createFileRoute } from "@tanstack/react-router";
import { TemplatesPage } from "@/components/site/TemplatesPage";

export const Route = createFileRoute("/templates/")({
  component: TemplatesPage,
});
