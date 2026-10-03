/**
 * External payment instructions (server-only).
 *
 * These are the receiving details a customer transfers money to. They are
 * readable by any signed-in customer, because the customer must see them to pay.
 * Nothing here is a credential: no API key, no card data, no bank login — writing
 * money requires the customer's own bank, not anything in this app.
 *
 * Only an administrator may change them (`updatePaymentSettings` is called from
 * an admin-gated server function). The IBAN is validated on write so a typo
 * cannot send a customer's transfer into the void.
 */
import type { Sql } from "@/lib/db";
import type { PaymentInstructions } from "./types";

const KEYS = {
  bankName: "bank_name",
  accountName: "account_name",
  iban: "iban",
  instructionsAr: "instructions_ar",
  instructionsEn: "instructions_en",
} as const;

type SettingKey = (typeof KEYS)[keyof typeof KEYS];

/**
 * Basic IBAN plausibility: 2 letters, 2 check digits, 11–30 alphanumerics, no
 * spaces. Deliberately not a full mod-97 checksum — the goal is to catch
 * transposed keystrokes, not to certify the account.
 */
export function isValidIban(value: string): boolean {
  return /^[A-Za-z]{2}\d{2}[A-Za-z0-9]{11,30}$/.test(value.replace(/\s+/g, ""));
}

/** Read the current instructions. Falls back to empty strings for missing keys. */
export async function getPaymentInstructions(sql: Sql): Promise<PaymentInstructions> {
  // The table holds a handful of known keys, so read it whole rather than
  // building an `in (...)` list — one query, and a missing key degrades to "".
  const rows = await sql<{ key: string; value: string }>`
    select key, value from payment_settings
  `;
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    bankName: map.get(KEYS.bankName) ?? "",
    accountName: map.get(KEYS.accountName) ?? "",
    iban: map.get(KEYS.iban) ?? "",
    instructionsAr: map.get(KEYS.instructionsAr) ?? "",
    instructionsEn: map.get(KEYS.instructionsEn) ?? "",
  };
}

/** Replace the instructions. Admin-gated at the call site. */
export async function updatePaymentSettings(
  sql: Sql,
  next: PaymentInstructions,
): Promise<void> {
  if (!isValidIban(next.iban)) {
    throw new Error("IBAN غير صالح — تحقق من الصيغة قبل الحفظ.");
  }
  const entries: Array<[SettingKey, string]> = [
    [KEYS.bankName, next.bankName],
    [KEYS.accountName, next.accountName],
    [KEYS.iban, next.iban.replace(/\s+/g, "")],
    [KEYS.instructionsAr, next.instructionsAr],
    [KEYS.instructionsEn, next.instructionsEn],
  ];
  for (const [key, value] of entries) {
    await sql`
      insert into payment_settings (key, value, updated_at)
      values (${key}, ${value}, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `;
  }
}