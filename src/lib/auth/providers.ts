/**
 * The social providers this app offers for sign-in.
 *
 * Keep this dependency-free so both the Better Auth server and the browser UI
 * can share the same single-provider contract without bundling server code.
 */
export type SocialProvider = {
  providerId: string;
  label: string;
};

export const GOOGLE_PROVIDER_ID = "google" as const;
export const GOOGLE_OAUTH_CALLBACK_PATH = `/api/auth/callback/${GOOGLE_PROVIDER_ID}` as const;

export const SOCIAL_PROVIDERS: readonly SocialProvider[] = [
  { providerId: GOOGLE_PROVIDER_ID, label: "Google" },
];
