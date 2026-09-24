import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Sql } from "@/lib/db";
import { normalizeSection, type CommercialSettings } from "@/lib/admin/types";
import { paylinkPlanKey, type PaylinkInvoiceResult, type PaylinkPeriod, type PaylinkPlanFamily, type PaylinkPlanKey } from "./types";

const TOKEN_TTL_MS = 25 * 60 * 1000;
const globalRef = globalThis as typeof globalThis & {
  __paylinkTokenCache__?: { value: string; expiresAt: number; baseUrl: string };
};

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function apiBaseUrl(): string {
  const value = env("PAYLINK_API_BASE_URL") || "https://restapi.paylink.sa";
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("PAYLINK_API_BASE_URL is invalid"); }
  if (url.protocol !== "https:") throw new Error("PAYLINK_API_BASE_URL must use HTTPS");
  return url.origin;
}

function publicBaseUrl(): string {
  const value = env("PAYLINK_PUBLIC_URL") || env("BETTER_AUTH_URL");
  if (!value) throw new Error("PAYLINK_PUBLIC_URL is not configured");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("PAYLINK_PUBLIC_URL is invalid"); }
  if (url.protocol !== "https:") throw new Error("PAYLINK_PUBLIC_URL must use HTTPS");
  return url.origin;
}

function credentials(): { apiId: string; secretKey: string } {
  const apiId = env("PAYLINK_API_ID");
  const secretKey = env("PAYLINK_SECRET_KEY");
  if (!apiId || !secretKey) throw new Error("Paylink credentials are not configured");
  return { apiId, secretKey };
}

function secureBearerMatch(expected: string, actual: string): boolean {
  const left = Buffer.from(`Bearer ${expected}`);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyPaylinkWebhookAuthorization(request: Request): boolean {
  const expected = env("PAYLINK_WEBHOOK_TOKEN");
  const actual = request.headers.get("authorization")?.trim() || "";
  return Boolean(expected && secureBearerMatch(expected, actual));
}

async function accessToken(): Promise<string> {
  const baseUrl = apiBaseUrl();
  const cached = globalRef.__paylinkTokenCache__;
  if (cached && cached.baseUrl === baseUrl && cached.expiresAt > Date.now() + 30_000) return cached.value;
  const { apiId, secretKey } = credentials();
  const response = await fetch(`${baseUrl}/api/auth`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ apiId, secretKey, persistToken: true }),
  });
  const body = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
  const token = typeof body?.id_token === "string" ? body.id_token.trim() : "";
  if (!response.ok || !token) throw new Error("Paylink authentication failed");
  globalRef.__paylinkTokenCache__ = { value: token, expiresAt: Date.now() + TOKEN_TTL_MS, baseUrl };
  return token;
}

type PaylinkApiResponse = {
  success?: boolean; transactionNo?: unknown; orderNumber?: unknown; orderStatus?: unknown;
  amount?: unknown; url?: unknown; detail?: unknown; title?: unknown;
  gatewayOrderRequest?: { orderNumber?: unknown; amount?: unknown } | null;
};

async function paylinkRequest(path: string, init: RequestInit = {}): Promise<PaylinkApiResponse> {
  const token = await accessToken();
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const body = (await response.json().catch(() => null)) as PaylinkApiResponse | null;
  if (!response.ok || body?.success === false) throw new Error(String(body?.detail || body?.title || "Paylink request failed"));
  return body || {};
}

async function commercialSettings(sql: Sql): Promise<CommercialSettings> {
  const rows = await sql.query<{ value: unknown }>("select value from site_settings where key = $1 limit 1", ["commercial"]);
  let raw: unknown = rows[0]?.value ?? null;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = null; } }
  return normalizeSection("commercial", raw);
}

type PlanDefinition = {
  planKey: PaylinkPlanKey;
  planId: string;
  title: string;
  description: string;
  amount: number;
  durationDays: number;
  family: PaylinkPlanFamily;
  period: PaylinkPeriod;
};

export async function getPaylinkPlanDefinition(sql: Sql, family: PaylinkPlanFamily, period: PaylinkPeriod): Promise<PlanDefinition> {
  const settings = await commercialSettings(sql);
  const monthly = family === "individual" ? settings.priceIndividualMonthly : settings.priceTeamMonthly;
  const amount = period === "monthly" ? monthly : Math.round(monthly * 12 * (1 - settings.annualDiscountPercent / 100));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Plan price is not configured");
  const planKey = paylinkPlanKey(family, period);
  const planId = period === "monthly" ? "monthly" : "annual";
  const title = family === "individual"
    ? (period === "monthly" ? "NASAQ individual monthly license" : "NASAQ individual annual license")
    : (period === "monthly" ? "NASAQ team monthly license" : "NASAQ team annual license");
  return { planKey, planId, title, description: "NASAQ software license", amount, durationDays: period === "monthly" ? 30 : 365, family, period };
}
export async function createPaylinkInvoice(input: {
  sql: Sql;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  family: PaylinkPlanFamily;
  period: PaylinkPeriod;
  clientMobile: string;
}): Promise<PaylinkInvoiceResult> {
  const plan = await getPaylinkPlanDefinition(input.sql, input.family, input.period);
  const mobile = input.clientMobile.replace(/\D/g, "");
  if (mobile.length < 8 || mobile.length > 20) return { ok: false, error: "رقم الجوال غير صالح" };
  const id = `pay_${randomUUID()}`;
  const orderNumber = `NASAQ-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const publicUrl = publicBaseUrl();
  const clientName = input.userName?.trim() || "NASAQ customer";
  await input.sql`
    insert into paylink_transactions
      (id, user_id, order_number, plan_key, plan_id, amount, currency, client_email, client_mobile)
    values
      (${id}, ${input.userId}, ${orderNumber}, ${plan.planKey}, ${plan.planId}, ${plan.amount}, 'SAR', ${input.userEmail || null}, ${mobile})
  `;
  try {
    const body = await paylinkRequest("/api/addInvoice", {
      method: "POST",
      body: JSON.stringify({
        orderNumber,
        amount: plan.amount,
        callBackUrl: `${publicUrl}/payment/success`,
        cancelUrl: `${publicUrl}/payment/cancel`,
        clientName,
        clientEmail: input.userEmail || undefined,
        clientMobile: mobile,
        currency: "SAR",
        products: [{ title: plan.title, price: plan.amount, qty: 1, description: plan.description, isDigital: true }],
      }),
    });
    const transactionNo = String(body.transactionNo || "").trim();
    const paymentUrl = String(body.url || "").trim();
    if (!transactionNo || !paymentUrl) throw new Error("Paylink did not return a payment URL");
    await input.sql`
      update paylink_transactions
      set transaction_no = ${transactionNo}, paylink_order_status = ${String(body.orderStatus || "PENDING")}, paylink_payment_url = ${paymentUrl}, updated_at = now()
      where id = ${id}
    `;
    return { ok: true, paymentUrl, transactionNo, orderNumber };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paylink invoice creation failed";
    await input.sql`update paylink_transactions set status = 'FAILED', last_error = ${message.slice(0, 500)}, updated_at = now() where id = ${id}`;
    return { ok: false, error: "تعذر إنشاء فاتورة الدفع. حاول مرة أخرى." };
  }
}

export async function getPaylinkInvoice(transactionNo: string): Promise<PaylinkApiResponse> {
  return paylinkRequest(`/api/getInvoice/${encodeURIComponent(transactionNo)}`);
}

export function paylinkOrderStatus(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
