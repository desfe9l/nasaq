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
 *  - Frame protection — `Content-Security-Policy: frame-ancestors …` (the
 *    authoritative check in every current browser) plus `X-Frame-Options` for
 *    the legacy few. Both are host-aware: see `frameAncestors` below.
 *  - `Referrer-Policy: strict-origin-when-cross-origin` — internal paths never
 *    leak to third parties via Referer.
 *  - `Permissions-Policy` — camera/mic/geolocation off; the editor needs none.
 *  - `Content-Security-Policy` — see `contentSecurityPolicy` for exactly what
 *    is allowed and why. Appended (never replacing a route's own stricter CSP,
 *    e.g. `/api/templates/thumbnail`); browsers enforce every CSP header they
 *    receive, so the result is the intersection — strictest wins.
 *  - HSTS in production only — dev runs plain HTTP on localhost.
 */

interface SecurityEvent {
  req: { headers: Headers };
  url?: URL;
}

const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

/* ── Framing ─────────────────────────────────────────────────────────────── */

/**
 * Hosts that legitimately put NASAQ inside an iframe.
 *
 * The live preview (`.e2b.app`, `.grok-sandbox.com`) and the platform shell
 * (`grok.com`, `.grok.me`) frame this app by design — the preview host bridge
 * and the injected `grok-app-builder/extensions.js` both exist because of it.
 * A blanket `frame-ancestors 'none'` would not be "more secure" here, it would
 * be a broken deployment, so the allow-list names exactly those origins and
 * nothing else: any other site trying to frame NASAQ is still refused.
 */
const PLATFORM_FRAME_ANCESTORS = [
  "https://grok.com",
  "https://*.grok.com",
] as const;

const PREVIEW_FRAME_ANCESTORS = [
  "https://*.grok.me",
  "https://*.grok-sandbox.com",
  "https://*.e2b.app",
  "http://localhost:*",
  "http://127.0.0.1:*",
] as const;

const PREVIEW_HOST_SUFFIXES = [".e2b.app", ".grok-sandbox.com"] as const;
const PLATFORM_HOST_SUFFIXES = [".grok.me", ".grok.com"] as const;

function requestHost(event: SecurityEvent): string {
  return String(
    event.req.headers.get("x-forwarded-host") ??
      event.req.headers.get("host") ??
      event.url?.host ??
      "",
  )
    .split(",")[0]
    ?.split(":")[0]
    ?.trim()
    .toLowerCase() ?? "";
}

function endsWithAny(host: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => host.endsWith(suffix));
}

/** `frame-ancestors` for this request, plus the matching legacy XFO value. */
function frameProtection(host: string): { ancestors: string; xfo: string } {
  const embedded =
    endsWithAny(host, PREVIEW_HOST_SUFFIXES) || endsWithAny(host, PLATFORM_HOST_SUFFIXES);
  const ancestors = embedded
    ? ["'self'", ...PLATFORM_FRAME_ANCESTORS, ...PREVIEW_FRAME_ANCESTORS].join(" ")
    : ["'self'", ...PLATFORM_FRAME_ANCESTORS].join(" ");
  return { ancestors, xfo: embedded ? "SAMEORIGIN" : "DENY" };
}

/* ── Content Security Policy ─────────────────────────────────────────────── */

/**
 * The object-storage origin, when R2 is configured. A presigned read URL is the
 * only browser-visible storage address the app ever produces, and it points at
 * the provider's own endpoint — so `connect-src` has to name it or a legitimate
 * asset fetch would be blocked. Server-side env, never a value the client sends.
 */
