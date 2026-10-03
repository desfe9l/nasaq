import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    /**
     * Instant-feeling navigation without a rebuild: prefetch the next route's
     * loader on hover/touch intent, and show a neutral brand skeleton (never a
     * blank page) if a route takes longer than a frame to resolve. Both are
     * router-level — no per-page wiring, no added delay.
     */
    defaultPreload: "intent",
    defaultPendingComponent: () => <PageSkeleton />,
    defaultPendingMs: 120,
    defaultPendingMinMs: 0,
  });
}
