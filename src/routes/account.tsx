import { createFileRoute } from "@tanstack/react-router";
import { AccountPage } from "@/components/site/AccountPage";

export const Route = createFileRoute("/account")({
  ssr: false,
  component: AccountPage,
});