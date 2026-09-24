import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import type { LicensePlan, LicenseType } from "./types";

const API_ORIGIN = "https://api.keygen.sh/v1/accounts";
const DEFAULT_ACCOUNT = "ararcomksa-twilight-fire-2288";
const DEFAULT_PRODUCT_ID = "c109271b-9c97-4827-bc9d-48e7982744fe";

export type KeygenPlan = LicensePlan | "trial" | "lifetime";

const DEFAULT_POLICIES: Record<KeygenPlan, string> = {
  trial: "ab6e0fdd-7e5e-4329-afe1-6c9e6b92acb7",
  "individual-monthly": "e9bea931-5416-4a91-95f8-8a90b26a2cd6",
  "individual-quarterly": "7b078b25-8fd0-485d-9dd6-75b92afb24c9",
  "team-monthly": "2b6984ed-1022-4718-a0b3-cc07c4cd5dad",
  "team-quarterly": "6a4b079a-45f8-4e94-90a6-b8864acbfd96",
  "individual-annual": "",
  "team-annual": "",
  lifetime: "3704e4a4-5645-4be7-b6c9-2067c722341d",
};

export interface KeygenVerification {
  key: string;
  licenseId: string;
  policyId: string;
  productId: string;
  plan?: LicensePlan;
  type: LicenseType;
  valid: boolean;
  code: string;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  expiresAt: string | null;
  activationCount: number;
  maxActivations: number | null;
  entitlementCodes: string[];
  metadata: Record<string, string>;
}

type KeygenResource = {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id?: string; type?: string } | null }>;
};

type KeygenResponse = {
  meta?: { valid?: boolean; code?: string; detail?: string };
  data?: KeygenResource | KeygenResource[];
  included?: KeygenResource[];
  errors?: Array<{ detail?: string }>;
};

export class KeygenConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeygenConfigurationError";
  }
}

export class KeygenRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "KeygenRequestError";
    this.status = status;
  }
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function keygenAccount(): string {
  return env("KEYGEN_ACCOUNT_SLUG") || DEFAULT_ACCOUNT;
}

export function keygenProductId(): string {
  return env("KEYGEN_PRODUCT_ID") || DEFAULT_PRODUCT_ID;
}

export function keygenPolicyId(plan: KeygenPlan): string {
  const envName = `KEYGEN_POLICY_${plan.toUpperCase().replaceAll("-", "_")}_ID`;
  return env(envName) || DEFAULT_POLICIES[plan];
}

export function planForKeygenPolicy(policyId: string): LicensePlan | undefined {
  const plans: LicensePlan[] = [
    "individual-monthly",
    "individual-quarterly",
    "team-monthly",
    "team-quarterly",
    "individual-annual",
    "team-annual",
  ];
  if (!policyId) return undefined;
  return plans.find((plan) => keygenPolicyId(plan) === policyId);
}

export function typeForKeygenPolicy(policyId: string): LicenseType {
  if (policyId === keygenPolicyId("trial")) return "TRIAL";
  if (policyId === keygenPolicyId("lifetime")) return "LIFETIME";
  if (!policyId) return "PRO";
  return "PRO";
}

export function keygenPlanForLicenseType(type: LicenseType): KeygenPlan | undefined {
  if (type === "TRIAL") return "trial";
  if (type === "PRO") return "individual-monthly";
  if (type === "LIFETIME") return "lifetime";
  return undefined;
}

export function isKeygenConfigured(): boolean {
  return Boolean(env("KEYGEN_API_TOKEN"));
}

