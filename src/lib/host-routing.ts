/**
 * Host responsibilities for the one NASAQ deployment.
 *
 * nasaq.team (public) and nasaq.work (workspace) are the same Vercel project,
 * the same database, and the same accounts. This module only decides which
 * surface a hostname is allowed to show. It never creates a second session,
 * and it never puts a visitor-supplied host into a Location or OAuth redirect.
 *
 * Canonical hosts (one hop, no alias loop):
 *   · public    www.nasaq.team   ← nasaq.team
 *     Vercel already 308s the apex to www. The app agrees, so the two layers
 *     cannot bounce.
 *   · workspace nasaq.work       ← www.nasaq.work
 *   · legacy    nasaq-sa.vercel.app, this project's preview hosts, and local
 *     dev keep the full app. Old links must not be sent into a redirect loop.
 *
 * Sessions stay `__Host-` cookies (no Domain attribute). www and apex therefore
 * do not share a cookie jar — alias hosts are redirected before a page can set
 * one. .team and .work are different sites; a cookie is never widened to cover
 * both.
 */

import { isLivePreviewHost } from "./auth/preview-host";

/** Public marketing site. Apex redirects here (matches the existing Vercel 308). */
export const PUBLIC_CANONICAL_HOST = "www.nasaq.team";
export const PUBLIC_ALIAS_HOST = "nasaq.team";
export const PUBLIC_ORIGIN = "https://www.nasaq.team";

/** Member workspace and editor. www redirects here. */
export const WORKSPACE_CANONICAL_HOST = "nasaq.work";
export const WORKSPACE_ALIAS_HOST = "www.nasaq.work";
export const WORKSPACE_ORIGIN = "https://nasaq.work";

/** Backward-compatible production hostname. Served as-is. */
export const LEGACY_PRODUCTION_HOST = "nasaq-sa.vercel.app";
export const LEGACY_PRODUCTION_ORIGIN = "https://nasaq-sa.vercel.app";

const PUBLIC_HOSTS = new Set([PUBLIC_CANONICAL_HOST, PUBLIC_ALIAS_HOST]);
const WORKSPACE_HOSTS = new Set([WORKSPACE_CANONICAL_HOST, WORKSPACE_ALIAS_HOST]);

/**
 * Origins that may present credentials to this deployment. Exact hosts only —
 * no `*.nasaq.team` / `*.nasaq.work`, which would trust a name we do not own.
 */
export const PRODUCT_AUTH_ORIGINS = [
  PUBLIC_ORIGIN,
  `https://${PUBLIC_ALIAS_HOST}`,
  WORKSPACE_ORIGIN,
  `https://${WORKSPACE_ALIAS_HOST}`,
  LEGACY_PRODUCTION_ORIGIN,
] as const;

export const PRODUCT_AUTH_HOSTS = [
  PUBLIC_CANONICAL_HOST,
  PUBLIC_ALIAS_HOST,
  WORKSPACE_CANONICAL_HOST,
  WORKSPACE_ALIAS_HOST,
  LEGACY_PRODUCTION_HOST,
] as const;

/**
 * Member surfaces. On the public host these move to the workspace origin.
 * Anything not listed is left alone — a forgotten editor path must not be
 * rewritten into a marketing page.
 */
const WORKSPACE_PREFIXES = [
  "/workspace",
  "/editor",
  "/projects",
  "/create",
  "/library",
  "/account",
  "/license",
  "/studio",
  "/training",
  "/import",
  "/login",
  "/signup",
  "/open",
  "/admin",
  "/owner-vault",
  "/owner-recovery",
  "/home",
  "/admin-dashboard",
  "/admin-licenses",
] as const;

/**
 * Marketing and acquisition pages. On the workspace host these move to the
 * public origin. Template, share, and `/ai` routes are intentionally absent:
 * members open them from the workspace, and a cross-site bounce would drop
 * the host-only session cookie.
 */
const PUBLIC_PREFIXES = [
  "/pricing",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/custom-design",
  "/demo",
  "/brand-kit",
  "/الهوية",
] as const;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type HostRole = "public" | "workspace" | "legacy" | "unknown";

export type HostRedirect = {
  location: string;
  /** 308 only when the path is unchanged (hostname canonicalisation). */
  status: 307 | 308;
};

type ParsedHost = { hostname: string; host: string };

/** First value of a Host / X-Forwarded-Host header, or null when it is not a host. */
export function parseHostHeader(raw: string | null | undefined): ParsedHost | null {
  if (typeof raw !== "string") return null;
  const first = raw.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!first || first.includes("://") || /[\s/\\@]/.test(first)) return null;
  try {
    const url = new URL(`http://${first}`);
    const hostname = url.hostname;
    if (!hostname || hostname !== hostname.trim()) return null;
    return { hostname, host: url.host };
  } catch {
    return null;
  }
}

export function hostRole(hostname: string): HostRole {
  const host = parseHostHeader(hostname)?.hostname ?? "";
  if (!host) return "unknown";
  if (PUBLIC_HOSTS.has(host)) return "public";
  if (WORKSPACE_HOSTS.has(host)) return "workspace";
  if (isLegacyHostname(host)) return "legacy";
  return "unknown";
}

function isLegacyHostname(hostname: string): boolean {
  if (hostname === LEGACY_PRODUCTION_HOST) return true;
  if (isProjectPreviewHost(hostname)) return true;
  if (LOCAL_HOSTS.has(hostname)) return true;
  return isLivePreviewHost(hostname);
}

