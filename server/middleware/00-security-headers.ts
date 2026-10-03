/**
 * Global security headers — Nitro middleware (auto-registered because
 * vite.config.ts sets `serverDir: "./server"`; the `00-` prefix orders it
 * before every other middleware).
 *
 * Deliberately written in the same style as `grok-pwa.ts` (the proven
 * middleware in this app): a plain async `(event, next)` function with local
 * types and NO `h3` import. `h3` is a transitive dependency of nitro, and
 * pnpm's strict node_modules on Vercel rejects importing it directly — that
 * was the failed "pnpm run build" (exit 1 in 17s).
 *
 * Every response the handler chain produces gets the headers attached:
 *  - `X-Content-Type-Options: nosniff` — never mime-sniff uploads/exports.
 *  - `X-Frame-Options: DENY` — clickjacking guard (the editor is never
 *    legitimately framed; the live-preview iframe is hosted by the platform
 *    shell, not by this app).
 *  - `Referrer-Policy: strict-origin-when-cross-origin` — internal paths never
 *    leak to third parties via Referer.
 *  - `Permissions-Policy` — camera/mic/geolocation off; the editor needs none.
 *  - HSTS in production only — dev runs plain HTTP on localhost.
 */

interface SecurityEvent {
  req: { headers: Headers };
}

const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  ...(isProd ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {}),
};

export default async function securityHeadersMiddleware(
  _event: SecurityEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const result = await next();
  if (result instanceof Response) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      result.headers.set(name, value);
    }
  }
  return result;
}
