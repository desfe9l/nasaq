import { createFileRoute } from "@tanstack/react-router";
import { PurchasePage } from "@/components/site/PurchasePage";

/**
 * /pricing — alias رسمي لصفحة الاشتراك (/purchase).
 * الصفحة نفسها: عربية بالكامل، RTL، تعرض الباقات وتفتح Gumroad Checkout مباشرة.
 */
export const Route = createFileRoute("/pricing")({
  ssr: false,
  component: PurchasePage,
});
