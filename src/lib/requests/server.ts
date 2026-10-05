/**
 * Client requests — persistence and rules (server-only).
 *
 * Authorization is decided here, never in the browser:
 *   • `submitClientRequest` is the ONE public write. It validates, throttles,
 *     and associates the request with the caller's verified account when there
 *     is one — a visitor's request is welcome and identical in the inbox.
 *   • `listClientRequests` / `updateClientRequest` / `saveRequestSettings` call
 *     `requireAdmin` first. There is no request field that can make a caller an
 *     administrator.
 *   • `listRequestsForUser` reads only rows whose `user_id` is the verified
 *     caller's.
 *
 * The licence snapshot is stored per row so the inbox can say what the customer
 * held when they wrote, rather than what they hold today.
 */

import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/db";
import { checkRateLimit } from "@/lib/license/rate-limit";
import {
  DEFAULT_REQUEST_SETTINGS,
  normalizeRequestSettings,
  REQUEST_KIND_LABELS,
  type ClientRequestSummary,
  type RequestKind,
  type RequestPriority,
  type RequestSettings,
  type RequestStatus,
} from "./types";
import {
  REQUEST_LIMITS,
  normalizeResponseNote,
  validateClientRequest,
} from "./validation";

export class RequestRateLimitedError extends Error {
  readonly status = 429;
  constructor() {
    super("Too many requests");
    this.name = "RequestRateLimitedError";
  }
}

export class RequestValidationError extends Error {
  readonly status = 400;
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors[0] ?? "طلب غير صالح");
    this.name = "RequestValidationError";
    this.errors = errors;
  }
}

export interface RequestCaller {
  userId: string | null;
  userEmail: string | null;
  /** Entitlement at submission time; `null` for a visitor. */
  licensePlan: string | null;
  licenseStatus: string | null;
}

export interface SubmittedRequest {
  id: string;
  createdAt: string;
  kind: RequestKind;
  serviceLabel: string;
  name: string;
  contact: string;
  source: string;
}

function rowKind(value: unknown): RequestKind {
  const raw = String(value ?? "");
  return raw in REQUEST_KIND_LABELS ? (raw as RequestKind) : "support";
}

/**
 * Throttle key: the verified account when there is one, the IP otherwise.
 *
 * Both are needed. A signed-in account is limited per account (so one session
 * cannot flood the inbox from many addresses); a visitor is limited per IP, and
 * the caller cannot widen its own budget by claiming an id in the body, because
 * the account half comes from the session.
 */
export function requestRateKeys(
  caller: Pick<RequestCaller, "userId">,
  ip: string,
): string[] {
  const keys = [`ip:${ip || "unknown"}`];
  if (caller.userId) keys.push(`u:${caller.userId}`);
  return keys;
}

/**
 * Submit a request.
 *
 * The window is deliberately generous for a real customer (five requests in ten
 * minutes covers a follow-up or two) and tight enough that a script cannot fill
 * the inbox. Every accepted submission is stored before it is acknowledged — a
 * "شكرًا" the platform cannot back with a row would be a lie.
 */
export async function submitClientRequest(
  sql: Sql,
  raw: unknown,
  caller: RequestCaller,
  ip: string,
): Promise<SubmittedRequest> {
  const parsed = validateClientRequest(raw);
  if (!parsed.ok) throw new RequestValidationError(parsed.errors);

  for (const key of requestRateKeys(caller, ip)) {
    if (
      !checkRateLimit(
        "client-request:submit",
        key,
        REQUEST_LIMITS.rate.submissions,
        REQUEST_LIMITS.rate.windowMs,
      )
    ) {
      throw new RequestRateLimitedError();
    }
  }

  const value = parsed.value;
  const id = `req_${randomUUID()}`;
  const rows = await sql<{ id: string; created_at: string }>`
    insert into client_requests (
      id, kind, status, priority, name, contact, email, organization, details,
      source, template_id, user_id, user_email, license_plan, license_status
    ) values (
      ${id}, ${value.kind}, ${"new"}, ${"normal"}, ${value.name}, ${value.contact},
      ${value.email || null}, ${value.organization || null}, ${value.details},
      ${value.source}, ${value.templateId}, ${caller.userId},
      ${caller.userEmail}, ${caller.licensePlan}, ${caller.licenseStatus}
    )
    returning id, created_at
  `;

  const settings = await readRequestSettings(sql);
  const service = settings.services.find((entry) => entry.id === value.kind);
  return {
    id: rows[0]?.id ?? id,
    createdAt: String(rows[0]?.created_at ?? new Date().toISOString()),
    kind: value.kind,
    serviceLabel: service?.label ?? REQUEST_KIND_LABELS[value.kind],
    name: value.name,
    contact: value.contact,
    source: value.source,
  };
}

export interface AdminRequestRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  kind: RequestKind;
  status: RequestStatus;
  priority: RequestPriority;
  name: string;
  contact: string;
  email: string | null;
  organization: string | null;
  details: string;
  source: string;
  templateId: string | null;
  userId: string | null;
  userEmail: string | null;
  licensePlan: string | null;
  licenseStatus: string | null;
  assignedTo: string | null;
  responseNote: string | null;
  respondedAt: string | null;
}

function rowFromRecord(row: Record<string, unknown>): AdminRequestRow {
  return {
    id: String(row.id),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    kind: rowKind(row.kind),
    status: String(row.status ?? "new") as RequestStatus,
    priority: String(row.priority ?? "normal") as RequestPriority,
    name: String(row.name ?? ""),
    contact: String(row.contact ?? ""),
    email: (row.email as string) ?? null,
    organization: (row.organization as string) ?? null,
    details: String(row.details ?? ""),
    source: String(row.source ?? "site"),
    templateId: (row.template_id as string) ?? null,
    userId: (row.user_id as string) ?? null,
    userEmail: (row.user_email as string) ?? null,
    licensePlan: (row.license_plan as string) ?? null,
    licenseStatus: (row.license_status as string) ?? null,
    assignedTo: (row.assigned_to as string) ?? null,
    responseNote: (row.response_note as string) ?? null,
    respondedAt: row.responded_at ? new Date(String(row.responded_at)).toISOString() : null,
  };
}