/** This project's Vercel preview hosts, not every `*.vercel.app`. */
export function isProjectPreviewHost(hostname: string): boolean {
  const slug = "nasaq-sa";
  return (
    hostname.startsWith(`${slug}-`) &&
    hostname.endsWith(".vercel.app") &&
    hostname.length > `${slug}-.vercel.app`.length
  );
}

function stripTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.replace(/\/+$/, "") || "/";
  return pathname || "/";
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  const path = stripTrailingSlash(pathname);
  return path === prefix || path.startsWith(`${prefix}/`);
}

export type RouteSurface = "workspace" | "public" | "shared";

/** Which surface owns this path. Unknown paths are shared so they are not rewritten. */
export function routeSurface(pathname: string): RouteSurface {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (WORKSPACE_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) return "workspace";
  if (PUBLIC_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) return "public";
  return "shared";
}

function normalizeSearch(search: string | undefined): string {
  if (!search) return "";
  const value = search.trim();
  if (!value || value === "?") return "";
  return value.startsWith("?") ? value : `?${value}`;
}

/**
 * Absolute URL on a fixed origin. Returns null when `pathname` would change
 * the origin (protocol-relative or scheme tricks).
 */
function locationOn(origin: string, pathname: string, search: string): string | null {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return null;
  let dest: URL;
  try {
    dest = new URL(pathname + search, origin);
  } catch {
    return null;
  }
  if (dest.origin !== origin) return null;
  return dest.href;
}

function canonicalOrigin(role: "public" | "workspace"): string {
  return role === "public" ? PUBLIC_ORIGIN : WORKSPACE_ORIGIN;
}

/**
 * Where this request should be sent, or null to serve it here.
 *
 * Unknown hosts, the legacy production hostname, previews, and local dev are
 * never redirected. The Location is always one of the two canonical origins.
 */
export function decideHostRequest(input: {
  hostname?: string | null;
  forwardedHost?: string | null;
  hostHeader?: string | null;
  pathname: string;
  search?: string;
  method?: string;
}): HostRedirect | null {
  const parsed =
    parseHostHeader(input.forwardedHost) ??
    parseHostHeader(input.hostHeader) ??
    parseHostHeader(input.hostname);
  if (!parsed) return null;
  const role = hostRole(parsed.hostname);
  if (role !== "public" && role !== "workspace") return null;

  const pathname = input.pathname.startsWith("/") ? input.pathname : `/${input.pathname}`;
  const search = normalizeSearch(input.search);
  const method = (input.method ?? "GET").toUpperCase();
  const surface = routeSurface(pathname);

  let targetOrigin = canonicalOrigin(role);
  let targetPath = pathname;

  if (role === "workspace" && (pathname === "/" || pathname === "")) {
    targetOrigin = WORKSPACE_ORIGIN;
    targetPath = "/workspace";
  } else if (role === "public" && surface === "workspace") {
    targetOrigin = WORKSPACE_ORIGIN;
  } else if (role === "workspace" && surface === "public") {
    targetOrigin = PUBLIC_ORIGIN;
  }

  const location = locationOn(targetOrigin, targetPath, search);
  if (!location) return null;

  const here = locationOn(`https://${parsed.hostname}`, pathname, search);
  if (here === location) return null;

  const pathChanged = stripTrailingSlash(targetPath) !== stripTrailingSlash(pathname);
  const surfaceMove = pathChanged || targetOrigin !== canonicalOrigin(role);
  const safeMethod = method === "GET" || method === "HEAD";
  if (!safeMethod && surfaceMove) return null;

  return { location, status: surfaceMove ? 307 : 308 };
}

/** Apply a decision to the URL it points at. A correct decision is then null. */
export function followHostRedirect(
  decision: HostRedirect,
  method = "GET",
): HostRedirect | null {
  const url = new URL(decision.location);
  return decideHostRequest({
    hostname: url.hostname,
    pathname: url.pathname,
    search: url.search,
    method,
  });
}

function localOrigin(parsed: ParsedHost): string | null {
  if (!LOCAL_HOSTS.has(parsed.hostname)) return null;
  return `http://${parsed.host}`;
}

/**
 * Origin a credentialed flow (OAuth redirect URI, session cookie host) may use.
 *
 * The request host wins when it is one of ours, so the `__Host-` cookie and
 * the Google redirect URI stay on the host that started sign-in. Anything else
 * returns null — callers fall back to the configured public origin and must
 * not echo an arbitrary Host into `redirect_uri`.
 */
export function resolveCredentialOrigin(request: {
  url: string;
  headers: { get(name: string): string | null };
}): string | null {
  const parsed =
    parseHostHeader(request.headers.get("x-forwarded-host")) ??
    parseHostHeader(request.headers.get("host"));
  let fromUrl: ParsedHost | null = null;
  try {
    fromUrl = parseHostHeader(new URL(request.url).host);
  } catch {
    fromUrl = null;
  }
  const chosen = parsed ?? fromUrl;
  if (!chosen) return null;

  if (PUBLIC_HOSTS.has(chosen.hostname) || WORKSPACE_HOSTS.has(chosen.hostname)) {
    return `https://${chosen.hostname}`;
  }
  if (chosen.hostname === LEGACY_PRODUCTION_HOST || isProjectPreviewHost(chosen.hostname)) {
    return `https://${chosen.hostname}`;
  }
  const local = localOrigin(chosen);
  if (local) return local;
  if (isLivePreviewHost(chosen.hostname)) return `https://${chosen.hostname}`;
  return null;
}
