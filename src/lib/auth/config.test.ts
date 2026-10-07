import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  authAllowedHosts,
  authBaseURL,
  authEnvironmentReport,
  authProviderFlags,
  authTrustedOrigins,
  describeAuthEnvironment,
  hostOf,
  originOf,
  parseEnvList,
  resolveAuthSecret,
  MIN_SECRET_LENGTH,
} from "./config.ts";

/** A realistic production deployment environment. */
const PRODUCTION = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_URL: "nasaq-sa-abc123-team.vercel.app",
  VERCEL_PROJECT_PRODUCTION_URL: "nasaq-sa.vercel.app",
  BETTER_AUTH_URL: "https://nasaq-sa.vercel.app",
  BETTER_AUTH_SECRET: "9f2c1a7e4b0d4a559c310aa9d0b21f44",
  R2_ACCOUNT_ID: "account-id",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "secret-key",
} satisfies Record<string, string>;

describe("environment helpers", () => {
  it("reads an origin from a full URL and from a bare host", () => {
    assert.equal(originOf("https://nasaq-sa.vercel.app/login?x=1"), "https://nasaq-sa.vercel.app");
    assert.equal(originOf("nasaq.app"), "https://nasaq.app");
    assert.equal(originOf("  "), null);
    assert.equal(originOf("ftp://example.com"), null);
  });

  it("parses comma/space separated lists without duplicates", () => {
    assert.deepEqual(parseEnvList("a, b  c,,a"), ["a", "b", "c"]);
    assert.deepEqual(parseEnvList(undefined), []);
  });

  it("keeps the port when it is part of the host", () => {
    assert.equal(hostOf("http://localhost:8080/x"), "localhost:8080");
  });
});

describe("signing secret", () => {
  it("reports a configured secret", () => {
    assert.deepEqual(resolveAuthSecret(PRODUCTION), {
      value: PRODUCTION.BETTER_AUTH_SECRET,
      status: "configured",
    });
  });

  it("flags an unset secret instead of inventing one", () => {
    const env: Record<string, string | undefined> = { ...PRODUCTION };
    delete env.BETTER_AUTH_SECRET;
    assert.deepEqual(resolveAuthSecret(env), { value: null, status: "unset" });
  });

  it("refuses a session secret shared with the OAuth client secret", () => {
    const shared = "same-value-everywhere-0123456789abcdef";
    assert.equal(
      resolveAuthSecret({
        BETTER_AUTH_SECRET: shared,
        GOOGLE_CLIENT_SECRET: shared,
      }).status,
      "reused-oauth-secret",
    );
  });

  it("flags a weak secret but still returns it (rotating would drop live sessions)", () => {
    const result = resolveAuthSecret({ BETTER_AUTH_SECRET: "short" });
    assert.equal(result.status, "weak");
    assert.equal(result.value, "short");
  });
});

describe("provider flags", () => {
  it("counts email/password as a provider even with no OAuth credentials", () => {
    assert.deepEqual(authProviderFlags({}), { google: false, emailPassword: true });
  });

  it("requires BOTH Google values", () => {
    assert.equal(authProviderFlags({ GOOGLE_CLIENT_ID: "id" }).google, false);
    assert.equal(
      authProviderFlags({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }).google,
      true,
    );
  });
});

describe("base URL and trusted origins", () => {
  it("pins the public origin when one is configured", () => {
    assert.equal(authBaseURL(PRODUCTION), "https://nasaq-sa.vercel.app");
  });

  it("trusts the platform URL of the same deployment", () => {
    const origins = authTrustedOrigins(PRODUCTION);
    assert.ok(origins.includes("https://nasaq-sa-abc123-team.vercel.app"));
  });

  it("trusts this project's preview deployments — and nothing else on vercel.app", () => {
    const origins = authTrustedOrigins(PRODUCTION);
    assert.ok(origins.includes("https://nasaq-sa-*.vercel.app"));
    assert.ok(!origins.includes("https://*.vercel.app"));
  });

  it("accepts operator-supplied origins, patterns and bare hosts", () => {
    const origins = authTrustedOrigins({
      ...PRODUCTION,
      NASAQ_TRUSTED_ORIGINS: "https://nasaq.app, *.nasaq.sa, staging.internal",
    });
    assert.ok(origins.includes("https://nasaq.app"));
    assert.ok(origins.includes("https://*.nasaq.sa"));
    assert.ok(origins.includes("http://*.nasaq.sa"));
    assert.ok(origins.includes("https://staging.internal"));
  });

  it("keeps local development origins so npm run dev can sign in", () => {
    const origins = authTrustedOrigins(PRODUCTION);
    assert.ok(origins.includes("http://localhost:8080"));
    assert.ok(origins.includes("http://127.0.0.1:8080"));
  });

  it("keeps the live-preview iframe origins", () => {
    const origins = authTrustedOrigins({});
    assert.ok(origins.includes("https://*.e2b.app"));
  });

  it("derives dynamic-base-URL host patterns with no scheme", () => {
    const hosts = authAllowedHosts(PRODUCTION);
    assert.ok(hosts.includes("nasaq-sa.vercel.app"));
    assert.ok(hosts.includes("localhost"));
    assert.ok(hosts.includes("nasaq-sa-*.vercel.app"));
    assert.ok(hosts.every((host) => !host.includes("://")));
  });
});