export interface RequestFilters {
  status?: RequestStatus | "all" | "open";
  kind?: RequestKind | "all";
  search?: string;
  limit?: number;
}

/** The administration's inbox, newest first, filtered server-side. */
export async function listClientRequests(
  sql: Sql,
  filters: RequestFilters = {},
): Promise<AdminRequestRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const status = filters.status ?? "all";
  if (status === "open") {
    clauses.push(`status in ('new', 'in_progress')`);
  } else if (status !== "all") {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }

  if (filters.kind && filters.kind !== "all") {
    params.push(filters.kind);
    clauses.push(`kind = $${params.length}`);
  }

  const search = String(filters.search ?? "").trim().slice(0, 80);
  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    clauses.push(
      `(name ilike $${idx} or contact ilike $${idx} or details ilike $${idx} or coalesce(organization, '') ilike $${idx})`,
    );
  }

  const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 500);
  params.push(limit);
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const rows = await sql.query<Record<string, unknown>>(
    `select * from client_requests ${where} order by created_at desc limit $${params.length}`,
    params,
  );
  return rows.map(rowFromRecord);
}

/** Counts per status, for the inbox header and the admin dashboard. */
export async function clientRequestCounts(
  sql: Sql,
): Promise<Record<RequestStatus | "open", number>> {
  const rows = await sql<{ status: string; count: string | number }>`
    select status, count(*)::int as count from client_requests group by status
  `;
  const counts: Record<RequestStatus | "open", number> = {
    new: 0,
    in_progress: 0,
    answered: 0,
    closed: 0,
    open: 0,
  };
  for (const row of rows) {
    const status = String(row.status) as RequestStatus;
    const value = Number(row.count) || 0;
    if (status in counts) counts[status] = value;
  }
  counts.open = counts.new + counts.in_progress;
  return counts;
}

export interface RequestPatch {
  status?: RequestStatus;
  priority?: RequestPriority;
  assignedTo?: string | null;
  responseNote?: string;
  /** True when the administrator's note is an answer to the customer. */
  markResponded?: boolean;
}

/**
 * Update one request.
 *
 * `responded_at` is stamped the first time an answer is written, and kept
 * afterwards: "when did we first reply?" is the question the column exists to
 * answer, and re-saving an edited answer must not move it.
 */
export async function updateClientRequest(
  sql: Sql,
  id: string,
  patch: RequestPatch,
): Promise<AdminRequestRow | null> {
  const rows = await sql<Record<string, unknown>>`
    select * from client_requests where id = ${id} limit 1
  `;
  if (!rows.length) return null;
  const current = rowFromRecord(rows[0]);

  const status = patch.status ?? current.status;
  const priority = patch.priority ?? current.priority;
  const assignedTo =
    patch.assignedTo === undefined
      ? current.assignedTo
      : String(patch.assignedTo ?? "").trim().slice(0, 80) || null;
  const responseNote =
    patch.responseNote === undefined
      ? current.responseNote
      : normalizeResponseNote(patch.responseNote) || null;
  const answered =
    Boolean(responseNote) && (patch.markResponded ?? status !== "new");
  const respondedAt =
    current.respondedAt ?? (answered ? new Date().toISOString() : null);

  const updated = await sql<Record<string, unknown>>`
    update client_requests set
      status = ${status},
      priority = ${priority},
      assigned_to = ${assignedTo},
      response_note = ${responseNote},
      responded_at = ${respondedAt},
      updated_at = now()
    where id = ${id}
    returning *
  `;
  return updated.length ? rowFromRecord(updated[0]) : null;
}

/** Read the administration's settings document, defaults filled in. */
export async function readRequestSettings(sql: Sql): Promise<RequestSettings> {
  const rows = await sql<{ value: unknown }>`
    select value from client_request_settings where id = 'default' limit 1
  `;
  return normalizeRequestSettings(rows.length ? rows[0].value : DEFAULT_REQUEST_SETTINGS);
}

export async function saveRequestSettings(
  sql: Sql,
  value: unknown,
): Promise<RequestSettings> {
  const normalized = normalizeRequestSettings(value);
  await sql`
    insert into client_request_settings (id, value, updated_at)
    values ('default', ${JSON.stringify(normalized)}::jsonb, now())
    on conflict (id) do update set value = excluded.value, updated_at = now()
  `;
  return normalized;
}

/** A signed-in customer's own history — never anybody else's rows. */
export async function listRequestsForUser(
  sql: Sql,
  userId: string,
  settings: RequestSettings,
): Promise<ClientRequestSummary[]> {
  const rows = await sql<Record<string, unknown>>`
    select id, created_at, updated_at, kind, status, details, response_note, responded_at
    from client_requests
    where user_id = ${userId}
    order by created_at desc
    limit 50
  `;
  const labels = new Map(settings.services.map((service) => [service.id, service.label]));
  return rows.map((row) => ({
    id: String(row.id),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    kind: rowKind(row.kind),
    status: String(row.status ?? "new") as RequestStatus,
    serviceLabel:
      labels.get(String(row.kind)) ?? REQUEST_KIND_LABELS[rowKind(row.kind)],
    details: String(row.details ?? ""),
    responseNote: String(row.response_note ?? ""),
    respondedAt: row.responded_at
      ? new Date(String(row.responded_at)).toISOString()
      : null,
  }));
}
