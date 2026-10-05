/**
 * Gumroad gateway — server functions (thin RPC wrappers).
 * All server-only work lives in `gateway.server.ts`; this file is safe to
 * import from client components because handlers are extracted at build time.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  gumroadPublicConfig,
} from "./config.server";
import {
  GUMROAD_PLAN_PRICE_CENTS,
  gumroadCheckoutUrl,
  listGumroadPlanKeys,
} from "./mapping";
import type {
  GumroadCheckoutLink,
  GumroadGatewayStatus,
  GumroadPingTestResult,
  GumroadSyncResult,
  GumroadVerificationTestResult,
} from "./types";

type AdminContext = { userId: string; userEmail: string | null };

const adminGate = async (context: AdminContext): Promise<void> => {
  /*
   * Both imports are dynamic: this module is imported by client components, and
   * the authorization context reads the database and the session while the 403
   * shape lives in the Start request runtime. Keeping them out of the module
   * graph is what makes the file browser-safe (the handlers themselves are
   * extracted server-side at build time).
   */
  const { getAuthorizationContext } = await import("@/lib/auth/authorization.server");
  const { denyForbidden } = await import("@/lib/auth/forbidden.server");
  const authorization = await getAuthorizationContext({ id: context.userId, email: context.userEmail });
  if (!authorization.isAdmin) await denyForbidden();
};

export const getGumroadGatewayStatusFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<GumroadGatewayStatus> => {
    await adminGate(context);
    const { buildGumroadGatewayStatus } = await import("./gateway.server");
    return buildGumroadGatewayStatus();
  });

/** Owner "Test Ping": synthetic test=true notification against the LIVE endpoint. */
export const testGumroadPingFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<GumroadPingTestResult> => {
    await adminGate(context);
    const { runGumroadPingTest } = await import("./gateway.server");
    return runGumroadPingTest();
  });

/** Owner "Test purchase verification": the verifier must REJECT unknown data. */
export const testGumroadVerificationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<GumroadVerificationTestResult> => {
    await adminGate(context);
    const { runGumroadVerificationTest } = await import("./gateway.server");
    return runGumroadVerificationTest();
  });

/** Owner "Sync subscription": re-read membership state from the Gumroad API. */
export const syncGumroadSubscriptionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { email: string } => {
    const data = input as Record<string, unknown> | null;
    const email = typeof data?.email === "string" ? data.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) throw new Error("أدخل بريد المشتري كما هو في Gumroad");
    return { email };
  })
  .handler(async ({ context, data }): Promise<GumroadSyncResult> => {
    await adminGate(context);
    const { syncGumroadSubscription } = await import("./gateway.server");
    return syncGumroadSubscription(data.email);
  });

/** Public: the four checkout deep links for the purchase page. */
export const getGumroadCheckoutLinksFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<GumroadCheckoutLink[]> => {
    const config = gumroadPublicConfig();
    return listGumroadPlanKeys().map((planKey) => ({
      planKey,
      url: gumroadCheckoutUrl(planKey, config),
      priceCents: GUMROAD_PLAN_PRICE_CENTS[planKey],
    }));
  },
);
