/**
 * Pure control-plane decisions. No database, no provider, no session lookup.
 * Callers pass an already-authorized actor and a policy document.
 */

import {
  LOCKED_ENABLED,
  SERVICE_IDS,
  type ControlPatch,
  type ControlPlaneDocument,
  type ServiceId,
  type ServiceStatus,
  applyControlPatch,
  type PatchResult,
} from "./schema.ts";

export type ControlActor = {
  role: "owner" | "admin" | "user" | "anonymous";
  userId: string;
};

export type GateCode = "disabled" | "maintenance" | "unavailable" | "owner_only";

export type ServiceGate =
  | { allowed: true; status: ServiceStatus }
  | { allowed: false; status: ServiceStatus; code: GateCode };

export type ProviderProbe = "ok" | "down" | "quota" | "billing" | "timeout";

export interface ServiceHealth {
  status: ServiceStatus;
  /** Why the status is not a plain "enabled", when there is a reason. */
  reason: string | null;
}

/**
 * Who may change application policy. Owner and platform admin only.
 * The role is resolved on the server from the verified session — never from
 * a field the browser sends.
 */
export function authorizeControlMutation(
  actor: ControlActor,
): { ok: true } | { ok: false; reason: "forbidden" } {
  if ((actor.role === "owner" || actor.role === "admin") && actor.userId) return { ok: true };
  return { ok: false, reason: "forbidden" };
}

export function commitControlChange(
  actor: ControlActor,
  current: ControlPlaneDocument,
  patch: ControlPatch,
  now?: string,
): { ok: true; result: PatchResult } | { ok: false; reason: "forbidden" } {
  const auth = authorizeControlMutation(actor);
  if (!auth.ok) return auth;
  return { ok: true, result: applyControlPatch(current, patch, actor.userId, now) };
}

/**
 * May this caller use this service right now?
 *
 * A provider probe is intentionally NOT an input. Gemini being out of quota
 * must not flip this gate for storage, editor, or authentication.
 */
export function gateService(
  plane: ControlPlaneDocument,
  id: ServiceId,
  opts?: { privileged?: boolean },
): ServiceGate {
  const service = plane.services[id];
  const locked = LOCKED_ENABLED.includes(id);
  if (!service.enabled && !locked) {
    return { allowed: false, status: "disabled", code: "disabled" };
  }
  if (service.maintenance && !opts?.privileged) {
    return { allowed: false, status: "maintenance", code: "maintenance" };
  }
  if (service.availability === "unavailable" && !locked && !opts?.privileged) {
    return { allowed: false, status: "unavailable", code: "unavailable" };
  }
  if (service.access === "owner" && !opts?.privileged) {
    return { allowed: false, status: "disabled", code: "owner_only" };
  }
  return { allowed: true, status: service.maintenance ? "maintenance" : "enabled" };
}

/**
 * Per-user quotas do not apply to the owner or an administrator.
 * The call is still finite: a non-finite size is refused for everyone.
 */
export function quotaAllows(args: {
  privileged: boolean;
  used: number;
  incoming: number;
  quota: number;
}): boolean {
  if (!Number.isFinite(args.quota) || args.quota < 0) return false;
  if (!Number.isFinite(args.used) || args.used < 0) return false;
  if (!Number.isFinite(args.incoming)) return false;
  if (args.privileged) return args.incoming >= 0;
  return args.used + Math.max(0, args.incoming) <= args.quota;
}

/** Non-unlimited accounts use the owner-set project cap. Privileged callers do not. */
export function projectCreateAllows(args: {
  privileged: boolean;
  unlimitedEntitlement: boolean;
  count: number;
  limit: number;
}): boolean {
  if (args.privileged || args.unlimitedEntitlement) return true;
  return args.count < args.limit;
}

export function pageCountAllows(args: {
  privileged: boolean;
  unlimitedEntitlement: boolean;
  count: number;
  limit: number;
}): boolean {
  if (args.privileged || args.unlimitedEntitlement) return true;
  return args.count <= args.limit;
}

/**
 * Project a set of provider probes onto service health.
 *
 * Each probe touches only the services that actually depend on it.
 * Nothing here disables authentication or admin, and nothing here turns a
 * Gemini quota into an editor, storage, or sign-in outage.
 */
export function deriveServiceHealth(
  plane: ControlPlaneDocument,
  probes: { database?: ProviderProbe; storage?: ProviderProbe; ai?: ProviderProbe } = {},
): Record<ServiceId, ServiceHealth> {
  const out = {} as Record<ServiceId, ServiceHealth>;
  for (const id of SERVICE_IDS) {
    const service = plane.services[id];
    if (!service.enabled && !LOCKED_ENABLED.includes(id)) {
      out[id] = { status: "disabled", reason: "owner" };
      continue;
    }
    if (service.maintenance) {
      out[id] = { status: "maintenance", reason: "owner" };
      continue;
    }
    if (service.availability === "unavailable" && !LOCKED_ENABLED.includes(id)) {
      out[id] = { status: "unavailable", reason: "owner" };
      continue;
    }
    out[id] = { status: "enabled", reason: null };
  }

  if (probes.database === "down") {
    out.database = { status: "unavailable", reason: "database" };
    for (const id of ["documents", "templates", "users_teams"] as const) {
      if (out[id].status === "enabled") out[id] = { status: "degraded", reason: "database" };
    }
    if (out.authentication.status === "enabled") {
      out.authentication = { status: "degraded", reason: "database" };
    }
  }

  if (probes.storage === "down" || probes.storage === "quota") {
    const status: ServiceStatus = probes.storage === "quota" ? "provider_limited" : "unavailable";
    out.storage = { status, reason: "storage" };
    if (out.uploads.status === "enabled" || out.uploads.status === "degraded") {
      out.uploads = { status, reason: "storage" };
    }
    if (out.import_export.status === "enabled") {
      out.import_export = { status: "degraded", reason: "storage" };
    }
  }

  if (probes.ai === "quota" || probes.ai === "billing") {
    out.ai = { status: "provider_limited", reason: "gemini" };
    out.image_processing = { status: "provider_limited", reason: "gemini" };
  } else if (probes.ai === "down" || probes.ai === "timeout") {
    out.ai = { status: "unavailable", reason: "gemini" };
    if (out.image_processing.status === "enabled") {
      out.image_processing = { status: "degraded", reason: "gemini" };
    }
  }

  if (out.authentication.status === "disabled") out.authentication = { status: "enabled", reason: null };
  if (out.admin.status === "disabled") out.admin = { status: "enabled", reason: null };
  return out;
}

/** Authentication checks stay mandatory no matter what the document says. */
export function authenticationRequired(_plane: ControlPlaneDocument): true {
  return true;
}
