import { createFileRoute } from "@tanstack/react-router";
import LicensePage from "@/components/license/LicensePage";

export const Route = createFileRoute("/license")({
  ssr: false,
  component: LicensePage,
});
