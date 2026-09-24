import { createFileRoute } from "@tanstack/react-router";
import { CustomDesignPage } from "@/components/site/CustomDesignPage";

export const Route = createFileRoute("/custom-design")({
  ssr: false,
  component: CustomDesignPage,
});
