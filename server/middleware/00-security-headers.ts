/**
 * Global security headers — Nitro/h3 middleware (auto-registered because
 * vite.config.ts sets `serverDir: "./server"`; the `00-` prefix orders it
 * before every other middleware so even early responses carry the headers).
 *
 * Applied to every response, in dev (nitro dev proxy) and production:
 *  - `X-Content-Type-Options: nosniff` — never mime-sniff uploads/exports.
 *  - `X-Frame-Options: DENY` + `frame-ancestors 'none'` — clickjacking guard.
 *  - `Referrer-Policy: strict-origin-when-cross-origin` — paths/queries of
 *    internal URLs never leak to third-party sites via the Referer header.
 *  - `Permissions-Policy` — camera/mic/geolocation stay off; the editor needs
 *    none of them and they widen the attack surface for nothing.
 *  - HSTS in production only — dev runs plain HTTP on localhost.
 *
 * NOTE: frame-ancestors 'none' intentionally DOES ship on document and API
 * responses alike; the live-preview iframe scenario is served by the preview
 * host itself, not by this app, so the editor is never legitimately framed.
 */
import { defineEventHandler, setResponseHeaders } from "h3";

export default defineEventHandler((event) => {
  const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  setResponseHeaders(event, {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    ...(isProd ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {}),
  });
});
