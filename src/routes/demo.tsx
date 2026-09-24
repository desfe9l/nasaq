import { createFileRoute } from "@tanstack/react-router";
import { DemoPage } from "@/components/site/DemoPage";

export const Route = createFileRoute("/demo")({
  ssr: false,
  component: DemoPage,
});