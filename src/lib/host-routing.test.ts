import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionCookie } from "./auth/session.ts";
import {
  LEGACY_PRODUCTION_HOST,
  PUBLIC_ORIGIN,
  WORKSPACE_ORIGIN,
  decideHostRequest,
  followHostRedirect,
  hostRole,
  resolveCredentialOrigin,
  routeSurface,
} from "./host-routing.ts";

function decide(
  hostname: string,
  pathname: string,
  search = "",
  method = "GET",
) {
  return decideHostRequest({ hostname, pathname, search, method });
}

test("host roles match exact names, not substrings", () => {
  assert.equal(hostRole("www.nasaq.team"), "public");
  assert.equal(hostRole("nasaq.team"), "public");
  assert.equal(hostRole("NASAQ.WORK"), "workspace");
  assert.equal(hostRole("www.nasaq.work"), "workspace");
  assert.equal(hostRole(LEGACY_PRODUCTION_HOST), "legacy");
  assert.equal(hostRole("nasaq-sa-git-main-team.vercel.app"), "legacy");
  assert.equal(hostRole("localhost"), "legacy");
  assert.equal(hostRole("evil.com"), "unknown");
  assert.equal(hostRole("nasaq.team.evil.com"), "unknown");
  assert.equal(hostRole("www.nasaq.team.attacker.com"), "unknown");
  assert.equal(hostRole("notnasaq.work"), "unknown");
  assert.equal(hostRole("nasaq.work.evil.com"), "unknown");
  assert.equal(hostRole("evilnasaq.team"), "unknown");
  assert.equal(hostRole("preview.vercel.app"), "unknown");
  assert.equal(hostRole("https://nasaq.work"), "unknown");
});

test("www.nasaq.team is the public canonical and the apex joins it in one hop", () => {
  assert.equal(decide("www.nasaq.team", "/"), null);
  assert.equal(decide("www.nasaq.team", "/pricing"), null);
  assert.equal(decide("www.nasaq.team", "/about"), null);
  assert.equal(decide("www.nasaq.team", "/contact"), null);
  const apex = decide("nasaq.team", "/pricing", "?plan=pro");
  assert.deepEqual(apex, {
    location: `${PUBLIC_ORIGIN}/pricing?plan=pro`,
    status: 308,
  });
  assert.equal(apex && followHostRedirect(apex), null);
});

test("marketing routes on the public host stay, workspace routes leave", () => {
  assert.equal(routeSurface("/templates"), "shared");
  assert.equal(routeSurface("/templates/category/reports"), "shared");
  assert.equal(routeSurface("/ai"), "shared");
  assert.equal(decide("www.nasaq.team", "/templates/annual-report"), null);
  assert.equal(decide("www.nasaq.team", "/privacy"), null);
  assert.equal(decide("www.nasaq.team", "/terms"), null);
  assert.equal(decide("www.nasaq.team", "/الهوية"), null);

  const editor = decide("www.nasaq.team", "/editor/proj_123", "?page=2");
  assert.deepEqual(editor, {
    location: `${WORKSPACE_ORIGIN}/editor/proj_123?page=2`,
    status: 307,
  });
  assert.equal(editor && followHostRedirect(editor), null);

  const login = decide("nasaq.team", "/login", "?redirect=%2Fprojects%2Fdoc-1");
  assert.equal(login?.location, `${WORKSPACE_ORIGIN}/login?redirect=%2Fprojects%2Fdoc-1`);
  assert.equal(login && followHostRedirect(login), null);

  assert.equal(
    decide("www.nasaq.team", "/projects/doc-1")?.location,
    `${WORKSPACE_ORIGIN}/projects/doc-1`,
  );
  assert.equal(decide("www.nasaq.team", "/workspace")?.location, `${WORKSPACE_ORIGIN}/workspace`);
  assert.equal(decide("www.nasaq.team", "/admin/licenses")?.location, `${WORKSPACE_ORIGIN}/admin/licenses`);
});

