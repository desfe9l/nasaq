/**
 * NASAQ owner control plane — the shape of application policy.
 *
 * Three different things stay separate:
 *   A. Application policy (this document). The owner changes it. It is not a
 *      plan, not a Gemini response, and not a hosting-plan limit.
 *   B. User entitlement. Still decided by NASAQ licensing. A free account's
 *      project cap is a product rule; it is not a service outage.
 *   C. External provider limits. Gemini, object storage, and Postgres can
 *      refuse their own calls. That refusal is recorded on THAT service only.
 *
 * Authentication and admin cannot be switched off. Owner control is not a
 * bypass of sign-in or authorization.
 */

export const SERVICE_IDS = [
  "authentication",
  "database",
  "storage",
  "documents",
  "templates",
  "editor",
  "ai",
  "image_processing",
  "uploads",
  "import_export",
  "admin",
  "background",
  "polling",
  "api",
  "users_teams",
] as const;

export type ServiceId = (typeof SERVICE_IDS)[number];

/** Services whose enabled flag is clamped on. Disabling them would remove authorization. */
export const LOCKED_ENABLED: readonly ServiceId[] = ["authentication", "admin"];

export const OPERATION_IDS = [
  "ai:report",
  "ai:design",
  "ai:selection",
  "ai:image",
  "ai:admin-note",
  "storage:upload",
  "storage:mutation",
  "storage:read",
] as const;

export type OperationId = (typeof OPERATION_IDS)[number];

export type ServiceStatus =
  | "enabled"
  | "disabled"
  | "degraded"
  | "unavailable"
  | "provider_limited"
  | "maintenance";

export type ServiceAccess = "public" | "authenticated" | "entitled" | "owner";

export interface RetryPolicy {
  /** 1..3. Never unbounded. */
  maxAttempts: number;
  /** Milliseconds before a retry. Capped. */
  backoffMs: number;
}

export interface ServicePolicy {
  enabled: boolean;
  maintenance: boolean;
  /** Owner declaration. A provider failure does not write this. */
  availability: "available" | "unavailable";
  /**
   * Narrows who may use the service. It never grants access: existing
   * auth and licence checks still run.
   */
  access: ServiceAccess;
  concurrency: number;
  retry: RetryPolicy;
}

export interface OperationPolicy {
  userPerMinute: number;
  ipPerMinute: number;
}

export interface ControlPlaneDocument {
  revision: number;
  updatedAt: string;
  updatedBy: string | null;
  services: Record<ServiceId, ServicePolicy>;
  operations: Record<OperationId, OperationPolicy>;
  /** Per-account object-storage ceiling, bytes. */
  storageQuotaBytes: number;
  /** Application AI budget per user per day. Not Gemini's quota. */
  aiDailyRequestBudget: number;
  /** Projects a non-unlimited account may keep. */
  projectLimit: number;
  /** Pages a non-unlimited account may put in one project. */
  pageLimit: number;
  /** Owner ceiling on one upload. Kind ceilings in storage/provider still apply and cannot be raised here. */
  maxUploadBytes: number;
  pollingIntervalMs: number;
  backgroundConcurrency: number;
  publicCacheTtlMs: number;
}

/** Shipped per-operation budgets. Same numbers the app already enforced. */
export const SHIPPED_OPERATION_POLICY: Record<OperationId, OperationPolicy> = {
  "ai:report": { userPerMinute: 8, ipPerMinute: 16 },
  "ai:design": { userPerMinute: 6, ipPerMinute: 12 },
  "ai:selection": { userPerMinute: 20, ipPerMinute: 40 },
  "ai:image": { userPerMinute: 4, ipPerMinute: 8 },
  "ai:admin-note": { userPerMinute: 30, ipPerMinute: 60 },
  "storage:upload": { userPerMinute: 30, ipPerMinute: 60 },
  "storage:mutation": { userPerMinute: 60, ipPerMinute: 120 },
  "storage:read": { userPerMinute: 120, ipPerMinute: 240 },
};

