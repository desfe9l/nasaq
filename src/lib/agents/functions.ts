/**
 * NASAQ Agent Workspace — server functions.
 *
 * Thin wrappers around the real launcher script (`scripts/agent-launcher.mjs`).
 * Every function re-verifies authority via `authMiddleware` and never exposes
 * credentials, tokens, or secrets to the browser.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { execFile } from "node:child_process";

const execFileAsync = promisifyNodeExec(execFile);

const EXEC_TIMEOUT_MS = 10_000;

function promisifyNodeExec(fn: typeof execFile) {
  return (
    cmd: string,
    args: string[],
    opts: { cwd: string; encoding: string },
  ): Promise<{ stdout: string; stderr: string }> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (child) child.kill("SIGTERM");
        reject(new Error("process timed out"));
      }, EXEC_TIMEOUT_MS);

      let child: ReturnType<typeof fn> | undefined;
      try {
        child = fn(cmd, args, opts, (err, stdout, stderr) => {
          clearTimeout(timeout);
          if (err) reject(err);
          else
            resolve({
              stdout: String(stdout ?? ""),
              stderr: String(stderr ?? ""),
            });
        });
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  };
}

export interface AgentStatus {
  id: string;
  name: string;
  kind: "installed" | "web" | "docker" | "desktop";
  status: "active" | "not-installed" | "web-only";
  description: string;
  launch?: string;
  windowsSetup?: string;
}

export interface AgentLauncherStatus {
  ok: boolean;
  agents?: AgentStatus[];
  error?: string;
  unsupported?: string[];
  note?: string;
}

export interface AgentLauncherLaunch {
  ok: boolean;
  error?: string;
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Read the current state of every agent from the real launcher script.
 * Runs server-side only; never leaks tokens or credentials to the browser.
 */
export const agentLauncherStatusFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<AgentLauncherStatus> => {
    try {
      const { stdout } = await execFileAsync(
        "node",
        ["scripts/agent-launcher.mjs", "status"],
        { cwd: process.cwd(), encoding: "utf8" },
      );

      const payload = JSON.parse(stdout);

      if (!payload || typeof payload !== "object" || !Array.isArray(payload.agents)) {
        return {
          ok: false,
          error: "تعذّر قراءة حالة الوكلاء: استجابة غير صالحة",
        };
      }

      const agents: AgentStatus[] = payload.agents.map((a: any) => ({
        id: String(a.id ?? ""),
        name: String(a.name ?? ""),
        kind:
          a.kind === "web" || a.kind === "docker" || a.kind === "desktop"
            ? a.kind
            : "installed",
        status:
          a.status === "active" || a.status === "web-only" ||
            a.status === "not-installed"
            ? a.status
            : "not-installed",
        description: String(a.description ?? ""),
        launch: typeof a.launch === "string" ? a.launch : undefined,
        windowsSetup:
          typeof a.windowsSetup === "string" ? a.windowsSetup : undefined,
      }));

      return {
        ok: true,
        agents,
        unsupported: payload.unsupported,
        note: payload.note,
      };
    } catch (error) {
      return {
        ok: false,
        error: sanitizeError(error),
      };
    }
  });

/**
 * Launch an agent by id. Only "installed" agents can be launched server-side;
 * web and desktop agents return an honest deep-link instruction instead of
 * pretending to start them locally.
 */
export const agentLauncherLaunchFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { agentId: string }) => {
    if (!data || typeof data.agentId !== "string" || !data.agentId) {
      throw new Error("معرف الوكيل مطلوب");
    }
    return data;
  })
  .handler(async ({ data }): Promise<AgentLauncherLaunch> => {
    try {
      await execFileAsync(
        "node",
        ["scripts/agent-launcher.mjs", "launch", data.agentId],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: sanitizeError(error),
      };
    }
  });
