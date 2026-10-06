import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accountProfile } from "./account.ts";
import type { AppUser } from "./use-current-user.ts";

function user(patch: Partial<AppUser> = {}): AppUser {
  return {
    id: "user_123",
    displayName: "فيصل العنزي",
    primaryEmail: "faisal@example.com",
    profileImageUrl: null,
    isDevFallback: false,
    createdAt: "2026-10-01T08:00:00.000Z",
    emailVerified: true,
    ...patch,
  };
}

describe("accountProfile", () => {
  it("returns null when nobody is signed in", () => {
    assert.equal(accountProfile(null), null);
    assert.equal(accountProfile(undefined), null);
  });

  it("exposes the standard account fields", () => {
    assert.deepEqual(accountProfile(user()), {
      id: "user_123",
      name: "فيصل العنزي",
      email: "faisal@example.com",
      createdAt: "2026-10-01T08:00:00.000Z",
      emailVerified: true,
      imageUrl: null,
      isDevFallback: false,
      hasRealSession: true,
    });
  });

  it("collapses blank values to null instead of rendering empty strings", () => {
    const profile = accountProfile(
      user({ displayName: "   ", primaryEmail: "", createdAt: null }),
    );
    assert.equal(profile?.name, null);
    assert.equal(profile?.email, null);
    assert.equal(profile?.createdAt, null);
  });

  it("marks the disabled-auth dev user as NOT a real session", () => {
    const profile = accountProfile(
      user({ id: "dev-user", isDevFallback: true, createdAt: null, emailVerified: false }),
    );
    assert.equal(profile?.isDevFallback, true);
    assert.equal(profile?.hasRealSession, false);
  });

  it("treats a user object with no id as having no real session", () => {
    assert.equal(accountProfile(user({ id: "   " }))?.hasRealSession, false);
  });

  it("keeps optional fields optional so older literals still work", () => {
    const legacy: AppUser = {
      id: "legacy",
      displayName: null,
      primaryEmail: "legacy@example.com",
      profileImageUrl: "https://example.com/a.png",
      isDevFallback: false,
    };
    const profile = accountProfile(legacy);
    assert.equal(profile?.createdAt, null);
    assert.equal(profile?.emailVerified, false);
    assert.equal(profile?.imageUrl, "https://example.com/a.png");
  });
});