export const SHIPPED_STORAGE_QUOTA_BYTES = 512 * 1024 * 1024;
export const SHIPPED_PUBLIC_CACHE_TTL_MS = 30_000;
export const SHIPPED_PROJECT_LIMIT = 1;
export const SHIPPED_PAGE_LIMIT = 3;
export const SHIPPED_POLLING_INTERVAL_MS = 15_000;
export const SHIPPED_AI_DAILY_BUDGET = 5_000;
export const SHIPPED_MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
export const SHIPPED_BACKGROUND_CONCURRENCY = 2;

/** Hard safety caps. The owner can change policy inside these, not past them. */
export const SAFETY = {
  userPerMinute: 600,
  ipPerMinute: 1_200,
  retryAttempts: 3,
  backoffMs: 5_000,
  concurrency: 8,
  storageQuotaBytes: 100 * 1024 * 1024 * 1024,
  minStorageQuotaBytes: 1024 * 1024,
  aiDailyBudget: 100_000,
  projectLimit: 10_000,
  pageLimit: 500,
  maxUploadBytes: 64 * 1024 * 1024,
  minUploadBytes: 256 * 1024,
  pollingMinMs: 5_000,
  pollingMaxMs: 300_000,
  cacheTtlMs: 120_000,
  minCacheTtlMs: 1_000,
} as const;

/**
 * Limits NASAQ does not own. They are reported on the service that hit them
 * and must not become an application-wide shutdown.
 */
export const EXTERNAL_CONSTRAINTS = [
  {
    id: "gemini",
    service: "ai" as const,
    summary: "Gemini quota, billing, and request rate belong to the model provider.",
  },
  {
    id: "object-storage",
    service: "storage" as const,
    summary: "R2/S3 bucket quotas, request rates, and signed-URL rules belong to the storage provider.",
  },
  {
    id: "postgres",
    service: "database" as const,
    summary: "Postgres plan quota (compute, storage, connections) belongs to the database host. NASAQ reports it on the database service only.",
  },
  {
    id: "host-runtime",
    service: "api" as const,
    summary: "The host's function timeout and request-body ceiling still apply. They are not NASAQ's resource manager.",
  },
] as const;

const ACCESS: readonly ServiceAccess[] = ["public", "authenticated", "entitled", "owner"];

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function serviceDefaults(id: ServiceId): ServicePolicy {
  const access: ServiceAccess =
    id === "authentication" || id === "templates" || id === "editor" || id === "polling"
      ? "public"
      : id === "admin"
        ? "owner"
        : "authenticated";
  const concurrency = id === "background" ? SHIPPED_BACKGROUND_CONCURRENCY : id === "ai" || id === "image_processing" ? 2 : 4;
  return {
    enabled: true,
    maintenance: false,
    availability: "available",
    access,
    concurrency,
    retry: { maxAttempts: 2, backoffMs: 150 },
  };
}

export function shippedControlPlane(now = "1970-01-01T00:00:00.000Z"): ControlPlaneDocument {
  const services = {} as Record<ServiceId, ServicePolicy>;
  for (const id of SERVICE_IDS) services[id] = serviceDefaults(id);
  return {
    revision: 0,
    updatedAt: now,
    updatedBy: null,
    services,
    operations: structuredClone(SHIPPED_OPERATION_POLICY),
    storageQuotaBytes: SHIPPED_STORAGE_QUOTA_BYTES,
    aiDailyRequestBudget: SHIPPED_AI_DAILY_BUDGET,
    projectLimit: SHIPPED_PROJECT_LIMIT,
    pageLimit: SHIPPED_PAGE_LIMIT,
    maxUploadBytes: SHIPPED_MAX_UPLOAD_BYTES,
    pollingIntervalMs: SHIPPED_POLLING_INTERVAL_MS,
    backgroundConcurrency: SHIPPED_BACKGROUND_CONCURRENCY,
    publicCacheTtlMs: SHIPPED_PUBLIC_CACHE_TTL_MS,
  };
}

