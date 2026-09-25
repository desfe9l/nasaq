import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { normalizeLicenseKey } from "./key.ts";
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
  /** True only after validate-key with the authenticated session's user scope. */
  userScopeVerified: boolean;
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
  relationships?: Record<string, { data?: { id?: string; type?: string } | null; meta?: { count?: number } }>;
};

type KeygenResponse = {
  meta?: { valid?: boolean; code?: string; detail?: string };
  data?: KeygenResource | KeygenResource[];
  included?: KeygenResource[];
  errors?: Array<{ detail?: string }>;
};

/**
 * User-facing, Arabic message for every Keygen validation code.
 * Before it existed, any code outside 6 mapped ones collapsed into the vague
 * «تعذر التحقق من حالة الترخيص.» — which masked why valid-format keys failed.
 */
export const KEYGEN_CODE_MESSAGES: Record<string, string> = {
  NOT_FOUND: "مفتاح الترخيص غير صالح أو غير موجود.",
  EXPIRED: "انتهت صلاحية هذا الترخيص.",
  SUSPENDED: "تم تعليق هذا الترخيص. تواصل مع الدعم لمعرفة السبب.",
  BANNED: "تم إيقاف هذا الترخيص نهائيًا.",
  OVERDUE: "هذا الترخيص متأخر عن التجديد. جدد الاشتراك ثم أعد المحاولة.",
  NO_MACHINE: "هذا الترخيص يتطلب تفعيل جهاز قبل التحقق. تواصل مع الدعم.",
  NO_MACHINES: "هذا الترخيص لا يملك أجهزة مفعّلة. تواصل مع الدعم.",
  TOO_MANY_MACHINES: "تم الوصول إلى الحد الأقصى للأجهزة لهذا الترخيص.",
  TOO_MANY_CORES: "تم تجاوز الحد الأقصى لأنوية الأجهزة لهذا الترخيص.",
  TOO_MANY_USERS: "تم الوصول إلى الحد الأقصى لمستخدمي هذا الترخيص.",
  TOO_MANY_PROCESSES: "تم تجاوز الحد الأقصى للعمليات لهذا الترخيص.",
  PRODUCT_SCOPE_MISMATCH: "مفتاح الترخيص لا يخص منتج NASAQ.",
  POLICY_SCOPE_MISMATCH: "مفتاح الترخيص لا يطابق سياسة الترخيص المطلوبة.",
  KEY_SCOPE_MISMATCH: "صيغة مفتاح الترخيص غير معتمدة في هذا التحقق.",
  USER_SCOPE_REQUIRED: "يتطلب هذا الترخيص هوية حساب مسجّل الدخول للتحقق.",
  USER_SCOPE_MISMATCH: "مفتاح الترخيص لا يخص هذا المستخدم.",
  MACHINE_SCOPE_MISMATCH: "مفتاح الترخيص غير مفعّل لهذا الجهاز.",
  FINGERPRINT_SCOPE_MISMATCH: "بصمة الجهاز لا تطابق الترخيص.",
  HEARTBEAT_DEAD: "انقطع اتصال الترخيص بهذا الجهاز. أعد التفعيل.",
  HEARTBEAT_NOT_STARTED: "الترخيص لم يبدأ دورة نبض الجهاز بعد. تواصل مع الدعم.",
  METADATA_SCOPE_MISMATCH: "بيانات الترخيص لا تطابق المطلوب.",
  TOKEN_EXPIRED: "انتهت صلاحية رمز الوصول. أعد تسجيل الدخول ثم حاول مجددًا.",
};

/** Precise user-facing message for a Keygen verification result. */
export function keygenMessage(verification: KeygenVerification): string {
  const known = KEYGEN_CODE_MESSAGES[verification.code];
  if (known) return known;
  // Unknown provider codes stay DIAGNOSABLE — never the old blanket
  // «تعذر التحقق من حالة الترخيص» for every failure mode.
  return verification.code
    ? `تعذّر التحقق من الترخيص (${verification.code}). تواصل مع الدعم واذكر هذا الرمز.`
    : "تعذّر التحقق من الترخيص. تواصل مع الدعم.";
}

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

