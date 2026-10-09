import { createFileRoute } from "@tanstack/react-router";
import { TrainingCenterPage } from "@/components/site/TrainingCenterPage";
export const Route = createFileRoute("/training")({
  ssr: false,
  head: () => ({ meta: [{ title: "تدريب مساعدي | نَسَق" }] }),
  component: TrainingCenterPage,
});