function readEnv(name: string): string | undefined {
  return (typeof process !== "undefined" ? process.env[name] : undefined)?.trim() || undefined;
}

function positiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

/**
 * Deployment bootstrap used only while no owner document has been saved
 * (revision 0). A malformed env value is ignored and cannot widen a limit.
 * A saved owner document replaces this.
 */
export function bootstrapControlPlane(now = new Date().toISOString()): ControlPlaneDocument {
  const plane = shippedControlPlane(now);
  const quota = positiveInt(readEnv("NASAQ_STORAGE_QUOTA_BYTES"));
  const ttl = positiveInt(readEnv("NASAQ_PUBLIC_CACHE_TTL_MS"));
  if (quota) plane.storageQuotaBytes = clampInt(quota, SAFETY.minStorageQuotaBytes, SAFETY.storageQuotaBytes, plane.storageQuotaBytes);
  if (ttl) plane.publicCacheTtlMs = clampInt(ttl, SAFETY.minCacheTtlMs, SAFETY.cacheTtlMs, plane.publicCacheTtlMs);
  const raw = readEnv("NASAQ_LIMITS_JSON");
  if (!raw) return plane;
  try {
    const parsed = JSON.parse(raw) as {
      operations?: Partial<Record<OperationId, Partial<OperationPolicy>>>;
      storageQuotaBytes?: number;
      publicCacheTtlMs?: number;
    };
    if (!parsed || typeof parsed !== "object") return plane;
    for (const id of OPERATION_IDS) {
      const override = parsed.operations?.[id];
      if (!override) continue;
      const user = positiveInt(override.userPerMinute);
      const ip = positiveInt(override.ipPerMinute);
      if (user) plane.operations[id].userPerMinute = clampInt(user, 1, SAFETY.userPerMinute, plane.operations[id].userPerMinute);
      if (ip) plane.operations[id].ipPerMinute = clampInt(ip, 1, SAFETY.ipPerMinute, plane.operations[id].ipPerMinute);
      if (plane.operations[id].ipPerMinute < plane.operations[id].userPerMinute) {
        plane.operations[id].ipPerMinute = plane.operations[id].userPerMinute;
      }
    }
    const jsonQuota = positiveInt(parsed.storageQuotaBytes);
    const jsonTtl = positiveInt(parsed.publicCacheTtlMs);
    if (jsonQuota) plane.storageQuotaBytes = clampInt(jsonQuota, SAFETY.minStorageQuotaBytes, SAFETY.storageQuotaBytes, plane.storageQuotaBytes);
    if (jsonTtl) plane.publicCacheTtlMs = clampInt(jsonTtl, SAFETY.minCacheTtlMs, SAFETY.cacheTtlMs, plane.publicCacheTtlMs);
    return plane;
  } catch {
    return shippedControlPlane(now);
  }
}

function normalizeService(id: ServiceId, raw: unknown, fallback: ServicePolicy): ServicePolicy {
  const source = raw && typeof raw === "object" ? (raw as Partial<ServicePolicy>) : {};
  const retry: Partial<RetryPolicy> =
    source.retry && typeof source.retry === "object" ? source.retry : {};
  const access = ACCESS.includes(source.access as ServiceAccess) ? (source.access as ServiceAccess) : fallback.access;
  const resolvedEnabled = LOCKED_ENABLED.includes(id)
    ? true
    : typeof source.enabled === "boolean"
      ? source.enabled
      : fallback.enabled;
  const availability = LOCKED_ENABLED.includes(id)
    ? "available"
    : source.availability === "unavailable"
      ? "unavailable"
      : source.availability === "available"
        ? "available"
        : fallback.availability;
  return {
    enabled: resolvedEnabled,
    maintenance: typeof source.maintenance === "boolean" ? source.maintenance : fallback.maintenance,
    availability,
    access,
    concurrency: clampInt(source.concurrency, 1, SAFETY.concurrency, fallback.concurrency),
    retry: {
      maxAttempts: clampInt(retry.maxAttempts, 1, SAFETY.retryAttempts, fallback.retry.maxAttempts),
      backoffMs: clampInt(retry.backoffMs, 0, SAFETY.backoffMs, fallback.retry.backoffMs),
    },
  };
}

