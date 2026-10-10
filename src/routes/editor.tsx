import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/editor")({
  ssr: false,
  component: () => <Outlet />,
});