describe("production environment report", () => {
  it("is OK for a complete deployment", () => {
    const report = authEnvironmentReport(PRODUCTION);
    assert.equal(report.ok, true, report.errors.join(" | "));
    assert.deepEqual(report.providers, { google: false, emailPassword: true });
  });

  it("does NOT block a deployment just because BETTER_AUTH_SECRET is unset", () => {
    // Sessions are opaque server-side tokens stored in the identity backend —
    // they are not signed cookies — so a missing signing secret changes nothing
    // about whether a visitor can sign in. It is reported, never required.
    const env: Record<string, string | undefined> = { ...PRODUCTION };
    delete env.BETTER_AUTH_SECRET;
    const report = authEnvironmentReport(env);
    assert.equal(report.ok, true, report.errors.join(" | "));
    assert.ok(!report.errors.some((error) => error.includes("BETTER_AUTH_SECRET")));
    assert.ok(report.warnings.some((warning) => warning.includes("BETTER_AUTH_SECRET")));
  });

  it("blocks a deployment with no durable auth storage", () => {
    const env: Record<string, string | undefined> = { ...PRODUCTION };
    delete env.R2_ACCESS_KEY_ID;
    const report = authEnvironmentReport(env);
    assert.ok(report.errors.some((error) => error.includes("Durable auth storage")));
  });

  it("blocks a deployment with no provider at all", () => {
    const report = authEnvironmentReport(PRODUCTION, false);
    assert.ok(report.errors.some((error) => error.includes("No sign-in provider")));
  });

  it("blocks an http-only public URL, where __Host- cookies are dropped", () => {
    const report = authEnvironmentReport({
      ...PRODUCTION,
      BETTER_AUTH_URL: "http://nasaq.example.com",
    });
    assert.ok(report.errors.some((error) => error.includes("https")));
  });

  it("never leaks a secret value into the report or its messages", () => {
    const secret = "top-secret-session-key-0123456789abcdef";
    const oauth = "top-secret-oauth-key-0123456789abcdef";
    const report = authEnvironmentReport({
      ...PRODUCTION,
      BETTER_AUTH_SECRET: secret,
      GOOGLE_CLIENT_SECRET: oauth,
      GOOGLE_CLIENT_ID: "client-id",
    });
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes(secret));
    assert.ok(!serialized.includes(oauth));
    assert.ok(!describeAuthEnvironment(report).includes(secret));
  });
});

describe("development environment report", () => {
  it("says nothing about a signing secret on a dev box (sessions do not use one)", () => {
    const report = authEnvironmentReport({ VITE_AUTH_ENABLED: "true" });
    assert.equal(report.ok, true);
    assert.equal(report.deployed, false);
    assert.equal(report.secret, "unset");
    assert.ok(!report.errors.some((problem) => problem.includes("BETTER_AUTH_SECRET")));
    assert.ok(!report.warnings.some((warning) => warning.includes("BETTER_AUTH_SECRET")));
  });

  it("keeps auth on by default and honours the explicit off switch", () => {
    assert.equal(authEnvironmentReport({}).authEnabled, true);
    assert.equal(authEnvironmentReport({ VITE_AUTH_ENABLED: "false" }).authEnabled, false);
  });

  it("respects NASAQ_STRICT_ENV for self-hosted production", () => {
    const report = authEnvironmentReport({
      NODE_ENV: "production",
      NASAQ_STRICT_ENV: "1",
      BETTER_AUTH_SECRET: "9f2c1a7e4b0d4a559c310aa9d0b21f44",
    });
    assert.equal(report.deployed, true);
    assert.equal(report.ok, false); // no durable auth storage, no public URL
  });

  it("accepts a minimum-length secret without complaint", () => {
    const secret = "a".repeat(MIN_SECRET_LENGTH);
    const report = authEnvironmentReport({ ...PRODUCTION, BETTER_AUTH_SECRET: secret });
    assert.equal(report.secret, "configured");
    assert.equal(report.ok, true);
  });
});