export function verifyKeygenWebhookSignature(rawBody: string, request: Request): boolean {
  const publicKey = env("KEYGEN_PUBLIC_KEY");
  const header = request.headers.get("keygen-signature");
  const date = request.headers.get("date");
  const digestHeader = request.headers.get("digest");
  if (!publicKey || !header || !date || !digestHeader) return false;

  const digest = `sha-256=${createHash("sha256").update(rawBody).digest("base64")}`;
  if (digest !== digestHeader) return false;
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 10 * 60_000) return false;

  const signature = header.match(/signature="([^"]+)"/)?.[1];
  const algorithm = header.match(/algorithm="([^"]+)"/)?.[1]?.toLowerCase();
  if (!signature || !algorithm) return false;
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  const target = `${request.method.toLowerCase()} ${url.pathname}${url.search}`;
  const signingData = `(request-target): ${target}\nhost: ${host}\ndate: ${date}\ndigest: ${digest}`;
  const key = /^[0-9a-f]{64}$/i.test(publicKey)
    ? createPublicKey({
        key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey, "hex")]),
        format: "der",
        type: "spki",
      })
    : createPublicKey(publicKey);
  const signatureBytes = Buffer.from(signature, "base64");
  if (algorithm === "ed25519") return verifySignature(null, Buffer.from(signingData), key, signatureBytes);
  if (algorithm === "rsa-sha256" || algorithm === "rsa-pss-sha256" || algorithm === "ecdsa-p256") {
    return verifySignature("sha256", Buffer.from(signingData), key, signatureBytes);
  }
  return false;
}

function apiUrl(path: string): string {
  return `${API_ORIGIN}/${keygenAccount()}${path}`;
}

async function request(path: string, init: RequestInit = {}, authenticated = true): Promise<KeygenResponse> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.api+json");
  headers.set("Content-Type", "application/vnd.api+json");
  if (authenticated) {
    const token = env("KEYGEN_API_TOKEN");
    if (!token) throw new KeygenConfigurationError("KEYGEN_API_TOKEN is not configured");
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(apiUrl(path), { ...init, headers });
  const text = await response.text();
  let payload: KeygenResponse = {};
  try {
    payload = JSON.parse(text) as KeygenResponse;
  } catch {
    throw new KeygenRequestError("Keygen returned invalid JSON", response.status);
  }
  if (!response.ok) {
    throw new KeygenRequestError(payload.errors?.[0]?.detail || "Keygen request failed", response.status);
  }
  return payload;
}

function idFromRelationship(resource: KeygenResource | undefined, name: string): string {
  return resource?.relationships?.[name]?.data?.id || "";
}

function stringAttribute(resource: KeygenResource | undefined, name: string): string | null {
  const value = resource?.attributes?.[name];
  return value == null ? null : String(value);
}

async function entitlementCodesForLicense(licenseId: string): Promise<string[]> {
  const response = await request(`/licenses/${encodeURIComponent(licenseId)}/entitlements?include=entitlement`);
  const relationships = Array.isArray(response.data) ? response.data : [];
  const included = response.included || [];
  const includedCodes = new Map(
    included
      .filter((resource) => resource.type === "entitlements" && resource.id)
      .map((resource) => [resource.id as string, stringAttribute(resource, "code")]),
  );
  const codes: string[] = [];
  for (const relationship of relationships) {
    const entitlementId = idFromRelationship(relationship, "entitlement");
    const code = includedCodes.get(entitlementId);
    if (code) codes.push(code);
  }
  return codes;
}