/** Accept a stored blob. Anything incomplete falls back field-by-field to the shipped plane. */
export function normalizeControlPlane(raw: unknown, now = new Date().toISOString()): ControlPlaneDocument {
  const base = shippedControlPlane(now);
  if (!raw || typeof raw !== "object") return base;
  const source = raw as Partial<ControlPlaneDocument>;
  const services = {} as Record<ServiceId, ServicePolicy>;
  const rawServices = source.services && typeof source.services === "object" ? source.services : {};
  for (const id of SERVICE_IDS) {
    services[id] = normalizeService(id, (rawServices as Record<string, unknown>)[id], base.services[id]);
  }
  const operations = {} as Record<OperationId, OperationPolicy>;
  const rawOps = source.operations && typeof source.operations === "object" ? source.operations : {};
  for (const id of OPERATION_IDS) {
    const op = (rawOps as Record<string, Partial<OperationPolicy> | undefined>)[id];
    const user = clampInt(op?.userPerMinute, 1, SAFETY.userPerMinute, base.operations[id].userPerMinute);
    let ip = clampInt(op?.ipPerMinute, 1, SAFETY.ipPerMinute, base.operations[id].ipPerMinute);
    if (ip < user) ip = user;
    operations[id] = { userPerMinute: user, ipPerMinute: ip };
  }
  return {
    revision: clampInt(source.revision, 0, Number.MAX_SAFE_INTEGER, 0),
    updatedAt: typeof source.updatedAt === "string" && source.updatedAt ? source.updatedAt : base.updatedAt,
    updatedBy: typeof source.updatedBy === "string" && source.updatedBy ? source.updatedBy.slice(0, 120) : null,
    services,
    operations,
    storageQuotaBytes: clampInt(source.storageQuotaBytes, SAFETY.minStorageQuotaBytes, SAFETY.storageQuotaBytes, base.storageQuotaBytes),
    aiDailyRequestBudget: clampInt(source.aiDailyRequestBudget, 1, SAFETY.aiDailyBudget, base.aiDailyRequestBudget),
    projectLimit: clampInt(source.projectLimit, 1, SAFETY.projectLimit, base.projectLimit),
    pageLimit: clampInt(source.pageLimit, 1, SAFETY.pageLimit, base.pageLimit),
    maxUploadBytes: clampInt(source.maxUploadBytes, SAFETY.minUploadBytes, SAFETY.maxUploadBytes, base.maxUploadBytes),
    pollingIntervalMs: clampInt(source.pollingIntervalMs, SAFETY.pollingMinMs, SAFETY.pollingMaxMs, base.pollingIntervalMs),
    backgroundConcurrency: clampInt(source.backgroundConcurrency, 1, SAFETY.concurrency, base.backgroundConcurrency),
    publicCacheTtlMs: clampInt(source.publicCacheTtlMs, SAFETY.minCacheTtlMs, SAFETY.cacheTtlMs, base.publicCacheTtlMs),
  };
}

