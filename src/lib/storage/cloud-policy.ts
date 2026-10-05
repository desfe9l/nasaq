export type CloudStoragePreference = "local" | "cloud";

export type CloudStorageAccess = {
  isOwner: boolean;
  isAdmin: boolean;
  hasLicense: boolean;
};

/** Owner/Admin storage is always retained; paid accounts opt in explicitly. */
export function canUseCloudStorage(access: CloudStorageAccess): boolean {
  return access.isOwner || access.isAdmin || access.hasLicense;
}

export function shouldKeepCloudCopy(
  access: CloudStorageAccess,
  preference: CloudStoragePreference,
): boolean {
  return (
    canUseCloudStorage(access) &&
    (access.isOwner || access.isAdmin || preference === "cloud")
  );
}

export function normalizeCloudStoragePreference(
  value: unknown,
): CloudStoragePreference {
  return value === "cloud" ? "cloud" : "local";
}
