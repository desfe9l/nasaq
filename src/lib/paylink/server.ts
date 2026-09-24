import { getPurchasablePlan } from "../commercial/plans.server.ts";
import { keygenPolicyId } from "../license/keygen.ts";
import { listCatalogPlans } from "../commercial/catalog.ts";
import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  PAYLINK_PAYMENT_TYPE_LABELS,
  PAYLINK_WEBHOOK_API_VERSION,
  PAYLINK_WEBHOOK_PATH,
} from "./contract.ts";
import type { Sql } from "../db.ts";

// Re-exported so existing server-side imports keep working. The values live in
// `contract.ts` because client components need them too, and this module pulls
// in `node:crypto`.
export {
  PAYLINK_PAYMENT_TYPE_LABELS,
  PAYLINK_WEBHOOK_API_VERSION,
  PAYLINK_WEBHOOK_PATH,
};
import {
  getCatalogPlan,
  paylinkPlanKey,
  requireCatalogPlan,
  type CatalogPlan,
  type PaylinkInvoiceResult,
  type PaylinkPeriod,
  type PaylinkPlanFamily,
  type PaylinkPlanKey,
} from "./types.ts";

const TOKEN_TTL_MS = 25 * 60 * 1000;
const globalRef = globalThis as typeof globalThis & {
  __paylinkTokenCache__?: { value: string; expiresAt: number; baseUrl: string };
};

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function apiBaseUrl(): string {
  const value = env("PAYLINK_API_BASE_URL") || "https://restapi.paylink.sa";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PAYLINK_API_BASE_URL is invalid");
  }
  if (url.protocol !== "https:")
    throw new Error("PAYLINK_API_BASE_URL must use HTTPS");
  return url.origin;
}

export function publicBaseUrl(): string {
  const value =
    env("PAYLINK_PUBLIC_URL") ||
    env("BETTER_AUTH_URL") ||
    "https://nasaq-sa.vercel.app";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PAYLINK_PUBLIC_URL is invalid");
  }
  if (url.protocol !== "https:")
    throw new Error("PAYLINK_PUBLIC_URL must use HTTPS");
  return url.origin;
}

function credentials(): { apiId: string; secretKey: string } {
  const apiId = env("PAYLINK_API_ID");
  const secretKey = env("PAYLINK_SECRET_KEY");
  if (!apiId || !secretKey)
    throw new Error("Paylink credentials are not configured");
  return { apiId, secretKey };
}

function secureBearerMatch(expected: string, actual: string): boolean {
  const left = Buffer.from(`Bearer ${expected}`);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The absolute webhook URL to paste into My Paylink (derived, never hard-coded). */
export function paylinkWebhookUrl(): string {
  return `${publicBaseUrl()}${PAYLINK_WEBHOOK_PATH}`;
}

/**
 * Strict webhook authentication.
 *
 * The header is the merchant-defined one from My Paylink → Webhook settings
 * (`Authorization: Bearer <token>`), compared with a length-checked
 * constant-time comparison so neither the value nor its length leaks through
 * timing. An unset token fails closed: a deployment that forgot to configure
 * `PAYLINK_WEBHOOK_TOKEN` must reject callbacks rather than accept them.
 */
export function verifyPaylinkWebhookAuthorization(request: Request): boolean {
  const expected = env("PAYLINK_WEBHOOK_TOKEN");
  const actual = request.headers.get("authorization")?.trim() || "";
  return Boolean(expected && secureBearerMatch(expected, actual));
}

async function accessToken(): Promise<string> {
  const baseUrl = apiBaseUrl();
  const cached = globalRef.__paylinkTokenCache__;
  if (
    cached &&
    cached.baseUrl === baseUrl &&
    cached.expiresAt > Date.now() + 30_000
  ) {
    return cached.value;
  }
  const { apiId, secretKey } = credentials();
  const response = await fetch(`${baseUrl}/api/auth`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ apiId, secretKey, persistToken: true }),
  });
  const body = (await response.json().catch(() => null)) as {
    id_token?: unknown;
  } | null;
  const token = typeof body?.id_token === "string" ? body.id_token.trim() : "";
  if (!response.ok || !token) throw new Error("Paylink authentication failed");
  globalRef.__paylinkTokenCache__ = {
    value: token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
    baseUrl,
  };
  return token;
}

export type PaylinkApiResponse = {
  success?: boolean;
  transactionNo?: unknown;
  orderNumber?: unknown;
  orderStatus?: unknown;
  amount?: unknown;
  url?: unknown;
  detail?: unknown;
  title?: unknown;
  gatewayOrderRequest?: {
    orderNumber?: unknown;
    amount?: unknown;
    products?: Array<{
      title?: string;
      price?: number;
      qty?: number;
      description?: string;
      isDigital?: boolean;
    }>;
  } | null;
};

async function paylinkRequest(
  path: string,
  init: RequestInit = {},
): Promise<PaylinkApiResponse> {
  const token = await accessToken();
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const body = (await response
    .json()
    .catch(() => null)) as PaylinkApiResponse | null;
  if (!response.ok || body?.success === false) {
    throw new Error(
      String(body?.detail || body?.title || "Paylink request failed"),
    );
  }
  return body || {};
}

