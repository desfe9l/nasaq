import type { Sql } from "../db.ts";

export type OwnerIdentity = {
  id: string;
  email: string | null;
  /** Authoritative account-row value from the server-verified session. */
  emailVerified: boolean;
};

export type OwnerConfig = {
  id?: string;
  email?: string;
};

function envValue(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

/** Read owner configuration without ever returning it to client code. */
export function readOwnerConfig(): OwnerConfig {
  return {
    id: envValue("NASAQ_OWNER_ID"),
    email: envValue("NASAQ_OWNER_EMAIL")?.toLowerCase(),
  };
}

export function ownerConfigPresent(config = readOwnerConfig()): boolean {
  return Boolean(config.id || config.email);
}

/** Match only a verified session identity against deployment configuration. */
export function isOwnerIdentity(
  identity: OwnerIdentity,
  config = readOwnerConfig(),
): boolean {
  return Boolean(
    (config.id && identity.id === config.id) ||
      (config.email &&
        identity.emailVerified &&
        identity.email?.trim().toLowerCase() === config.email),
  );
}

/**
 * The owner decision, configuration PLUS the durable binding.
 *
 * `NASAQ_OWNER_ID` is an exact id and `NASAQ_OWNER_EMAIL` requires a verified
 * address, so neither can follow an account whose id changed in the first-party
 * auth migration. The binding is the repair: it is written once, server-side,
 * by `recoverOwnerAuthority`, and it names the id the owner actually signs in
 * with. Imported dynamically so this module keeps zero dependencies.
 */
export async function isOwnerIdentityWithBinding(
  sql: Sql,
  identity: OwnerIdentity,
): Promise<boolean> {
  if (isOwnerIdentity(identity)) return true;
  const { readOwnerBinding, isBoundOwner } = await import("./owner-binding.server.ts");
  return isBoundOwner(await readOwnerBinding(sql), identity);
}
