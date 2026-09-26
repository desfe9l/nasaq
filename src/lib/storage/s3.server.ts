/**
 * Minimal S3-compatible client (AWS Signature V4) — server-only.
 *
 * Written against `fetch` + `node:crypto` on purpose: the four operations NASAQ
 * needs (PUT / GET / DELETE / presigned GET) are a few hundred lines of
 * signing, while an SDK would add tens of megabytes to a serverless bundle for
 * the same result. Anything provider-specific stays in `r2.server.ts`.
 *
 * NEVER import this from client code: it reads the secret access key.
 */
import { createHash, createHmac } from "node:crypto";
import type { ObjectStorageProvider } from "./provider.ts";

export interface S3ClientConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Provider label used in diagnostics. Never a credential. */
  name: string;
}

const SERVICE = "s3";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** RFC 3986 encoding; S3 canonical requests do NOT accept `+` for a space. */
function uriEncode(value: string, encodeSlash: boolean): string {
  let out = "";
  for (const char of value) {
    if (/[A-Za-z0-9\-._~]/.test(char)) {
      out += char;
    } else if (char === "/") {
      out += encodeSlash ? "%2F" : "/";
    } else {
      for (const byte of Buffer.from(char, "utf8")) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
    }
  }
  return out;
}

function amzDates(now = new Date()): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signingKey(config: S3ClientConfig, dateStamp: string): Buffer {
  return hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), SERVICE),
    "aws4_request",
  );
}

function objectPath(config: S3ClientConfig, key: string): string {
  // Path-style addressing: `<endpoint>/<bucket>/<key>`. R2's S3 endpoint and
  // every self-hosted MinIO accept it, which keeps the provider swap trivial.
  return `/${uriEncode(config.bucket, true)}/${uriEncode(key, false)}`;
}

export class S3RequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "S3RequestError";
    this.status = status;
  }
}

/**
 * Sign and send one request. The payload hash is always computed from the body
 * so a proxy cannot alter bytes in flight.
 */
async function signedRequest(
  config: S3ClientConfig,
  method: "PUT" | "GET" | "DELETE" | "HEAD",
  key: string,
  options: { body?: Uint8Array; contentType?: string } = {},
): Promise<Response> {
  const endpoint = new URL(config.endpoint);
  const canonicalUri = objectPath(config, key);
  const { amzDate, dateStamp } = amzDates();
  const payloadHash = sha256Hex(options.body ?? new Uint8Array());

  const headers: Record<string, string> = {
    host: endpoint.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (options.contentType) headers["content-type"] = options.contentType;

  const sortedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderNames
    .map((name) => `${name}:${headers[name].trim()}\n`)
    .join("");
  const signedHeaders = sortedHeaderNames.join(";");
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${config.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmac(signingKey(config, dateStamp), stringToSign).toString("hex");

  const response = await fetch(`${endpoint.origin}${canonicalUri}`, {
    method,
    headers: {
      ...headers,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: options.body ? Buffer.from(options.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  return response;
}

/**
 * Presigned GET (query-string signing) so the browser can fetch a private
 * object directly without the app ever proxying bytes — and without any
 * credential reaching the client: the signature is single-object, read-only
 * and time-limited.
 */
export function presignGetUrl(
  config: S3ClientConfig,
  key: string,
  expiresInSeconds: number,
): string {
  const endpoint = new URL(config.endpoint);
  const canonicalUri = objectPath(config, key);
  const { amzDate, dateStamp } = amzDates();
  const scope = `${dateStamp}/${config.region}/${SERVICE}/aws4_request`;
  const expires = Math.min(Math.max(Math.trunc(expiresInSeconds), 1), 604_800);

  const query = new Map<string, string>([
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${config.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"],
  ]);
  const canonicalQuery = [...query.entries()]
    .map(([k, v]) => [uriEncode(k, true), uriEncode(v, true)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    `host:${endpoint.host}\n`,
    "host",
    UNSIGNED_PAYLOAD,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmac(signingKey(config, dateStamp), stringToSign).toString("hex");

  return `${endpoint.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Provider implementation over the signer above.
 *
 * Errors carry the HTTP status and the provider's own message only — never the
 * request signature, the key material, or the object bytes.
 */
export function createS3Provider(config: S3ClientConfig): ObjectStorageProvider {
  return {
    name: config.name,

    async put(key, body, contentType) {
      const response = await signedRequest(config, "PUT", key, { body, contentType });
      if (!response.ok) {
        throw new S3RequestError(
          `object storage rejected the upload (${response.status})`,
          response.status,
        );
      }
    },

    async get(key) {
      const response = await signedRequest(config, "GET", key);
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new S3RequestError(
          `object storage read failed (${response.status})`,
          response.status,
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    },

    async delete(key) {
      const response = await signedRequest(config, "DELETE", key);
      // S3 delete is idempotent: 204 and 404 are both "the object is gone".
      if (!response.ok && response.status !== 404) {
        throw new S3RequestError(
          `object storage delete failed (${response.status})`,
          response.status,
        );
      }
    },

    async signedGetUrl(key, expiresInSeconds) {
      return presignGetUrl(config, key, expiresInSeconds);
    },
  };
}
