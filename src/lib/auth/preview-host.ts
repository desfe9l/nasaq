/**
 * Hosts that run NASAQ inside the sandbox's isolated live-preview iframe.
 *
 * Arena previews use port-prefixed `*.e2b.app` origins. Keep the previous
 * Grok preview suffix for environments that still use it. Local development
 * and production domains deliberately do not match.
 */
export const LIVE_PREVIEW_HOST_SUFFIXES = [".e2b.app", ".grok-sandbox.com"] as const;

/** Dynamic-base-URL host patterns for the same preview origins. */
export const LIVE_PREVIEW_ALLOWED_HOSTS = [
  "*.e2b.app",
  "*.grok-sandbox.com",
] as const;

/** Both the host match and the browser Origin forms for those hosts. */
export const LIVE_PREVIEW_TRUSTED_ORIGINS = LIVE_PREVIEW_ALLOWED_HOSTS.flatMap(
  (host) => [host, `https://${host}`, `http://${host}`],
);

/** Whether `hostname` is a subdomain on a supported live-preview host. */
export function isLivePreviewHost(hostname: string): boolean {
  const host = String(hostname ?? "").trim().toLowerCase().replace(/\.$/, "");
  return LIVE_PREVIEW_HOST_SUFFIXES.some(
    (suffix) => host.length > suffix.length && host.endsWith(suffix),
  );
}