function verificationFromResponse(key: string, response: KeygenResponse, entitlementCodes: string[]): KeygenVerification {
  const resource = Array.isArray(response.data) ? response.data[0] : response.data;
  const policyId = idFromRelationship(resource, "policy");
  const productId = idFromRelationship(resource, "product");
  const plan = planForKeygenPolicy(policyId);
  const valid = response.meta?.valid === true;
  const code = String(response.meta?.code || (valid ? "VALID" : "INVALID"));
  const status: KeygenVerification["status"] = valid
    ? "ACTIVE"
    : ["SUSPENDED", "BANNED"].includes(code)
      ? "REVOKED"
      : "EXPIRED";
  const type = typeForKeygenPolicy(policyId);
  const attrs = resource?.attributes || {};
  const providerMetadata = attrs.metadata && typeof attrs.metadata === "object"
    ? Object.fromEntries(Object.entries(attrs.metadata as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
    : {};
  return {
    key,
    licenseId: resource?.id || "",
    policyId,
    productId,
    plan,
    type,
    valid,
    code,
    status,
    expiresAt: typeof attrs.expiry === "string" ? attrs.expiry : null,
    activationCount: Number(attrs.uses || 0),
    maxActivations: typeof attrs.maxUsers === "number" ? attrs.maxUsers : null,
    entitlementCodes,
    metadata: {
      ...providerMetadata,
      source: "keygen",
      keygenLicenseId: resource?.id || "",
      keygenPolicyId: policyId,
      keygenProductId: productId,
      plan: plan || "",
      billing: plan?.endsWith("quarterly") ? "quarterly" : plan?.endsWith("annual") ? "annual" : "monthly",
      entitlements: entitlementCodes.join(","),
    },
  };
}

export async function validateKeygenLicense(key: string): Promise<KeygenVerification> {
  const response = await request(
    "/licenses/actions/validate-key",
    {
      method: "POST",
      body: JSON.stringify({ meta: { key: key.trim(), scope: { product: keygenProductId() } } }),
    },
    false,
  );
  const resource = Array.isArray(response.data) ? response.data[0] : response.data;
  const licenseId = resource?.id || "";
  const entitlementCodes = response.meta?.valid && licenseId ? await entitlementCodesForLicense(licenseId) : [];
  return verificationFromResponse(key.trim(), response, entitlementCodes);
}

export async function createKeygenLicense(params: {
  plan: KeygenPlan;
  name?: string;
  expiresAt?: string;
  maxUsers?: number;
  metadata?: Record<string, string>;
}): Promise<KeygenVerification> {
  const attributes: Record<string, unknown> = {
    name: params.name || "NASAQ license",
    metadata: params.metadata || {},
  };
  if (params.expiresAt) attributes.expiry = params.expiresAt;
  if (params.maxUsers != null) attributes.maxUsers = params.maxUsers;
  const policyId = keygenPolicyId(params.plan);
  if (!policyId) throw new KeygenConfigurationError(`Keygen policy is not configured for ${params.plan}`);
  const response = await request("/licenses", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "licenses",
        attributes,
        relationships: { policy: { data: { type: "policies", id: policyId } } },
      },
    }),
  });
  const resource = Array.isArray(response.data) ? response.data[0] : response.data;
  const key = stringAttribute(resource, "key");
  if (!key) throw new KeygenRequestError("Keygen did not return a license key", 502);
  const entitlementCodes = await entitlementCodesForLicense(resource?.id || "");
  return verificationFromResponse(key, { ...response, meta: { valid: true, code: "VALID" } }, entitlementCodes);
}
export async function findKeygenLicenseByPaylinkTransaction(transactionNo: string): Promise<KeygenVerification | null> {
  const response = await request(`/licenses?metadata%5BpaylinkTransactionNo%5D=${encodeURIComponent(transactionNo)}&limit=1`);
  const resource = Array.isArray(response.data) ? response.data[0] : response.data;
  const key = stringAttribute(resource, "key");
  if (!resource || !key) return null;
  const attributes = resource.attributes || {};
  const expiry = stringAttribute(resource, "expiry");
  const suspended = attributes.suspended === true;
  const valid = !suspended && String(attributes.status || "ACTIVE").toUpperCase() !== "EXPIRED" && (!expiry || Date.parse(expiry) > Date.now());
  const entitlementCodes = await entitlementCodesForLicense(resource.id || "");
  return verificationFromResponse(key, { ...response, meta: { valid, code: valid ? "VALID" : "EXPIRED" } }, entitlementCodes);
}



export async function updateKeygenLicenseExpiry(licenseId: string, expiresAt: string): Promise<void> {
  await request(`/licenses/${encodeURIComponent(licenseId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      data: { type: "licenses", attributes: { expiry: expiresAt } },
    }),
  });
}

export async function suspendKeygenLicense(licenseId: string): Promise<void> {
  await request(`/licenses/${encodeURIComponent(licenseId)}/actions/suspend`, { method: "POST", body: JSON.stringify({}) });
}

export async function reinstateKeygenLicense(licenseId: string): Promise<void> {
  await request(`/licenses/${encodeURIComponent(licenseId)}/actions/reinstate`, { method: "POST", body: JSON.stringify({}) });
}
