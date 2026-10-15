/**
 * The root session watcher — the "Revalidate" half of Stale-While-Revalidate,
 * and the one place a session the server has disowned is acted on.
 *
 * Mounted once, by `AuthProvider` (see `provider.tsx`), it does three things and
 * renders nothing:
 *
 *   1. KEEPS THE SESSION FRESH IN THE BACKGROUND. A periodic tick, a return to
 *      the tab and a reconnect each fire `revalidateSession()` — never awaited
 *      by a render — so a session revoked while the visitor was reading a page
 *      is noticed without them having to reload. Navigating inside the app never
 *      triggers a request on its own: the store answers from memory inside its
 *      freshness window.
 *
 *   2. ENDS A DISOWNED SESSION. When the server answers "no session" for a
 *      browser that was showing an account (`notifySessionEnded` from
 *      `client.ts`, or a licence the server now reports as cancelled), the local
 *      identity state goes — the editor's user-scoped slices, the storage owner,
 *      the session and licence snapshots, the preview bearer token — and the
 *      visitor is routed to sign-in with the address they were on, so signing
 *      back in returns them exactly there.
 *
 *   3. STAYS OUT OF THE WAY. A first load with no session announces nothing (the
 *      visitor was simply signed out); a gate-materialized session cannot be
 *      ended from the browser at all (the next request re-mints it from
 *      `x-grok-identity`), so it is left alone instead of being half-cleared.
 *
 * The decisions are pure and live in `session-recovery.ts`; this file only wires
 * them to DOM events and navigation.
 */

import { useEffect } from "react";
import {
  SESSION_REVALIDATE_INTERVAL_MS,
  clearLocalIdentityState,
  revalidateSession,
} from "./client";
import { hasGateSessionMarker } from "./gate-session-marker";
import { refreshLicenseState } from "@/lib/license/client";
import { onSessionEnded, signInRedirectFor, type SessionEndedDetail } from "./session-recovery";

/** One teardown at a time: a second revocation must not stack redirects. */
let ending = false;

/**
 * End the session this browser is holding and take the visitor to sign-in.
 *
 * The redirect target keeps the current address (`?redirect=…`), and no redirect
 * happens when the visitor is already on an auth screen — that would only
 * replace the sign-in form with another copy of itself.
 */
async function endSession(detail: SessionEndedDetail): Promise<void> {
  if (ending) return;
  // A gate session is re-materialized by the next request; clearing local state
  // would show a sign-out that does not stick, and routing to /login would bounce
  // straight back. Leave it to the server's own answer on the next request.
  if (hasGateSessionMarker()) return;
  ending = true;
  try {
    await clearLocalIdentityState();
    const target = signInRedirectFor(`${window.location.pathname}${window.location.search}`, {
      reason: detail.reason,
    });
    if (target) window.location.assign(target);
  } catch {
    /* A failed local clear must not strand the visitor on a dead session. */
    const target = signInRedirectFor(`${window.location.pathname}${window.location.search}`, {
      reason: detail.reason,
    });
    if (target) window.location.assign(target);
  } finally {
    // Deliberately NOT reset: once a session has been ended, this document's
    // only remaining job is to navigate. Re-arming could double-redirect if a
    // second probe answered in the meantime.
    void detail;
  }
}

export function SessionWatch() {
  useEffect(() => {
    const probe = () => {
      void revalidateSession();
    };
    const probeNow = () => {
      void revalidateSession({ force: true });
    };
    /**
     * The licence follows the same rhythm on a coarser cadence: an entitlement
     * the server has since revoked (or an administrator's suspension) is then
     * noticed on the next return to the tab instead of at the next reload. The
     * consumers' requests coalesce into one, and the call is a no-op when no
     * licence-aware component is mounted.
     */
    const probeLicense = () => {
      void refreshLicenseState();
    };
    const onVisibility = () => {
      // Only the return to a hidden tab is interesting; every blur/focus pair
      // inside a visible window is not.
      if (document.visibilityState !== "visible") return;
      probe();
      probeLicense();
    };

    // A page that mounts a consumer revalidates on subscribe; this covers the
    // pages that do not (a marketing page, a shared link) and the long-lived tab.
    probe();
    const timer = window.setInterval(() => {
      probeNow();
      probeLicense();
    }, SESSION_REVALIDATE_INTERVAL_MS);
    window.addEventListener("focus", onVisibility);
    document.addEventListener("visibilitychange", onVisibility);
    // Reconnecting is the moment a session that lapsed offline can be settled.
    window.addEventListener("online", probeNow);
    const offEnded = onSessionEnded((detail) => {
      void endSession(detail);
    });

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisibility);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", probeNow);
      offEnded();
    };
  }, []);

  return null;
}
