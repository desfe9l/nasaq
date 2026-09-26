# Final pricing and payment readiness

`src/lib/commercial/catalog.ts` is the authoritative runtime source for prices,
durations, paid product/price identifiers and Keygen policy mappings. UI settings
and stale database prices cannot override it. Database rows remain for foreign
keys, historical subscriptions and administrator availability controls.

| Tier | Monthly | 3 months | Annual |
| --- | ---: | ---: | ---: |
| Free | 0 | 0 | 0 |
| Pro (`individual`, retained for existing licenses) | 79 | 199 | 699 |
| Team | 199 | 499 | 1799 |

All amounts are SAR totals, not monthly equivalents. Quarterly savings are
calculated against three monthly payments. Free has no checkout, expiration or
paid subscription record; existing FREE feature entitlements remain unchanged.
Existing trial/lifetime licenses and historical payment records are preserved,
but are not purchasable tiers.

Each paid plan-duration has a stable `key`, `productId` and versioned `priceId`.
These are internal identifiers, not invented gateway-issued IDs. Gumroad is the
only payment provider: the purchase page deep-links each plan to the product's
matching tier + recurrence, and every sale is re-verified server-side against
the Gumroad API before Keygen issues the license (see `docs/gumroad-integration.md`).
Amounts are never taken from client input; the verified sale must match the
catalog price for the mapped plan.

Fulfillment fails closed unless the deployment has `GUMROAD_ACCESS_TOKEN`
(recommended), `GUMROAD_PRODUCT_ID`, `KEYGEN_API_TOKEN`, and a Keygen policy for
the purchased plan. Annual plans require `KEYGEN_POLICY_INDIVIDUAL_ANNUAL_ID` /
`KEYGEN_POLICY_TEAM_ANNUAL_ID`; until those exist the annual catalog rows stay
unpurchasable. The browser receives readiness booleans only — never a secret.
The existing manual-transfer workflow is preserved, but requires complete
bank/account/IBAN instructions and uses catalog prices; it never automatically
verifies a payment.

Migration `0007_final_pricing.sql` is a catalog snapshot: updates the six paid
rows and disables old purchase rows without deleting subscription history or
changing previous payment amounts. Existing administrator-disabled paid plans
remain disabled. It runs through the normal deployment migration pipeline.

Verification:
- `npm run typecheck`
- `npm run build`
- `node --experimental-strip-types --test src/lib/commercial/*.test.ts src/lib/license/license.test.ts`
- `node scripts/pricing-browser-check.mjs` (Playwright Chromium; optional
  `CHROMIUM_PATH` and `PRICING_TEST_URL` overrides). Run without payment secrets;
  verifies desktop/mobile rendering, duration selection, prices, savings, Free,
  unavailable checkout and uncaught page errors. Never initiates a payment.

QA environment note: production browser checks used the Vercel build with the
PGLite `.data`/`.wasm` runtime assets copied into the **ignored local build output**.
The existing bundler omits these assets for the no-`DATABASE_URL` fallback;
this is unrelated to pricing. No generated database or binary is committed.
Deployments with `DATABASE_URL` use PostgreSQL and the normal migration script.