/**
 * Returns the authoritative plan definition directly from NASAQ's central catalog.
 */
export function getPaylinkPlanDefinition(
  planKeyOrFamily: PaylinkPlanKey | PaylinkPlanFamily,
  period?: PaylinkPeriod,
): CatalogPlan {
  const key: PaylinkPlanKey = period
    ? paylinkPlanKey(planKeyOrFamily as PaylinkPlanFamily, period)
    : (planKeyOrFamily as PaylinkPlanKey);
  return requireCatalogPlan(key);
}

/**
 * Pure builder for Paylink addInvoice payload.
 * Fully compliant with Paylink official documentation.
 */
export function buildPaylinkInvoicePayload(params: {
  plan: CatalogPlan;
  orderNumber: string;
  publicUrl: string;
  clientName: string;
  clientEmail?: string | null;
  clientMobile: string;
}) {
  const plan = requireCatalogPlan(params.plan.key);
  return {
    orderNumber: params.orderNumber,
    amount: plan.amount,
    callBackUrl: `${params.publicUrl}/payment/success`,
    cancelUrl: `${params.publicUrl}/payment/cancel`,
    clientName: params.clientName,
    clientEmail: params.clientEmail || undefined,
    clientMobile: params.clientMobile,
    currency: "SAR",
    products: [
      {
        title: plan.title,
        price: plan.amount,
        qty: 1,
        description: plan.description,
        isDigital: true,
      },
    ],
  };
}

export function checkoutAvailability(): Record<string, boolean> {
  const ready = Boolean(
    env("PAYLINK_API_ID") &&
    env("PAYLINK_SECRET_KEY") &&
    env("PAYLINK_WEBHOOK_TOKEN") &&
    env("KEYGEN_API_TOKEN"),
  );
  return Object.fromEntries(
    listCatalogPlans().map((p) => [
      p.key,
      ready && Boolean(keygenPolicyId(p.keygenPolicyKey)),
    ]),
  );
}

export async function createPaylinkInvoice(input: {
  sql: Sql;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  planKey?: PaylinkPlanKey;
  family?: PaylinkPlanFamily;
  period?: PaylinkPeriod;
  clientMobile: string;
}): Promise<PaylinkInvoiceResult> {
  const planKey =
    input.planKey ??
    (input.family && input.period
      ? paylinkPlanKey(input.family, input.period)
      : null);
  if (!planKey) {
    return { ok: false, error: "الباقة المطلوبة غير صالحة" };
  }
  const plan = getCatalogPlan(planKey);
  if (!plan) {
    return { ok: false, error: "الباقة غير متوفرة في الكتالوج المعتمد" };
  }

  if (!checkoutAvailability()[plan.key]) {
    return {
      ok: false,
      error: "الدفع قريبًا — لم يكتمل ربط الدفع لهذه الباقة بعد.",
    };
  }

  const mobile = input.clientMobile.replace(/\D/g, "");
  if (mobile.length < 8 || mobile.length > 20) {
    return { ok: false, error: "رقم الجوال غير صالح" };
  }

  if (!(await getPurchasablePlan(input.sql, plan.key))) {
    return { ok: false, error: "الباقة غير متاحة للشراء حاليًا" };
  }

  const id = `pay_${randomUUID()}`;
  const orderNumber = `NASAQ-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const publicUrl = publicBaseUrl();
  const clientName = input.userName?.trim() || "عميل نَسَق";

  await input.sql`
    insert into paylink_transactions
      (id, user_id, order_number, plan_key, plan_id, amount, currency, client_email, client_mobile)
    values
      (${id}, ${input.userId}, ${orderNumber}, ${plan.key}, ${plan.key}, ${plan.amount}, 'SAR', ${input.userEmail || null}, ${mobile})
  `;

  try {
    const payload = buildPaylinkInvoicePayload({
      plan,
      orderNumber,
      publicUrl,
      clientName,
      clientEmail: input.userEmail,
      clientMobile: mobile,
    });

    const body = await paylinkRequest("/api/addInvoice", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const transactionNo = String(body.transactionNo || "").trim();
    const paymentUrl = String(body.url || "").trim();
    if (!transactionNo || !paymentUrl) {
      throw new Error("Paylink did not return a payment URL");
    }

    await input.sql`
      update paylink_transactions
      set transaction_no = ${transactionNo},
          paylink_order_status = ${String(body.orderStatus || "PENDING")},
          paylink_payment_url = ${paymentUrl},
          updated_at = now()
      where id = ${id}
    `;

    return { ok: true, paymentUrl, transactionNo, orderNumber };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Paylink invoice creation failed";
    await input.sql`
      update paylink_transactions
      set status = 'FAILED', last_error = ${message.slice(0, 500)}, updated_at = now()
      where id = ${id}
    `;
    return { ok: false, error: "تعذر إنشاء فاتورة الدفع. حاول مرة أخرى." };
  }
}

export async function getPaylinkInvoice(
  transactionNo: string,
): Promise<PaylinkApiResponse> {
  return paylinkRequest(`/api/getInvoice/${encodeURIComponent(transactionNo)}`);
}

export function paylinkOrderStatus(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
