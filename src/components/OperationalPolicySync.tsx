import { useEffect } from "react";
import { getPublicOperationalLimitsFn } from "@/lib/control-plane/functions";
import { applyPublicOperationalView } from "@/lib/control-plane/snapshot";

/**
 * Pulls the owner's published limits into this browser. The server remains
 * the authority: this only updates local checks such as project and page caps.
 * A failed read leaves the shipped defaults in place.
 */
export function OperationalPolicySync() {
  useEffect(() => {
    let alive = true;
    const pull = () => {
      void getPublicOperationalLimitsFn()
        .then((view) => {
          if (alive && view && typeof view.revision === "number") applyPublicOperationalView(view);
        })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 30_000);
    window.addEventListener("focus", pull);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", pull);
    };
  }, []);
  return null;
}
