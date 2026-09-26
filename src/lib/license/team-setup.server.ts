/**
 * Team licensing activation: verify the real Keygen account and repair what
 * NASAQ's feature gates need, using only the token already present in the
 * server environment.
 *
 * Scope discipline:
 *   · Reads and repairs POLICY WIRING only — entitlements and their attachment
 *     to the Team policies, plus (when explicitly repairing) a missing Team
 *     Monthly/Quarterly policy. It never creates a licence, an order or a
 *     payment of any kind.
 *   · Never returns, logs or renders the token, an Authorization header, or a
 *     licence key. Results are booleans, codes and short Arabic reasons.
 *   · The licence→entitlement→editor logic in `types.ts` / `keygen.ts` is left
 *     untouched; this module only makes the provider match what that logic
 *     already expects.
 */
import { keygenAccount, keygenPolicyId, keygenProductId, type KeygenPlan } from "./keygen.ts";
import { entitlementsFromKeygenCodes, KEYGEN_ENTITLEMENT_FEATURES } from "./types.ts";
import type { FeatureId } from "./types.ts";

const API_ORIGIN = "https://api.keygen.sh/v1/accounts";

/** Entitlement codes a Team policy must carry for the full NASAQ feature set. */
export const TEAM_ENTITLEMENT_CODES = [
  "nasaq.team",
  "nasaq.editor",
  "nasaq.templates",
  "nasaq.projects",
  "nasaq.library",
  "nasaq.export",
  "nasaq.advanced-export",
  "nasaq.brand-kit",
  "nasaq.advanced-tools",
] as const;

/** Team plans NASAQ knows about. `team-lifetime` has no plan by design. */
export const TEAM_PLANS = ["team-monthly", "team-quarterly", "team-annual"] as const;
export type TeamPlan = (typeof TEAM_PLANS)[number];

const PLAN_DURATION_SECONDS: Record<TeamPlan, number> = {
  "team-monthly": 2_592_000, // 30 days
  "team-quarterly": 7_776_000, // 90 days
  "team-annual": 31_536_000, // 365 days
};

const PLAN_LABELS: Record<TeamPlan, string> = {
  "team-monthly": "Team Monthly",
  "team-quarterly": "Team Quarterly",
  "team-annual": "Team Annual",
};

export type StepState = "ready" | "missing" | "failed";

export type TeamStep = {
  step: string;
  state: StepState;
  detail: string;
};

export type TeamPlanReport = {
  plan: TeamPlan;
  label: string;
  /** Present only so the owner can copy it into the env var. Not a secret. */
  policyId: string | null;
  state: StepState;
  detail: string;
  entitlementCodes: string[];
  missingCodes: string[];
  /** Editor features the policy's real codes unlock, per NASAQ's own mapping. */
  editorFeatures: FeatureId[];
  repaired: string[];
};

export type TeamSetupReport = {
  configured: boolean;
  connected: boolean;
  repairAttempted: boolean;
  account: string;
  productId: string;
  steps: TeamStep[];
  plans: TeamPlanReport[];
  lifetime: TeamStep;
  missingEnvVars: string[];
};

type JsonApiResource = {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id?: string } | null }>;
};

type JsonApiBody = {
  data?: JsonApiResource | JsonApiResource[];
  errors?: Array<{ detail?: string; title?: string; code?: string }>;
};

class KeygenAdminError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function token(): string | undefined {
  return process.env.KEYGEN_API_TOKEN?.trim() || undefined;
}

/**
 * Keygen admin call. The Authorization header is built here and never stored,
 * echoed or logged — error paths surface the status and Keygen's own `detail`
 * text only.
 */
