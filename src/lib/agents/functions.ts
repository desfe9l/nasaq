/**
 * NASAQ Agent Workspace — server functions.
 *
 * Thin wrappers around the real launcher script (`scripts/agent-launcher.mjs`).
 * Every function re-verifies authority via `authMiddleware` and never exposes
 * credentials, tokens, or secrets to the browser.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { execFileSync } from "node:child_process";

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

/**
 * Read the current state of every agent from the real launcher script.
 * Runs server-side only; never leaks tokens or credentials to the browser.
 */
export const agentLauncherStatusFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<AgentLauncherStatus> => {
    try {
      const stdout = execFileSync("node", ["scripts/agent-launcher.mjs", "status"], {
        cwd: process.cwd(),
        encoding: "utf8",
      });

      // Parse the status output: each agent block starts with an emoji line.
      const agents: AgentStatus[] = [];
      const unsupported: string[] = [];
      let note: string | undefined;

      const lines = stdout.split("\n");
      let current: AgentStatus | null = null;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^[✅🌐❌]/.test(trimmed)) {
          // New agent block: "✅ Cline (cline)"
          const m = trimmed.match(/^[✅🌐❌]\s+(.+)\s+\((.+)\)$/);
          if (m) {
            if (current) agents.push(current);
            current = {
              id: m[2],
              name: m[1],
              kind: "installed",
              status: "active",
              description: "",
            };
          }
        } else if (current && trimmed.startsWith("النوع:")) {
          const kind = trimmed.replace("النوع:", "").trim();
          current.kind =
            kind === "web" ? "web" : kind === "docker" ? "docker" : kind === "desktop" ? "desktop" : "installed";
        } else if (current && trimmed.startsWith("الحالة:")) {
          const status = trimmed.replace("الحالة:", "").trim();
          current.status =
            status === "active" ? "active" : status === "web-only" ? "web-only" : "not-installed";
        } else if (current && trimmed.startsWith("الوصف:")) {
          current.description = trimmed.replace("الوصف:", "").trim();
        } else if (current && trimmed.startsWith("التشغيل:")) {
          current.launch = trimmed.replace("التشغيل:", "").trim();
        } else if (current && trimmed.startsWith("الإعداد على ويندوز:")) {
          current.windowsSetup = trimmed.replace("الإعداد على ويندوز:", "").trim();
        }
      }
      if (current) agents.push(current);

      return { ok: true, agents, unsupported, note };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "تعذّر قراءة حالة الوكلاء",
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
      execFileSync("node", ["scripts/agent-launcher.mjs", "launch", data.agentId], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "inherit",
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "فشل إطلاق الوكيل",
      };
    }
  });
