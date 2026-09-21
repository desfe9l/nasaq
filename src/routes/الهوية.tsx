import { createFileRoute } from "@tanstack/react-router";
import { BrandKitPage } from "@/components/site/BrandKitPage";

/**
 * /الهوية — the brand kit, at an Arabic URL people can actually say out loud.
 * Replaces the legacy /brand-kit route (which now redirects).
 */
export const Route = createFileRoute("/الهوية")({
  component: BrandKitPage,
});
