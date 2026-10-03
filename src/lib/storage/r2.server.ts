/**
 * Cloudflare R2 binding — server-only configuration for the storage layer.
 *
 * Every value comes from the deployment environment; nothing here is ever
 * hard-coded, logged, or returned to a browser. Storage is OPTIONAL: when the
 * variables are absent `getObjectStorage()` returns null and the editor keeps
 * its existing local-first behaviour untouched.
 *
 *   R2_ACCOUNT_ID        Cloudflare account id (used to derive the endpoint)
 *   R2_ACCESS_KEY_ID     R2 API token access key id
 *   R2_SECRET_ACCESS_KEY R2 API token secret       (server-only, never VITE_)
 *   R2_BUCKET_NAME       bucket name, e.g. nasaq-sa
 *   R2_ENDPOINT          explicit S3 endpoint; overrides the derived one
 */
import { createS3Provider, type S3ClientConfig } from "./s3.server.ts";
import type { ObjectStorageProvider } from "./provider.ts";

/** R2 ignores the region but SigV4 requires one; `auto` is Cloudflare's value. */
const R2_REGION = "auto";
const DEFAULT_BUCKET = "nasaq-sa";

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/**
 * The S3 endpoint origin. An explicit `R2_ENDPOINT` wins (custom domains and
 * jurisdiction-specific endpoints exist); otherwise it is derived from the
 * account id, which is the documented R2 form.
 */
export function r2Endpoint(): string | undefined {
  const explicit = env("R2_ENDPOINT");
  if (explicit) {
    const value = /^https?:\/\//i.test(explicit) ? explicit : `https://${explicit}`;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return undefined;
      return url.origin;
    } catch {
      return undefined;
    }
  }
  const accountId = env("R2_ACCOUNT_ID");
  return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined;
}

export function r2BucketName(): string {
  return env("R2_BUCKET_NAME") || DEFAULT_BUCKET;
}

function r2Config(): S3ClientConfig | null {
  const endpoint = r2Endpoint();
  const accessKeyId = env("R2_ACCESS_KEY_ID");
  const secretAccessKey = env("R2_SECRET_ACCESS_KEY");
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint,
    bucket: r2BucketName(),
    region: R2_REGION,
    accessKeyId,
    secretAccessKey,
    name: "cloudflare-r2",
  };
}

/** Presence check for diagnostics. Booleans only — never a value. */
export function objectStorageConfigured(): boolean {
  return r2Config() !== null;
}

/**
 * The active provider, or null when storage is not configured.
 *
 * Cached per process: the config is immutable for the lifetime of a deployment
 * and the signer holds no connection state.
 */
let cached: ObjectStorageProvider | null | undefined;
export function getObjectStorage(): ObjectStorageProvider | null {
  if (cached === undefined) {
    const config = r2Config();
    cached = config ? createS3Provider(config) : null;
  }
  return cached;
}

/** Test/maintenance hook: forget the memoised provider. */
export function resetObjectStorageCache(): void {
  cached = undefined;
}
