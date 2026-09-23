import assert from "node:assert/strict";
import test from "node:test";
import { GOOGLE_OAUTH_CALLBACK_PATH, GOOGLE_PROVIDER_ID, GROK_PROVIDERS } from "./providers.ts";

test("Google is the only social sign-in provider", () => {
  assert.deepEqual(GROK_PROVIDERS, [
    { providerId: GOOGLE_PROVIDER_ID, idp: "google", label: "Google" },
  ]);
  assert.equal(GROK_PROVIDERS.some((provider) => provider.idp !== "google"), false);
});

test("the production callback path is derived from the Better Auth provider id", () => {
  assert.equal(GOOGLE_PROVIDER_ID, "grok-google");
  assert.equal(GOOGLE_OAUTH_CALLBACK_PATH, "/api/auth/oauth2/callback/grok-google");
});