test("nasaq.work is the workspace canonical and does not serve the marketing home", () => {
  assert.equal(decide("www.nasaq.work", "/editor/abc")?.location, `${WORKSPACE_ORIGIN}/editor/abc`);
  assert.equal(decide("www.nasaq.work", "/editor/abc")?.status, 308);
  assert.equal(decide("nasaq.work", "/editor/abc"), null);
  assert.equal(decide("nasaq.work", "/login"), null);
  assert.equal(decide("nasaq.work", "/signup"), null);
  assert.equal(decide("nasaq.work", "/workspace"), null);
  assert.equal(decide("nasaq.work", "/projects/doc-1"), null);
  assert.equal(decide("nasaq.work", "/create"), null);
  assert.equal(decide("nasaq.work", "/templates/annual"), null);

  const home = decide("nasaq.work", "/", "?ref=ad");
  assert.deepEqual(home, { location: `${WORKSPACE_ORIGIN}/workspace?ref=ad`, status: 307 });
  assert.equal(home && followHostRedirect(home), null);

  const aliasHome = decide("www.nasaq.work", "/");
  assert.equal(aliasHome?.location, `${WORKSPACE_ORIGIN}/workspace`);
  assert.equal(aliasHome && followHostRedirect(aliasHome), null);

  const pricing = decide("nasaq.work", "/pricing");
  assert.deepEqual(pricing, { location: `${PUBLIC_ORIGIN}/pricing`, status: 307 });
  assert.equal(pricing && followHostRedirect(pricing), null);
  assert.equal(decide("www.nasaq.work", "/about")?.location, `${PUBLIC_ORIGIN}/about`);
});

test("legacy, preview, local, and unknown hosts are not redirected", () => {
  for (const host of [
    LEGACY_PRODUCTION_HOST,
    "nasaq-sa-abc123-team.vercel.app",
    "localhost",
    "127.0.0.1",
    "evil.com",
    "nasaq.team.evil.com",
    "notnasaq.work",
  ]) {
    assert.equal(decide(host, "/"), null, host);
    assert.equal(decide(host, "/editor/proj_123"), null, host);
    assert.equal(decide(host, "/pricing"), null, host);
    assert.equal(decide(host, "/login"), null, host);
  }
});

test("redirect targets stay on the two canonical origins", () => {
  const cases = [
    ["www.nasaq.team", "/editor/p"],
    ["nasaq.team", "/"],
    ["nasaq.work", "/"],
    ["www.nasaq.work", "/contact"],
    ["nasaq.work", "/privacy"],
    ["www.nasaq.team", "/admin"],
  ] as const;
  for (const [host, path] of cases) {
    const decision = decide(host, path, "?next=https://evil.com");
    assert.ok(decision, `${host}${path}`);
    const url = new URL(decision.location);
    assert.ok(
      url.origin === PUBLIC_ORIGIN || url.origin === WORKSPACE_ORIGIN,
      decision.location,
    );
    assert.equal(url.searchParams.get("next"), "https://evil.com");
    assert.equal(followHostRedirect(decision), null);
  }
});

test("unsafe methods are not moved onto a different path", () => {
  assert.equal(decide("www.nasaq.team", "/editor/p", "", "POST"), null);
  assert.equal(decide("nasaq.work", "/", "", "POST"), null);
  const alias = decide("www.nasaq.work", "/api/auth/sign-in/email", "", "POST");
  assert.deepEqual(alias, {
    location: `${WORKSPACE_ORIGIN}/api/auth/sign-in/email`,
    status: 308,
  });
  assert.equal(decide("nasaq.work", "/api/auth/callback/google"), null);
  assert.equal(decide("www.nasaq.team", "/api/webhooks/gumroad", "", "POST"), null);
});

test("forwarded host is the first value only and cannot inject a location", () => {
  const decision = decideHostRequest({
    forwardedHost: "www.nasaq.work, evil.com",
    pathname: "/editor/p",
  });
  assert.equal(decision?.location, `${WORKSPACE_ORIGIN}/editor/p`);
  assert.equal(
    decideHostRequest({ forwardedHost: "https://evil.com", pathname: "/editor/p" }),
    null,
  );
});

test("credential origin follows a first-party host and refuses any other", () => {
  const originFor = (host: string, url = `https://${host}/api/auth/sign-in/social`) =>
    resolveCredentialOrigin({
      url,
      headers: { get: (name) => (name === "host" ? host : null) },
    });
  assert.equal(originFor("nasaq.work"), WORKSPACE_ORIGIN);
  assert.equal(originFor("www.nasaq.team"), PUBLIC_ORIGIN);
  assert.equal(originFor(LEGACY_PRODUCTION_HOST), `https://${LEGACY_PRODUCTION_HOST}`);
  assert.equal(
    originFor("nasaq-sa-preview-team.vercel.app"),
    "https://nasaq-sa-preview-team.vercel.app",
  );
  assert.equal(originFor("localhost:8080", "http://localhost:8080/login"), "http://localhost:8080");
  assert.equal(originFor("evil.com"), null);
  assert.equal(originFor("nasaq.work.evil.com"), null);
  assert.equal(originFor("attacker.vercel.app"), null);
});

test("session cookies stay host-only so routing cannot widen them", () => {
  const cookie = sessionCookie("token-value");
  assert.match(cookie, /__Host-/);
  assert.equal(cookie.includes("Domain="), false);
});
