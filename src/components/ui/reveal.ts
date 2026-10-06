import { useEffect, useState } from "react";

/**
 * Reveal a placeholder only after it has actually lasted.
 *
 * A sub-second open must never flash a loading surface, and the moment the
 * work settles this hides IMMEDIATELY — `active` false renders on the same
 * frame. It delays the paint of a placeholder; it never hides work that is
 * still running, and it is not attached to any state machine.
 *
 * Lives beside the components rather than inside `OfflineStatus.tsx` so that
 * file keeps exporting components only (fast refresh).
 */
export function useRevealWhile(active: boolean, delay = 280): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [active, delay]);
  return visible;
}
