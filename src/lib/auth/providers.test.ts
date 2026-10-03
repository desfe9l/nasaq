import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_OAUTH_CALLBACK_PATH,
  GOOGLE_PROVIDER_ID,
  SOCIAL_PROVIDERS,
} from "./providers.ts";

test("Google is the only social sign-in provider", () => {
  assert.deepEqual(SOCIAL_PROVIDERS, [
    { providerId: GOOGLE_PROVIDER_ID, label: "Google" },
  ]);
  assert.deepEqual(SOCIAL_PROVIDERS.map((provider) => provider.providerId), ["google"]);
});

test("the production callback path is derived from the Better Auth provider id", () => {
  assert.equal(GOOGLE_PROVIDER_ID, "google");
  assert.equal(GOOGLE_OAUTH_CALLBACK_PATH, "/api/auth/callback/google");
});
