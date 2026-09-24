/**
 * The Paylink contract, shared by the server and the browser.
 *
 * These constants must be readable from client components (the admin console
 * prints the webhook path) and from the server (the webhook handler validates
 * against them). Keeping them here — rather than in `server.ts`, which imports
 * `node:crypto` — is what stops a client import from dragging Node built-ins
 * into the browser bundle.
 */

/**
 * Path of NASAQ's Paylink webhook endpoint.
 *
 * One string, so the deploy docs, the admin console and the handler can never
 * drift apart. Register exactly this path in My Paylink → Settings.
 */
export const PAYLINK_WEBHOOK_PATH = "/api/webhooks/paylink";

/**
 * The Payment Webhook version NASAQ requires.
 *
 * Paylink lets a merchant pick `v1` or `v2` per webhook URL (My Paylink →
 * الإعدادات → Webhook). V2 is the only version whose payload carries
 * `apiVersion`, `paymentType` and the merchant identity block, and it is the
 * only one the handler accepts.
 */
export const PAYLINK_WEBHOOK_API_VERSION = "v2";

/** Gateway methods Paylink reports in the V2 `paymentType` field. */
export const PAYLINK_PAYMENT_TYPES = [
  "mada",
  "visaMastercard",
  "stcpay",
  "tabby",
  "tamara",
  "urpay",
  "a2a",
  "amex",
  "sadad",
  "applepay",
] as const;

/** Arabic labels for the gateway methods (admin-facing). */
export const PAYLINK_PAYMENT_TYPE_LABELS: Record<string, string> = {
  mada: "مدى",
  visaMastercard: "فيزا / ماستركارد",
  stcpay: "STC Pay",
  tabby: "تابي",
  tamara: "تمارا",
  urpay: "UrPay",
  a2a: "تحويل لحظي (ANB)",
  amex: "أمريكان إكسبريس",
  sadad: "سداد",
  applepay: "Apple Pay",
};
