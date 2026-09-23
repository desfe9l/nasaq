/**
 * The upstream identity providers this app offers for sign-in (via the broker).
 *
 * Source of truth for BOTH the server (`server.ts`, one `genericOAuth` provider
 * per entry) and the client (`client.ts` / sign-in buttons). Kept in its own
 * dependency-free module so the client can import it without pulling the
 * server-only Better Auth instance (and `pg`) into the browser bundle.
 *
 * Each app federates to the shared **auth broker** (`GROK_AUTH_ISSUER`), which
 * holds the real Google secret. The app never sees it — it only knows its
 * own per-app client id/secret and which upstream to ask the broker for (`idp`).
 *
 * The provider id is this app's local id and the OAuth callback path segment
 * (`/api/auth/oauth2/callback/<providerId>`); `idp` is the hint the broker
 * reads to pick the upstream.
 */
export type GrokProvider = {
  /** This app's local provider id; also the callback path segment. */
  providerId: string;
  /** Upstream hint the broker forwards to (Better Auth social id). */
  idp: string;
  /** Human label for the sign-in button. */
  label: string;
};

export const GOOGLE_PROVIDER_ID = "grok-google" as const;
export const GOOGLE_OAUTH_CALLBACK_PATH = `/api/auth/oauth2/callback/${GOOGLE_PROVIDER_ID}` as const;

export const GROK_PROVIDERS: readonly GrokProvider[] = [
  { providerId: GOOGLE_PROVIDER_ID, idp: "google", label: "Google" },
];