export type ControlPatch = {
  service?: {
    id: ServiceId;
    enabled?: boolean;
    maintenance?: boolean;
    availability?: "available" | "unavailable";
    access?: ServiceAccess;
    concurrency?: number;
    retry?: Partial<RetryPolicy>;
  };
  operation?: {
    id: OperationId;
    userPerMinute?: number;
    ipPerMinute?: number;
  };
  storageQuotaBytes?: number;
  aiDailyRequestBudget?: number;
  projectLimit?: number;
  pageLimit?: number;
  maxUploadBytes?: number;
  pollingIntervalMs?: number;
  backgroundConcurrency?: number;
  publicCacheTtlMs?: number;
};

export interface PatchResult {
  doc: ControlPlaneDocument;
  /** Fields the server refused. A refusal is not a silent no-op. */
  rejected: string[];
}

export function applyControlPatch(
  current: ControlPlaneDocument,
  patch: ControlPatch,
  actorId: string,
  now = new Date().toISOString(),
): PatchResult {
  const next = normalizeControlPlane(structuredClone(current), current.updatedAt);
  const rejected: string[] = [];
  if (patch.service) {
    if (!SERVICE_IDS.includes(patch.service.id)) {
      rejected.push("service.id");
    } else {
      const id = patch.service.id;
      if (typeof patch.service.enabled === "boolean") {
        if (!patch.service.enabled && LOCKED_ENABLED.includes(id)) {
          rejected.push(`${id}.enabled`);
        } else {
          next.services[id].enabled = patch.service.enabled;
        }
      }
      if (typeof patch.service.maintenance === "boolean") next.services[id].maintenance = patch.service.maintenance;
      if (patch.service.availability === "available" || patch.service.availability === "unavailable") {
        if (patch.service.availability === "unavailable" && LOCKED_ENABLED.includes(id)) {
          rejected.push(`${id}.availability`);
        } else {
          next.services[id].availability = patch.service.availability;
        }
      }
      if (patch.service.access && ACCESS.includes(patch.service.access)) next.services[id].access = patch.service.access;
      if (patch.service.concurrency != null) {
        next.services[id].concurrency = clampInt(patch.service.concurrency, 1, SAFETY.concurrency, next.services[id].concurrency);
      }
      if (patch.service.retry) {
        if (patch.service.retry.maxAttempts != null) {
          next.services[id].retry.maxAttempts = clampInt(patch.service.retry.maxAttempts, 1, SAFETY.retryAttempts, next.services[id].retry.maxAttempts);
        }
        if (patch.service.retry.backoffMs != null) {
          next.services[id].retry.backoffMs = clampInt(patch.service.retry.backoffMs, 0, SAFETY.backoffMs, next.services[id].retry.backoffMs);
        }
      }
    }
  }
  if (patch.operation) {
    if (!OPERATION_IDS.includes(patch.operation.id)) {
      rejected.push("operation.id");
    } else {
      const id = patch.operation.id;
      if (patch.operation.userPerMinute != null) {
        next.operations[id].userPerMinute = clampInt(patch.operation.userPerMinute, 1, SAFETY.userPerMinute, next.operations[id].userPerMinute);
      }
      if (patch.operation.ipPerMinute != null) {
        next.operations[id].ipPerMinute = clampInt(patch.operation.ipPerMinute, 1, SAFETY.ipPerMinute, next.operations[id].ipPerMinute);
      }
      if (next.operations[id].ipPerMinute < next.operations[id].userPerMinute) {
        next.operations[id].ipPerMinute = next.operations[id].userPerMinute;
      }
    }
  }
  if (patch.storageQuotaBytes != null) next.storageQuotaBytes = clampInt(patch.storageQuotaBytes, SAFETY.minStorageQuotaBytes, SAFETY.storageQuotaBytes, next.storageQuotaBytes);
  if (patch.aiDailyRequestBudget != null) next.aiDailyRequestBudget = clampInt(patch.aiDailyRequestBudget, 1, SAFETY.aiDailyBudget, next.aiDailyRequestBudget);
  if (patch.projectLimit != null) next.projectLimit = clampInt(patch.projectLimit, 1, SAFETY.projectLimit, next.projectLimit);
  if (patch.pageLimit != null) next.pageLimit = clampInt(patch.pageLimit, 1, SAFETY.pageLimit, next.pageLimit);
  if (patch.maxUploadBytes != null) next.maxUploadBytes = clampInt(patch.maxUploadBytes, SAFETY.minUploadBytes, SAFETY.maxUploadBytes, next.maxUploadBytes);
  if (patch.pollingIntervalMs != null) next.pollingIntervalMs = clampInt(patch.pollingIntervalMs, SAFETY.pollingMinMs, SAFETY.pollingMaxMs, next.pollingIntervalMs);
  if (patch.backgroundConcurrency != null) {
    next.backgroundConcurrency = clampInt(patch.backgroundConcurrency, 1, SAFETY.concurrency, next.backgroundConcurrency);
    next.services.background.concurrency = next.backgroundConcurrency;
  }
  if (patch.publicCacheTtlMs != null) next.publicCacheTtlMs = clampInt(patch.publicCacheTtlMs, SAFETY.minCacheTtlMs, SAFETY.cacheTtlMs, next.publicCacheTtlMs);
  next.revision = current.revision + 1;
  next.updatedAt = now;
  next.updatedBy = actorId.slice(0, 120);
  return { doc: normalizeControlPlane(next, now), rejected };
}

