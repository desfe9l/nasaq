export type OwnerIdentity = {
  id: string;
  email: string | null;
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
      (config.email && identity.email?.trim().toLowerCase() === config.email),
  );
}
