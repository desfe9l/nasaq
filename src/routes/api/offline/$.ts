/**
 * `/api/offline/*` — plain HTTP endpoints for the offline sync queue.
 *
 * The sync queue pushes with ordinary `fetch()` so every attempt has a real
 * status code, timeout and retry semantics. These routes were MISSING (only
 * the TanStack server functions existed), which is why pushes fell into the
 * SPA fallback and synchronization never worked. Both surfaces share ONE
 * implementation (`@/lib/offline/cloud-projects.server.ts`).
 *
 * Routes:
 *   POST /api/offline/saveCloudProject      upsert the document mirror
 *   POST /api/offline/deleteCloudProject    delete one mirrored document
 *   GET  /api/offline/getCloudProjects      list the caller's mirror
 *   GET  /api/offline/getCloudProject       fetch one mirrored document
 *   GET  /api/offline/getCloudProjectVersion  freshness probe (conflict check)
 *
 * Auth is the same first-party session every other surface uses (cookie, or
 * the live preview's bearer token). A missing session answers 401 with a
 * stable body — the queue treats that as "stay queued and retry", so a
 * temporary sign-out can never drop local edits.
 */
import { createFileRoute } from "@tanstack/react-router";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

type RouteIdentity = { id: string; email: string | null; emailVerified: boolean };

async function readSessionIdentity(request: Request): Promise<RouteIdentity | null> {
  const { resolveRequestSession } = await import("@/lib/auth/request-session.server");
  const resolved = await resolveRequestSession(request.headers, {
    materializeGate: false,
    emitCookies: false,
  }).catch(() => null);
  if (!resolved?.user?.id) return null;
  return {
    id: resolved.user.id,
    email: resolved.user.email ?? null,
    emailVerified: resolved.user.emailVerified === true,
  };
}

/** Unwrap the `{ data: {...} }` envelope the queue sends (or accept a bare body). */
function payloadOf(body: Record<string, unknown>): Record<string, unknown> {
  const inner = body?.data;
  return inner && typeof inner === "object" ? (inner as Record<string, unknown>) : body;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const Route = createFileRoute("/api/offline/$")({
  server: {
    handlers: {
      ANY: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        const action = url.pathname.replace(/^\/api\/offline\/?/, "");
        const method = request.method.toUpperCase();

        try {
          const identity = await readSessionIdentity(request);
          if (!identity) {
            return jsonResponse({ ok: false, reason: "unauthorized" }, 401);
          }
          const userId = identity.id;

          const { getSql } = await import("@/lib/db");
          const lib = await import("@/lib/offline/cloud-projects.server");

          if (action === "saveCloudProject" && method === "POST") {
            const body = payloadOf(await readJsonBody(request));
            const id = typeof body.id === "string" ? body.id.trim() : "";
            if (!id || id.length > 120 || !body.payload || typeof body.payload !== "object") {
              return jsonResponse({ ok: false, reason: "invalid_payload" }, 400);
            }
            // Same service gate the server function applies — parity, not duplication.
            try {
              const { refreshControlPlane } = await import("@/lib/control-plane/store.server");
              const { gateService } = await import("@/lib/control-plane/decisions");
              const { enforcementPlane } = await import("@/lib/control-plane/snapshot");
              const { getAuthorizationContext } = await import("@/lib/auth/authorization.server");
              await refreshControlPlane();
              const access = await getAuthorizationContext(identity);
              const gate = gateService(enforcementPlane(), "documents", {
                privileged: access.isOwner || access.isAdmin,
              });
              if (!gate.allowed) {
                return jsonResponse({ ok: false, reason: gate.code, service: "documents" });
              }
            } catch {
              /* control-plane trouble must not block saving a local document */
            }
            try {
              const sql = await getSql();
              const result = await lib.saveCloudProjectRow(sql, userId, {
                id,
                payload: body.payload as JsonObject,
                updatedAt: typeof body.updatedAt === "number" ? body.updatedAt : Date.now(),
                version: typeof body.version === "number" ? body.version : undefined,
              });
              return jsonResponse(result, result.ok ? 200 : 409);
            } catch (error) {
              const { reason } = await lib.classifyAndNoteDatabaseFailure(error);
              return jsonResponse({ ok: false, reason, service: "database" }, 503);
            }
          }

          if (action === "deleteCloudProject" && method === "POST") {
            const body = payloadOf(await readJsonBody(request));
            const id = typeof body.id === "string" ? body.id.trim() : "";
            if (!id) return jsonResponse({ ok: false, reason: "invalid_payload" }, 400);
            try {
              const sql = await getSql();
              const result = await lib.deleteCloudProjectRow(sql, userId, id);
              return jsonResponse(result);
            } catch (error) {
              const { reason } = await lib.classifyAndNoteDatabaseFailure(error);
              return jsonResponse({ ok: false, reason, service: "database" }, 503);
            }
          }

          if (action === "getCloudProjects" && (method === "GET" || method === "HEAD")) {
            try {
              const sql = await getSql();
              const projects = await lib.listCloudProjects(sql, userId);
              return jsonResponse({ ok: true, projects });
            } catch (error) {
              const { reason } = await lib.classifyAndNoteDatabaseFailure(error);
              return jsonResponse({ ok: false, reason, service: "database" }, 503);
            }
          }

          if (action === "getCloudProject" && (method === "GET" || method === "HEAD")) {
            const id = url.searchParams.get("id")?.trim() ?? "";
            if (!id) return jsonResponse({ ok: false, reason: "invalid_payload" }, 400);
            try {
              const sql = await getSql();
              const project = await lib.getCloudProjectRow(sql, userId, id);
              return jsonResponse({ ok: true, project });
            } catch (error) {
              const { reason } = await lib.classifyAndNoteDatabaseFailure(error);
              return jsonResponse({ ok: false, reason, service: "database" }, 503);
            }
          }

          if (action === "getCloudProjectVersion" && (method === "GET" || method === "HEAD")) {
            const id = url.searchParams.get("id")?.trim() ?? "";
            if (!id) return jsonResponse({ ok: false, reason: "invalid_payload" }, 400);
            try {
              const sql = await getSql();
              const info = await lib.getCloudProjectVersionInfo(sql, userId, id);
              return jsonResponse({ ok: true, ...info });
            } catch (error) {
              const { reason } = await lib.classifyAndNoteDatabaseFailure(error);
              return jsonResponse({ ok: false, reason, service: "database" }, 503);
            }
          }

          return jsonResponse({ ok: false, reason: "not_found" }, 404);
        } catch (error) {
          console.error("[offline-sync] endpoint failed:", error);
          return jsonResponse({ ok: false, reason: "internal_error" }, 500);
        }
      },
    },
  },
});
