/**
 * Client IP for rate limiting — the parsing rule, in one place.
 *
 * Dependency-free and browser-safe on purpose: server modules that must not
 * drag `@tanstack/react-start/server` into the client graph import THIS and
 * pass their own `getRequest().headers` in. `./request-ip.server` adds the
 * request-context lookup for server-only call sites.
 *
 * WHY THE RULE CHANGED
 *
 * Every throttle in this app read `x-forwarded-for`'s FIRST entry:
 *
 *     headers.get("x-forwarded-for")?.split(",")[0]
 *
 * That value is caller-controlled. A platform proxy APPENDS the real peer
 * address to whatever the client sent, so a request carrying
 * `x-forwarded-for: 1.2.3.4` reaches the function as `1.2.3.4, <real-ip>` — and
 * `[0]` hands the limiter a string the attacker picked. Rotating it makes every
 * per-IP bucket fresh on every request, which defeats precisely the control
 * that is supposed to stop licence-key brute forcing, AI abuse and webhook
 * flooding.
 *
 * The rightmost entry is the one the closest trusted proxy wrote, so that is
 * what this returns. It is still only an IP: on a runtime with no proxy in
 * front the header is entirely caller-supplied and no derivation fixes that —
 * which is why sensitive limits ALSO key on the verified session user id
 * (`rateLimitKey`), a value no header can forge.
 */

/** The rightmost `x-forwarded-for` entry, or `x-real-ip`, or `"unknown"`. */
export function clientIpFromHeaders(headers: Headers | null | undefined): string {
  if (!headers) return "unknown";
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const part = parts[i]?.trim();
      if (part) return part;
    }
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * A rate-limit bucket key that cannot be forged from a header.
 *
 * An authenticated caller is throttled by their verified user id — the one
 * identity in the request that comes from the session rather than the body or a
 * header. Signed-out callers fall back to the IP so they are still bounded.
 */
export function rateLimitKey(userId: string | null | undefined, ip: string): string {
  const user = typeof userId === "string" ? userId.trim() : "";
  return user ? `u:${user}` : `ip:${ip || "unknown"}`;
}
