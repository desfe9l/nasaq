import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_FALLBACK_LABEL,
  accountIdentity,
  accountInitials,
  accountLabel,
  hasProfileName,
} from "./identity.ts";
import type { AppUser } from "./use-current-user.ts";

function user(patch: Partial<AppUser>): AppUser {
  return {
    id: "u1",
    displayName: null,
    primaryEmail: null,
    profileImageUrl: null,
    isDevFallback: false,
    ...patch,
  };
}

describe("accountLabel", () => {
  it("prefers the real profile name over the email", () => {
    const account = user({ displayName: "فيصل العنزي", primaryEmail: "faisal@example.com" });
    assert.equal(accountLabel(account), "فيصل العنزي");
    assert.equal(hasProfileName(account), true);
  });

  it("collapses the padding a provider sometimes sends", () => {
    assert.equal(accountLabel(user({ displayName: "  Faisal   Alenezi " })), "Faisal Alenezi");
  });

  it("falls back to the email only when there is no name", () => {
    const account = user({ displayName: "   ", primaryEmail: "user@example.com" });
    assert.equal(accountLabel(account), "user@example.com");
    assert.equal(hasProfileName(account), false);
  });

  it("never renders an empty label", () => {
    assert.equal(accountLabel(user({})), ACCOUNT_FALLBACK_LABEL);
    assert.equal(accountLabel(null), ACCOUNT_FALLBACK_LABEL);
  });
});

describe("accountInitials", () => {
  it("takes the first letter of the first two words in either script", () => {
    assert.equal(accountInitials("Faisal Alenezi"), "FA");
    assert.equal(accountInitials("فيصل العنزي"), "فع");
  });

  it("drops the article from a surname but never from a first name", () => {
    assert.equal(accountInitials("الهام العنزي"), "اع");
    assert.equal(accountInitials("فيصل العنزي"), "فع");
  });

  it("handles a single-word name and a leading sigil", () => {
    assert.equal(accountInitials("NASAQ"), "N");
    assert.equal(accountInitials("@faisal"), "F");
  });

  it("is empty for a blank label", () => {
    assert.equal(accountInitials("   "), "");
  });
});

describe("accountIdentity", () => {
  it("carries the avatar and the email alongside the name", () => {
    const identity = accountIdentity(
      user({
        displayName: "Faisal Alenezi",
        primaryEmail: " faisal@example.com ",
        profileImageUrl: "https://cdn.example.com/a.png",
      }),
    );
    assert.deepEqual(identity, {
      label: "Faisal Alenezi",
      initials: "FA",
      avatarUrl: "https://cdn.example.com/a.png",
      email: "faisal@example.com",
      hasProfileName: true,
    });
  });

  it("reports a missing name so the UI can explain the email fallback", () => {
    const identity = accountIdentity(user({ primaryEmail: "user@example.com" }));
    assert.equal(identity.label, "user@example.com");
    assert.equal(identity.hasProfileName, false);
    assert.equal(identity.initials, "U");
  });
});