async function api(path: string, init: RequestInit = {}): Promise<JsonApiBody> {
  const secret = token();
  if (!secret) throw new KeygenAdminError("KEYGEN_API_TOKEN غير مضبوط", 0);
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.api+json");
  headers.set("Content-Type", "application/vnd.api+json");
  headers.set("Authorization", `Bearer ${secret}`);
  const response = await fetch(`${API_ORIGIN}/${keygenAccount()}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body: JsonApiBody = {};
  try {
    body = text ? (JSON.parse(text) as JsonApiBody) : {};
  } catch {
    throw new KeygenAdminError("استجابة غير صالحة من Keygen", response.status);
  }
  if (!response.ok) {
    throw new KeygenAdminError(body.errors?.[0]?.detail || "فشل طلب Keygen", response.status);
  }
  return body;
}

function asList(body: JsonApiBody): JsonApiResource[] {
  return Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];
}

function reason(error: unknown): string {
  if (error instanceof KeygenAdminError) {
    if (error.status === 401 || error.status === 403) return "التوكن الحالي لا يملك صلاحية لهذه العملية.";
    if (error.status === 404) return "المورد غير موجود في حساب Keygen.";
    return error.message;
  }
  return "تعذر الوصول إلى Keygen.";
}

/** Editor features the given entitlement codes actually unlock. */
export function editorFeaturesForCodes(codes: string[]): FeatureId[] {
  const entitlements = entitlementsFromKeygenCodes(codes);
  return (Object.keys(entitlements) as FeatureId[]).filter((feature) => entitlements[feature]);
}

/** Every entitlement in the account, code → id. */
async function accountEntitlements(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let page = 1;
  // Paginate: an account with many entitlements must not silently truncate,
  // or a present code would look "missing" and get created twice.
  for (; page <= 10; page += 1) {
    const body = await api(`/entitlements?page[size]=100&page[number]=${page}`);
    const items = asList(body);
    for (const item of items) {
      const code = item.attributes?.code;
      if (typeof code === "string" && item.id) map.set(code, item.id);
    }
    if (items.length < 100) break;
  }
  return map;
}

async function policyEntitlementCodes(policyId: string): Promise<string[]> {
  const body = await api(`/policies/${policyId}/entitlements?page[size]=100`);
  return asList(body)
    .map((item) => item.attributes?.code)
    .filter((code): code is string => typeof code === "string");
}

async function createEntitlement(code: string): Promise<string> {
  const body = await api("/entitlements", {
    method: "POST",
    body: JSON.stringify({
      data: { type: "entitlements", attributes: { name: code, code } },
    }),
  });
  const id = (Array.isArray(body.data) ? body.data[0] : body.data)?.id;
  if (!id) throw new KeygenAdminError("لم يُرجع Keygen معرّف الـentitlement", 0);
  return id;
}

async function attachEntitlements(policyId: string, entitlementIds: string[]): Promise<void> {
  await api(`/policies/${policyId}/entitlements`, {
    method: "POST",
    body: JSON.stringify({
      data: entitlementIds.map((id) => ({ type: "entitlements", id })),
    }),
  });
}

async function createTeamPolicy(plan: TeamPlan): Promise<string> {
  const body = await api("/policies", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "policies",
        attributes: {
          name: `NASAQ ${PLAN_LABELS[plan]}`,
          duration: PLAN_DURATION_SECONDS[plan],
          // Team = multi-seat; the rest mirrors the existing NASAQ policies.
          maxMachines: 5,
          floating: true,
          strict: true,
          requireHeartbeat: false,
          authenticationStrategy: "LICENSE",
          expirationStrategy: "RESTRICT_ACCESS",
        },
        relationships: {
          product: { data: { type: "products", id: keygenProductId() } },
        },
      },
    }),
  });
  const id = (Array.isArray(body.data) ? body.data[0] : body.data)?.id;
  if (!id) throw new KeygenAdminError("لم يُرجع Keygen معرّف السياسة", 0);
  return id;
}

async function inspectPlan(plan: TeamPlan, repair: boolean, catalogue: Map<string, string> | null): Promise<TeamPlanReport> {
  const base: TeamPlanReport = {
    plan,
    label: PLAN_LABELS[plan],
    policyId: null,
    state: "missing",
    detail: "",
    entitlementCodes: [],
    missingCodes: [...TEAM_ENTITLEMENT_CODES],
    editorFeatures: [],
    repaired: [],
  };

  let policyId = keygenPolicyId(plan as KeygenPlan);

  if (!policyId) {
    // team-annual is intentionally unconfigured; only the two paid Team plans
    // NASAQ sells are worth creating, and only when repairing.
    if (!repair || plan === "team-annual") {
      return { ...base, detail: "لا يوجد Policy ID — الخطة غير مفعّلة" };
    }
    try {
      policyId = await createTeamPolicy(plan);
      base.repaired.push(`أُنشئت السياسة (${policyId})`);
    } catch (error) {
      return { ...base, state: "failed", detail: `تعذر إنشاء السياسة: ${reason(error)}` };
    }
  }

  base.policyId = policyId;

  let codes: string[];
  try {
    await api(`/policies/${policyId}`);
    codes = await policyEntitlementCodes(policyId);
  } catch (error) {
    return { ...base, state: "failed", detail: reason(error) };
  }

  let missing = TEAM_ENTITLEMENT_CODES.filter((code) => !codes.includes(code));

  if (missing.length > 0 && repair && catalogue) {
    const attach: string[] = [];
    for (const code of missing) {
      try {
        const id = catalogue.get(code) ?? (await createEntitlement(code));
        catalogue.set(code, id);
        attach.push(id);
      } catch (error) {
        base.repaired.push(`تعذر تجهيز ${code}: ${reason(error)}`);
      }
    }
    if (attach.length > 0) {
      try {
        await attachEntitlements(policyId, attach);
        base.repaired.push(`رُبطت ${attach.length} entitlement بالسياسة`);
        codes = await policyEntitlementCodes(policyId);
        missing = TEAM_ENTITLEMENT_CODES.filter((code) => !codes.includes(code));
      } catch (error) {
        base.repaired.push(`تعذر الربط: ${reason(error)}`);
      }
    }
  }

  const editorFeatures = editorFeaturesForCodes(codes);
  return {
    ...base,
    entitlementCodes: codes,
    missingCodes: [...missing],
    editorFeatures,
    state: missing.length === 0 ? "ready" : "missing",
    detail:
      missing.length === 0
        ? `كل الأكواد التسعة مرتبطة — ${editorFeatures.length} ميزة محرر مفعّلة`
        : `ناقص: ${missing.join(", ")}`,
  };
}

/** Which env vars are genuinely absent (names only — never values). */
export function missingTeamEnvVars(): string[] {
  const missing: string[] = [];
  if (!token()) missing.push("KEYGEN_API_TOKEN");
  for (const plan of ["team-monthly", "team-quarterly"] as const) {
    if (!keygenPolicyId(plan)) {
      missing.push(`KEYGEN_POLICY_${plan.toUpperCase().replaceAll("-", "_")}_ID`);
    }
  }
  return missing;
}

/**
 * Verify (and optionally repair) Team licensing against the real Keygen
 * account. Safe to run repeatedly: every repair is idempotent.
 */
export async function verifyAndRepairTeam(repair = false): Promise<TeamSetupReport> {
  const steps: TeamStep[] = [];
  const report: TeamSetupReport = {
    configured: Boolean(token()),
    connected: false,
    repairAttempted: repair,
    account: keygenAccount(),
    productId: keygenProductId(),
    steps,
    plans: [],
    lifetime: {
      step: "Team Lifetime",
      state: "missing",
      detail: "لا توجد خطة team-lifetime في NASAQ ولا Policy ID لها — غير مفعّلة",
    },
    missingEnvVars: missingTeamEnvVars(),
  };

  if (!report.configured) {
    steps.push({ step: "KEYGEN_API_TOKEN", state: "missing", detail: "غير مضبوط في بيئة الخادم" });
    report.plans = TEAM_PLANS.map((plan) => ({
      plan,
      label: PLAN_LABELS[plan],
      policyId: keygenPolicyId(plan as KeygenPlan) || null,
      state: "missing",
      detail: "لا يمكن التحقق بدون التوكن",
      entitlementCodes: [],
      missingCodes: [...TEAM_ENTITLEMENT_CODES],
      editorFeatures: [],
      repaired: [],
    }));
    return report;
  }
  steps.push({ step: "KEYGEN_API_TOKEN", state: "ready", detail: "مضبوط (لا يُعرض)" });

  // Account
  try {
    await api("");
    report.connected = true;
    steps.push({ step: "Account", state: "ready", detail: report.account });
  } catch (error) {
    steps.push({ step: "Account", state: "failed", detail: reason(error) });
    return report;
  }

  // Product
  try {
    const body = await api(`/products/${report.productId}`);
    const name = (Array.isArray(body.data) ? body.data[0] : body.data)?.attributes?.name;
    steps.push({ step: "Product", state: "ready", detail: String(name ?? report.productId) });
  } catch (error) {
    steps.push({ step: "Product", state: "failed", detail: reason(error) });
  }

  let catalogue: Map<string, string> | null = null;
  if (repair) {
    try {
      catalogue = await accountEntitlements();
      steps.push({
        step: "Entitlement catalogue",
        state: "ready",
        detail: `${catalogue.size} entitlement في الحساب`,
      });
    } catch (error) {
      steps.push({ step: "Entitlement catalogue", state: "failed", detail: reason(error) });
    }
  }

  for (const plan of TEAM_PLANS) {
    report.plans.push(await inspectPlan(plan, repair, catalogue));
  }

  // Mapping sanity: the codes NASAQ reads must all exist in its own map, or a
  // correctly configured Keygen policy would still unlock nothing.
  const unmapped = TEAM_ENTITLEMENT_CODES.filter((code) => !(code in KEYGEN_ENTITLEMENT_FEATURES));
  steps.push({
    step: "خريطة NASAQ للأكواد",
    state: unmapped.length === 0 ? "ready" : "failed",
    detail: unmapped.length === 0 ? "كل الأكواد التسعة مربوطة بميزات المحرر" : `غير مربوط: ${unmapped.join(", ")}`,
  });

  return report;
}
