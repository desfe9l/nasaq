import { createFileRoute } from "@tanstack/react-router";
import { PurchasePage } from "@/components/site/PurchasePage";

export const Route = createFileRoute("/purchase")({
  ssr: false,
  component: PurchasePage,
});