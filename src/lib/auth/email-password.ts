/**
 * Local email/password accounts (this app's own identity store).
 *
 * ENABLED. This is the flag the rest of the codebase reads — `config.ts` counts
 * it as a real sign-in provider (so server-side session verification is active
 * without any OAuth credentials), and the sign-in / sign-up surfaces decide what
 * to render from the same report.
 *
 * WHY IT IS ON: NASAQ's account path must not depend on a third-party OAuth
 * client. With this flag `false` the previous implementation answered every
 * sign-up with `EMAIL_PASSWORD_SIGN_UP_DISABLED`, so an account could only ever
 * be created through Google — and with no Google credentials configured the
 * whole account path was inert while still rendering a sign-in page.
 *
 * Accounts created here are first-class: a real identity record with a
 * provider id of `credential`, a real session row and an opaque `__Host-`
 * cookie, exactly like the OAuth path. Nothing about this file changes the
 * licensing, pricing or entitlement rules — those stay server-owned (see
 * `src/lib/license`).
 *
 * Keep this module dependency-free: `config.ts` imports it, and both are read
 * from the client bundle as well as from the server.
 */
export const emailAndPasswordEnabled = true;
