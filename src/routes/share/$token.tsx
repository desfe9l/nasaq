import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy `/share/<token>` — an address older builds handed out for personally
 * shared templates but that no route ever served, so those links 404'd.
 *
 * It now permanently redirects to the sharing surface that does exist. A short
 * code lands on `/s/<code>`; a long legacy token on `/templates/share/<token>`.
 */
export const Route = createFileRoute("/share/$token")({
  beforeLoad: ({ params }) => {
    const key = String(params.token || "").trim();
    const isCode = /^[2-9bcdfghjkmnpqrstvwxz]{6,10}$/.test(key.toLowerCase());
    throw redirect({
      href: isCode ? `/s/${key.toLowerCase()}` : `/templates/share/${encodeURIComponent(key)}`,
      replace: true,
      statusCode: 301,
    });
  },
});
