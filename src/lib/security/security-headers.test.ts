/**
 * Security-header middleware — the response contract every deployment ships.
 *
 * The middleware lives in `server/middleware/`, which Nitro auto-registers — so
 * this test cannot sit beside it (every `*.ts` there is loaded as a middleware
 * module and must default-export one). It has no imports of its own, so it runs
 * under the plain Node test runner exactly as Nitro loads it: a `(event, next)`
 * pair that decorates the `Response` the handler chain produced.
 */
import assert from "node:assert/strict";
import test from "node:test";
import securityHeadersMiddleware from "../../../server/middleware/00-security-headers.ts";

const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

async function headersFor(
  host: string,
  init: { forwarded?: string; existing?: Record<string, string> } = {},
): Promise<Headers> {
  const headers = new Headers(init.existing);
  const response = new Response("ok", { headers });
  const event = {
    url: new URL(`https://${host}/`),
    req: {
      headers: new Headers({
        host: init.forwarded ?? host,
        ...(init.forwarded ? { "x-forwarded-host": init.forwarded } : {}),
      }),
    },
  };
  const result = await securityHeadersMiddleware(event, () => response);
  assert.ok(result instanceof Response);
  return result.headers;
}

function directive(csp: string, name: string): string {
  return (
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? ""
  );
}

test("the baseline headers are always present", async () => {
  const h = await headersFor("nasaq-sa.vercel.app");
  assert.equal(h.get("x-content-type-options"), "nosniff");
  assert.equal(h.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(h.get("permissions-policy") ?? "", /camera=\(\)/);
  assert.equal(h.get("strict-transport-security") !== null, isProd);
});

test("a CSP is attached and locks the dangerous defaults", async () => {
  const csp = (await headersFor("nasaq-sa.vercel.app")).get("content-security-policy") ?? "";
  assert.ok(csp.length > 0);
  assert.equal(directive(csp, "default-src"), "default-src 'self'");
  assert.equal(directive(csp, "object-src"), "object-src 'none'");
  assert.equal(directive(csp, "base-uri"), "base-uri 'self'");
  assert.equal(directive(csp, "form-action"), "form-action 'self'");
  // No wildcard script origin: only this app and the platform chrome.
  const script = directive(csp, "script-src");
  assert.match(script, /'self'/);
  assert.match(script, /https:\/\/grok\.com/);
  assert.equal(script.includes("*"), false);
  // The editor's WASM/ONNX pipeline needs these; nothing else may eval.
  assert.match(script, /'wasm-unsafe-eval'/);
});

test("connect-src is an allow-list, so a running script cannot exfiltrate anywhere", async () => {
  const csp = (await headersFor("nasaq-sa.vercel.app")).get("content-security-policy") ?? "";
  const connect = directive(csp, "connect-src");
  assert.match(connect, /'self'/);
  // The background-removal model host and the object-storage origin are named.
  assert.match(connect, /https:\/\/staticimgly\.com/);
  assert.match(connect, /https:\/\/\*\.r2\.cloudflarestorage\.com/);
  // A bare `https:` would defeat the point of the directive.
  assert.equal(connect.split(/\s+/).includes("https:"), false);
});

test("production refuses to be framed except by the platform shell", async () => {
  const h = await headersFor("nasaq-sa.vercel.app");
  const ancestors = directive(h.get("content-security-policy") ?? "", "frame-ancestors");
  assert.match(ancestors, /'self'/);
  assert.match(ancestors, /https:\/\/grok\.com/);
  assert.equal(ancestors.includes("e2b.app"), false);
  assert.equal(h.get("x-frame-options"), "DENY");
});

test("the live preview stays frameable by its own platform hosts", async () => {
  for (const host of ["8080-abc123.e2b.app", "app.preview.grok-sandbox.com"]) {
    const h = await headersFor(host);
    const ancestors = directive(h.get("content-security-policy") ?? "", "frame-ancestors");
    assert.match(ancestors, /https:\/\/\*\.e2b\.app/, host);
    assert.match(ancestors, /https:\/\/\*\.grok-sandbox\.com/, host);
    // Legacy browsers ignore frame-ancestors; SAMEORIGIN keeps the preview
    // working there while still refusing an unrelated site.
    assert.equal(h.get("x-frame-options"), "SAMEORIGIN", host);
  }
});

test("the forwarded host decides the policy, not the URL", async () => {
  const h = await headersFor("nasaq-sa.vercel.app", { forwarded: "8080-abc123.e2b.app" });
  assert.match(
    directive(h.get("content-security-policy") ?? "", "frame-ancestors"),
    /https:\/\/\*\.e2b\.app/,
  );
});

test("a route's own stricter CSP is kept alongside the global one", async () => {
  /*
   * `/api/templates/thumbnail` answers `default-src 'none'; sandbox`. Browsers
   * enforce every CSP header they receive, so appending — never replacing —
   * means the intersection applies and a route cannot drop the baseline.
   */
  const h = await headersFor("nasaq-sa.vercel.app", {
    existing: { "content-security-policy": "default-src 'none'; sandbox" },
  });
  const values = h.get("content-security-policy") ?? "";
  assert.ok(values.includes("default-src 'none'; sandbox"));
  assert.ok(values.includes("frame-ancestors"));
});

test("an object-storage endpoint override is reflected in connect-src", async () => {
  const saved = process.env.R2_ENDPOINT;
  try {
    process.env.R2_ENDPOINT = "https://r2.example-jurisdiction.test";
    const csp = (await headersFor("nasaq-sa.vercel.app")).get("content-security-policy") ?? "";
    assert.match(directive(csp, "connect-src"), /https:\/\/r2\.example-jurisdiction\.test/);
  } finally {
    if (saved === undefined) delete process.env.R2_ENDPOINT;
    else process.env.R2_ENDPOINT = saved;
  }
});

test("no secret value is ever emitted into a header", async () => {
  const saved = { ...process.env };
  try {
    process.env.R2_SECRET_ACCESS_KEY = "super-secret-value";
    process.env.BETTER_AUTH_SECRET = "another-secret-value";
    process.env.GOOGLE_CLIENT_SECRET = "google-secret-value";
    const h = await headersFor("nasaq-sa.vercel.app");
    const blob = [...h.entries()].map(([k, v]) => `${k}: ${v}`).join("\n").toLowerCase();
    assert.equal(blob.includes("super-secret-value"), false);
    assert.equal(blob.includes("another-secret-value"), false);
    assert.equal(blob.includes("google-secret-value"), false);
  } finally {
    process.env = saved;
  }
});
