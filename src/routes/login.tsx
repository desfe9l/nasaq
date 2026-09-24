import { createFileRoute } from "@tanstack/react-router";
import { SignInPage } from "@/components/site/SignInPage";

export const Route = createFileRoute("/login")({
  ssr: false,
  component: SignInPage,
});
