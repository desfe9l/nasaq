/**
 * Where a disowned session is sent — and where it is NOT.
 *
 * A background revalidation that ends a session must not turn into a redirect
 * loop (sign-in → app → sign-in) or into a redirect that drags a visitor off an
 * auth screen into another copy of it. The address they were on has to travel
 * intact so signing back in returns them there, and an external URL must never
 * be accepted as a destination.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  isAuthScreen,
  sessionEndedNotice,
  sessionEndedReasonFrom,
  signInDestination,
  signInRedirectFor,
} from "./session-recovery.ts";

describe("signInRedirectFor", () => {
  it("keeps the current address so signing back in returns the visitor there", () => {
    assert.equal(
      signInRedirectFor("/workspace"),
      `${SIGN_IN_PATH}?redirect=${encodeURIComponent("/workspace")}`,
    );
    assert.equal(
      signInRedirectFor("/projects?filter=recent&sort=name"),
      `${SIGN_IN_PATH}?redirect=${encodeURIComponent("/projects?filter=recent&sort=name")}`,
    );
  });

  it("handles the site root like any other address", () => {
    assert.equal(signInRedirectFor("/"), `${SIGN_IN_PATH}?redirect=${encodeURIComponent("/")}`);
  });

  it("never redirects a visitor who is already on an auth screen", () => {
    assert.equal(signInRedirectFor("/login"), null);
    assert.equal(signInRedirectFor("/login?redirect=%2Fworkspace"), null);
    assert.equal(signInRedirectFor(SIGN_UP_PATH), null);
    assert.equal(signInRedirectFor("/login/"), null);
  });

  it("normalizes a bare or trailing-slash path", () => {
    assert.equal(signInRedirectFor("workspace"), `${SIGN_IN_PATH}?redirect=%2Fworkspace`);
    assert.equal(signInRedirectFor("/workspace/"), `${SIGN_IN_PATH}?redirect=%2Fworkspace`);
  });

  it("treats an empty address as the site root", () => {
    assert.equal(signInRedirectFor(""), `${SIGN_IN_PATH}?redirect=%2F`);
  });

  it("carries WHY the visitor is here, so the sign-in screen can explain itself", () => {
    assert.equal(
      signInRedirectFor("/workspace", { reason: "expired" }),
      `${SIGN_IN_PATH}?ended=expired&redirect=${encodeURIComponent("/workspace")}`,
    );
    assert.equal(
      signInRedirectFor("/workspace", { reason: "suspended" }),
      `${SIGN_IN_PATH}?ended=suspended&redirect=${encodeURIComponent("/workspace")}`,
    );
    // No reason (an ordinary guarded-route redirect) adds nothing.
    assert.equal(
      signInRedirectFor("/workspace"),
      `${SIGN_IN_PATH}?redirect=${encodeURIComponent("/workspace")}`,
    );
  });

  it("honours a custom sign-in path (and its own auth screen)", () => {
    assert.equal(signInRedirectFor("/workspace", { signInPath: "/signin" }), "/signin?redirect=%2Fworkspace");
    assert.equal(signInRedirectFor("/signin", { signInPath: "/signin" }), null);
  });
});

describe("isAuthScreen", () => {
  it("recognizes the sign-in and sign-up screens, query and all", () => {
    assert.equal(isAuthScreen("/login?redirect=%2F"), true);
    assert.equal(isAuthScreen(SIGN_UP_PATH), true);
    assert.equal(isAuthScreen("/workspace"), false);
  });
});

describe("sessionEndedReasonFrom / sessionEndedNotice", () => {
  it("reads a known reason, and refuses anything else", () => {
    assert.equal(sessionEndedReasonFrom("?ended=expired"), "expired");
    assert.equal(sessionEndedReasonFrom("ended=revoked&redirect=%2F"), "revoked");
    assert.equal(sessionEndedReasonFrom(new URLSearchParams({ ended: "suspended" })), "suspended");
    assert.equal(sessionEndedReasonFrom("?ended=whatever"), null);
    assert.equal(sessionEndedReasonFrom(""), null);
  });

  it("explains an ended session in Arabic, and stays quiet otherwise", () => {
    assert.match(String(sessionEndedNotice("expired")), /انتهت صلاحية جلستك/);
    assert.match(String(sessionEndedNotice("revoked")), /إلغاء الترخيص/);
    assert.match(String(sessionEndedNotice("suspended")), /أوقفت الإدارة/);
    assert.equal(sessionEndedNotice(null), null);
  });
});

describe("signInDestination", () => {
  it("reads back only site-internal destinations", () => {
    assert.equal(signInDestination("?redirect=%2Fworkspace"), "/workspace");
    assert.equal(signInDestination("redirect=/projects%3Fid%3D2"), "/projects?id=2");
    assert.equal(signInDestination("?redirect=https%3A%2F%2Fevil.example"), SIGN_IN_PATH);
    assert.equal(signInDestination("?redirect=%2F%2Fevil.example"), SIGN_IN_PATH);
    assert.equal(signInDestination(""), SIGN_IN_PATH);
  });

  it("accepts URLSearchParams as the router hands them over", () => {
    assert.equal(signInDestination(new URLSearchParams({ redirect: "/library" })), "/library");
  });
});
