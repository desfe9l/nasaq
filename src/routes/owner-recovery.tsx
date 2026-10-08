import { createFileRoute } from "@tanstack/react-router";
import { OwnerRecoveryPage } from "@/components/site/OwnerRecoveryPage";
import { RequireSignedIn } from "@/lib/auth/gates";

/**
 * The owner's production recovery console.
 *
 * Deliberately NOT under `/admin`: the account this page exists for is the one
 * the identity migration left WITHOUT administrator authority, so gating it
 * behind the console it is meant to restore would be the same deadlock in a
 * different place. A signed-in session is all the page itself requires — every
 * stage is authorized by the server, and the only stage reachable without
 * existing owner authority is the bootstrap, which applies the full recovery
 * guard (no live administrator, proven orphan or named owner address, written
 * once).
 */
export const Route = createFileRoute("/owner-recovery")({
  ssr: false,
  component: () => (
    <RequireSignedIn>
      <OwnerRecoveryPage />
    </RequireSignedIn>
  ),
});
