import { createFileRoute } from "@tanstack/react-router";

/**
 * `/api/templates/thumbnail?id=…` — a template's preview image as a real URL.
 *
 * WHY THIS EXISTS
 *
 * Social and chat crawlers (WhatsApp, X, LinkedIn, Slack, Telegram) fetch
 * `og:image` themselves and will not follow a `data:` URL — the image simply
 * never appears. A shared template link therefore had to fall back to the
 * platform card, so the recipient saw NASAQ's branding instead of the template
 * the sender actually picked.
 *
 * Preview images are stored with the template record, so this endpoint streams
 * the stored bytes at a stable, crawlable URL and the share route can point
 * `og:image` at the SELECTED template's own preview.
 *
 * Contract:
 *   · `?id=` accepts a published template's slug or id (same lookup the public
 *     page uses), so a share link always resolves.
 *   · Only PUBLISHED rows are served — a draft's image is not public.
 *   · SVG is served as `image/svg+xml` and the payload's own declared mime type
 *     is always honoured; nothing here re-encodes or trusts a client mime.
 *   · Cacheable for an hour: the image is immutable per row, and a crawler
 *     refetching it must not hit the database on every share render.
 *   · No `X-Content-Type-Options: nosniff` override is needed because the
 *     content type comes from the stored payload, never from the request.
 */
export const Route = createFileRoute("/api/templates/thumbnail")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const key = (url.searchParams.get("id") ?? "").trim().slice(0, 200);
        const notFound = () =>
          new Response("not found", {
            status: 404,
            headers: { "cache-control": "no-store" },
          });
        if (!key) return notFound();
        try {
          const { getSql } = await import("@/lib/db");
          const db = await getSql();
          const rows = await db.query<{ thumbnail: string | null }>(
            `SELECT thumbnail FROM admin_templates
             WHERE (slug = $1 OR id = $1) AND status = 'published' LIMIT 1`,
            [key],
          );
          const stored = rows[0]?.thumbnail;
          if (!stored) return notFound();
          // An external `https:` image: hand the crawler the real location
          // rather than proxying remote bytes through the app.
          if (/^https:\/\//i.test(stored)) {
            return new Response(null, {
              status: 302,
              headers: { location: stored, "cache-control": "public, max-age=3600" },
            });
          }
          const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(stored);
          if (!match) return notFound();
          const [, mime, payload] = match;
          const bytes = Buffer.from(payload, "base64");
          if (bytes.byteLength > 8 * 1024 * 1024) return notFound();
          return new Response(bytes, {
            status: 200,
            headers: {
              "content-type": mime.toLowerCase(),
              "content-length": String(bytes.byteLength),
              "cache-control": "public, max-age=3600, immutable",
              "content-security-policy": "default-src 'none'; sandbox",
            },
          });
        } catch {
          return notFound();
        }
      },
    },
  },
});