export class KeygenOwnershipError extends Error {
  constructor() {
    super("Keygen user belongs to a different NASAQ account");
    this.name = "KeygenOwnershipError";
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

/** Safe admin diagnostic. Reads only; never creates or modifies a licence. */
export async function checkKeygenApiConnection(): Promise<void> {
  await request("/licenses?limit=1");
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
  const response = await fetch(apiUrl(path), { ...init, headers,
    signal: init.signal ?? AbortSignal.timeout(12_000) });
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

function verificationFromResponse(key: string, response: KeygenResponse, entitlementCodes: string[], scoped = false): KeygenVerification {
  const resource = Array.isArray(response.data) ? response.data[0] : response.data;
  const policyId = idFromRelationship(resource, "policy");
  const productId = idFromRelationship(resource, "product");
  const plan = planForKeygenPolicy(policyId);
  // A provider response without an actual license for our product is never an
  // entitlement, even if a malformed upstream response says meta.valid=true.
  const valid = response.meta?.valid === true && resource?.type === "licenses" && Boolean(resource.id) && productId === keygenProductId();
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
    userScopeVerified: scoped && valid,
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

function userScope(email: string): { product: string; user: string } {
  // Keygen's scope.user is a Keygen user UUID *or email*, not the Better Auth
  // user.id. Only server functions may supply the email from the verified session.
  const user = email?.trim().toLowerCase();
  if (!user || !user.includes("@")) throw new KeygenConfigurationError("Verified session email is required for Keygen user scope");
  return { product: keygenProductId(), user };
}

export async function validateKeygenLicense(key: string, sessionEmail: string): Promise<KeygenVerification> {
  // Do not relax a user-locked policy: both activation and later validation
  // must supply the same identity, obtained server-side from Better Auth.
  const normalizedKey = normalizeLicenseKey(key);
  const response = await request(
    "/licenses/actions/validate-key",
    {
      method: "POST",
      body: JSON.stringify({ meta: { key: normalizedKey, scope: userScope(sessionEmail) } }),
    },
    false,
  );
  const resource = Array.isArray(response.data) ? response.data[0] : response.data;
  const licenseId = resource?.id || "";
  const entitlementCodes = response.meta?.valid && licenseId ? await entitlementCodesForLicense(licenseId) : [];
  return verificationFromResponse(normalizedKey, response, entitlementCodes, true);
}

/** Revalidate a linked license after reload, without a browser-stored plaintext key. */
export async function validateKeygenLicenseById(licenseId: string, sessionEmail: string): Promise<KeygenVerification> {
  const response = await request(`/licenses/${encodeURIComponent(licenseId)}`); // license.read
  const resource = Array.isArray(response.data) ? response.data[0] : response.data;
  const key = stringAttribute(resource, "key");
  if (resource?.type !== "licenses" || resource.id !== licenseId || !key ||
      idFromRelationship(resource, "product") !== keygenProductId()) {
    throw new KeygenRequestError("Keygen did not return the requested product license", 502);
  }
  return validateKeygenLicense(key, sessionEmail);
}

/** Authoritative (authenticated) read before a first-come claim of an unowned key. */
export async function getKeygenLicenseForClaim(licenseId: string): Promise<{
  id: string;
  key: string;
  productId: string;
  policyId: string;
  paylinkTransactionNo: string | null;
  ownerId: string | null | undefined;
  usersCount: number | null;
  nasaqUserId: string | null;
  expiresAt: string | null;
  suspended: boolean;
  status: string;
}> {
  const response = await request(`/licenses/${encodeURIComponent(licenseId)}`);
  const resource = Array.isArray(response.data) ? response.data[0] : response.data;
  if (resource?.type !== "licenses" || resource.id !== licenseId) throw new KeygenRequestError("Keygen license not found", 404);
  const owner = resource.relationships?.owner;
  const count = resource.relationships?.users?.meta?.count;
  const metadata = resource.attributes?.metadata;
  return {
    id: licenseId,
    key: stringAttribute(resource, "key") || "",
    productId: idFromRelationship(resource, "product"),
    policyId: idFromRelationship(resource, "policy"),
    paylinkTransactionNo: metadata && typeof metadata === "object" && typeof (metadata as Record<string, unknown>).paylinkTransactionNo === "string"
      ? (metadata as Record<string, string>).paylinkTransactionNo : null,
    // An omitted relationship is NOT an empty one: fail closed on unknown data.
    ownerId: owner?.data === null ? null : owner?.data?.id,
    usersCount: typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null,
    nasaqUserId: metadata && typeof metadata === "object" && typeof (metadata as Record<string, unknown>).nasaqUserId === "string"
      ? (metadata as Record<string, string>).nasaqUserId : null,
    expiresAt: stringAttribute(resource, "expiry"),
    suspended: resource.attributes?.suspended === true,
    status: String(resource.attributes?.status || ""),
  };
}

/** Locate or create a passwordless Keygen user for the verified NASAQ identity. */
export async function ensureKeygenUser(session: { userId: string; userEmail: string }, create = true): Promise<string> {
  const email = userScope(session.userEmail).user;
  const path = `/users/${encodeURIComponent(email)}`;
  let response: KeygenResponse;
  try {
    response = await request(path); // user.read; never create one for an invalid key
  } catch (error) {
    if (!(error instanceof KeygenRequestError) || error.status !== 404 || !create) throw error;
    try {
      response = await request("/users", {
        method: "POST",
        body: JSON.stringify({ data: { type: "users", attributes: {
          email, metadata: { nasaqUserId: session.userId },
        } } }),
      }); // user.create
    } catch (createError) {
      // Another request may have created this email concurrently.
      if (!(createError instanceof KeygenRequestError) || createError.status !== 409) throw createError;
      response = await request(path);
    }
  }
  const user = Array.isArray(response.data) ? response.data[0] : response.data;
  const metadata = user?.attributes?.metadata;
  const nasaqId = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).nasaqUserId : undefined;
  if (user?.type !== "users" || !user.id || stringAttribute(user, "email")?.toLowerCase() !== email) {
    throw new KeygenRequestError("Keygen user identity mismatch", 502);
  }
  if (nasaqId != null && nasaqId !== session.userId) throw new KeygenOwnershipError();
  return user.id;
}

/** Attach a single user (least privilege), not a license-owner transfer. */
export async function attachKeygenUser(licenseId: string, keygenUserId: string): Promise<void> {
  await request(`/licenses/${encodeURIComponent(licenseId)}/users`, {
    method: "POST",
    body: JSON.stringify({ data: [{ type: "users", id: keygenUserId }] }),
  }); // license.users.attach
}

export async function createKeygenLicense(params: {
  plan: KeygenPlan;
  name?: string;
  expiresAt?: string;
  maxUsers?: number;
  metadata?: Record<string, string>;
  ownerId?: string; // Keygen user UUID, resolved from the NASAQ account before issuance
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
        relationships: {
          policy: { data: { type: "policies", id: policyId } },
          ...(params.ownerId ? { owner: { data: { type: "users", id: params.ownerId } } } : {}),
        },
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



export async function updateKeygenLicenseExpiry(licenseId: string, expiresAt: string | null): Promise<void> {
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