/** Numbers the browser may see. No actor id, no secrets, no credentials. */
export interface PublicOperationalView {
  revision: number;
  projectLimit: number;
  pageLimit: number;
  pollingIntervalMs: number;
  storageQuotaBytes: number;
  maxUploadBytes: number;
  aiDailyRequestBudget: number;
  services: Record<ServiceId, { enabled: boolean; maintenance: boolean; availability: "available" | "unavailable" }>;
}

export function toPublicOperationalView(doc: ControlPlaneDocument): PublicOperationalView {
  const services = {} as PublicOperationalView["services"];
  for (const id of SERVICE_IDS) {
    const service = doc.services[id];
    services[id] = {
      enabled: service.enabled,
      maintenance: service.maintenance,
      availability: service.availability,
    };
  }
  return {
    revision: doc.revision,
    projectLimit: doc.projectLimit,
    pageLimit: doc.pageLimit,
    pollingIntervalMs: doc.pollingIntervalMs,
    storageQuotaBytes: doc.storageQuotaBytes,
    maxUploadBytes: doc.maxUploadBytes,
    aiDailyRequestBudget: doc.aiDailyRequestBudget,
    services,
  };
}

/**
 * While the database cannot confirm the latest owner revision, numeric limits
 * must not stay looser than the shipped defaults. An owner disable stays off.
 */
export function tightenForUnconfirmed(plane: ControlPlaneDocument): ControlPlaneDocument {
  const shipped = shippedControlPlane(plane.updatedAt);
  const next = normalizeControlPlane(plane, plane.updatedAt);
  for (const id of OPERATION_IDS) {
    next.operations[id] = {
      userPerMinute: Math.min(next.operations[id].userPerMinute, shipped.operations[id].userPerMinute),
      ipPerMinute: Math.min(next.operations[id].ipPerMinute, shipped.operations[id].ipPerMinute),
    };
    if (next.operations[id].ipPerMinute < next.operations[id].userPerMinute) {
      next.operations[id].ipPerMinute = next.operations[id].userPerMinute;
    }
  }
  next.storageQuotaBytes = Math.min(next.storageQuotaBytes, shipped.storageQuotaBytes);
  next.aiDailyRequestBudget = Math.min(next.aiDailyRequestBudget, shipped.aiDailyRequestBudget);
  next.projectLimit = Math.min(next.projectLimit, shipped.projectLimit);
  next.pageLimit = Math.min(next.pageLimit, shipped.pageLimit);
  next.maxUploadBytes = Math.min(next.maxUploadBytes, shipped.maxUploadBytes);
  return next;
}