function objectStorageOrigin(): string | null {
  const explicit = process.env.R2_ENDPOINT?.trim();
  if (explicit) {
    try {
      const url = new URL(/^https?:\/\//i.test(explicit) ? explicit : `https://${explicit}`);
      return url.protocol === "https:" ? url.origin : null;
    } catch {
      return null;
    }
  }
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null;
}

/**
 * Build the CSP for this deployment.
 *
 * WHAT IS STRICT
 *   `default-src 'self'`  — nothing loads from an unlisted origin by default.
 *   `object-src 'none'`   — no plugin/embed content, ever.
 *   `base-uri 'self'`     — an injected `<base>` cannot redirect relative URLs.
 *   `form-action 'self'`  — a form cannot be re-pointed at an attacker origin.
 *   `frame-ancestors`     — see `frameProtection` (clickjacking).
 *   `connect-src`         — an allow-list, so a script that DID run cannot post
 *                           harvested data to an arbitrary origin. This is the
 *                           directive that still pays off when `script-src`
 *                           has to be permissive.
 *
 * WHAT IS DELIBERATELY PERMISSIVE, AND WHY
 *   `script-src 'unsafe-inline'` — TanStack Start streams SSR HTML with inline
 *     `<script data-tsr-stream-part>` payloads and an inline stream-boundary
 *     marker. Those are generated by the framework at response time, so neither
 *     a hash nor a nonce can be attached to them from this middleware; removing
 *     `'unsafe-inline'` does not harden the app, it breaks every page.
 *   `script-src 'unsafe-eval' 'wasm-unsafe-eval'` — the editor's image pipeline
 *     bundles ONNX Runtime Web (WASM) and an `ndarray` view constructor that
 *     compiles with `new Function(…)`. Denying eval silently breaks background
 *     removal and upscaling, i.e. paid editor features. Marginal cost is near
 *     zero alongside `'unsafe-inline'` (an attacker who can inject a script tag
 *     never needed eval); the gain from removing it is only real once the
 *     framework can nonce its streaming scripts.
 *   `script-src https://grok.com` — the platform's `extensions.js`, injected
 *     into every document by `server/middleware/grok-pwa.ts`.
 *   `img-src https:` — documents legitimately embed remote images by URL
 *     (`safeImageSrc` allows `http(s)`), and social crawlers must be able to
 *     read them back. Image loads cannot execute script.
 *   `style-src 'unsafe-inline'` — inline `style` attributes are how the editor
 *     positions every element on the canvas.
 *
 * External origins named below are the app's real runtime dependencies:
 * Google Fonts (stylesheet + font files) and `staticimgly.com`, where
 * `@imgly/background-removal` fetches its ONNX model unless the deployment
 * pins `VITE_NASAQ_BG_MODEL_PUBLIC_PATH` to a same-origin copy.
 */
function contentSecurityPolicy(host: string): string {
  const { ancestors } = frameProtection(host);
  const storage = objectStorageOrigin();
  const connect = [
    "'self'",
    "data:",
    "blob:",
    "https://fonts.googleapis.com",
    "https://fonts.gstatic.com",
    "https://staticimgly.com",
    "https://*.r2.cloudflarestorage.com",
    ...(storage && !storage.endsWith(".r2.cloudflarestorage.com") ? [storage] : []),
  ];
  return [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `form-action 'self'`,
    `manifest-src 'self'`,
    `frame-ancestors ${ancestors}`,
    `img-src 'self' data: blob: https:`,
    `media-src 'self' data: blob:`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://grok.com`,
    `worker-src 'self' blob:`,
    `connect-src ${connect.join(" ")}`,
  ].join("; ");
}

/* ── Middleware ──────────────────────────────────────────────────────────── */

const STATIC_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  ...(isProd ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {}),
};

export default async function securityHeadersMiddleware(
  event: SecurityEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const result = await next();
  if (result instanceof Response) {
    const host = requestHost(event);
    for (const [name, value] of Object.entries(STATIC_HEADERS)) {
      result.headers.set(name, value);
    }
    result.headers.set("x-frame-options", frameProtection(host).xfo);
    // APPEND, not set: a route may already ship a stricter policy of its own
    // (`/api/templates/thumbnail` answers `default-src 'none'; sandbox`).
    // Multiple CSP headers are enforced together, so the intersection applies
    // and the global baseline can never be dropped by a route-level header.
    result.headers.append("content-security-policy", contentSecurityPolicy(host));
  }
  return result;
}
