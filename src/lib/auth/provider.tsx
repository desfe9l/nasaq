import type { ReactNode } from "react";
import { SessionWatch } from "./session-watch";

/**
 * App-wide client provider mounted once near the root (in `src/routes/__root.tsx`):
 *
 *   <AuthProvider><Outlet /></AuthProvider>
 *
 * This app's own auth client (`@/lib/auth/client`) needs NO context provider —
 * its `useSession()` works standalone, and the session store it reads is
 * module-scoped, so it is already shared by every route. What DOES need a single
 * mount point is the background revalidation: `<SessionWatch />` keeps the
 * session fresh off the render path and ends it (with a route to sign-in) when
 * the server says the session is gone. Mounting it here means it exists exactly
 * once for the whole app, on every route, including the ones that render no
 * session-aware component at all.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <>
      <SessionWatch />
      {children}
    </>
  );
}
