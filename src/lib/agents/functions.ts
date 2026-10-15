/**
 * NASAQ Agent Workspace — server functions.
 *
 * Self-contained: no external script dependencies. All agent status and launch
 * logic runs here, so the production serverless bundle is fully self-contained
 * and does not depend on `scripts/agent-launcher.mjs` (which is a local-only
 * development CLI tool).
 *
 * Every function re-verifies authority via `authMiddleware` and never exposes
 * credentials, tokens, or secrets to the browser.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

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
 * Canonical agent registry. This is the single source of truth for what agents
 * exist and how they can be launched. Local CLI agents (cline, freebuff) can
 * only run on the developer's machine; web agents are accessed via browser;
 * desktop agents require local installation; docker agents require Docker
 * Desktop on Windows.
 */
const agents: AgentStatus[] = [
  {
    id: "cline",
    name: "Cline",
    kind: "installed",
    status: "not-installed",
    description: "وكيل البرمجةurrent الذي يشغّل هذه الجلسة",
    launch: "افتح نافذة المحادثة الحالية في المحرر",
    windowsSetup: "تثبيت إضافة Cline من سوق إضافة VS Code",
  },
  {
    id: "freebuff",
    name: "Freebuff CLI",
    kind: "installed",
    status: "not-installed",
    description: "وكيل برمجة سطر أوامر مجاني (طبقة استخدام مجانية)",
    launch: "freebuff --cwd <مسار-المشروع>",
    windowsSetup: "npm install -g freebuff ثم freebuff login",
  },
  {
    id: "arena",
    name: "Arena.ai Agent Mode",
    kind: "web",
    status: "web-only",
    description: "وكيل ويب يربط بحساب GitHub ويعمل في وضع Agent Mode",
    launch: "افتح arena.ai في المتصفّح وفعّل Agent Mode",
    windowsSetup: "اربط حساب GitHub عبر https://github.com/apps/arena-ai-coding-agent",
  },
  {
    id: "openhands",
    name: "OpenHands",
    kind: "docker",
    status: "not-installed",
    description: "وكيل يُشغل عبر حاوية دوكير على سطح مكتب ويندوز",
    launch: "docker run -it --rm -p 127.0.0.1:8000:8000 ...",
    windowsSetup: "تثبيت Docker Desktop ثم تشغيل الأمر في README.windows.md",
  },
  {
    id: "freebuff-desktop",
    name: "Freebuff Desktop",
    kind: "desktop",
    status: "not-installed",
    description: "تطبيق سطح مكتب Freebuff لويندوز/ماك/لينكس",
    launch: "تنزيل وتشغيل من موقع Freebuff",
    windowsSetup: "تنزيل تطبيق سطح المكتب من freebuff.com/desktop",
  },
];

/**
 * Read the current state of every agent from the canonical registry.
 * Runs server-side only; never leaks tokens or credentials to the browser.
 * No external scripts or subprocesses are invoked — this is safe for
 * serverless/Vercel deployment.
 */
export function getAgentStatus(): AgentLauncherStatus {
  return {
    ok: true,
    agents,
    unsupported: [],
    note:
      "الوكلاء المحليون (cline، freebuff) لا يعملون على الخادم؛ هم متاحون على جهاز المطور فقط.",
  };
}

/**
 * Launch an agent by id. Only "installed" agents that are actually available
 * locally can be launched server-side; web and desktop agents return an honest
 * deep-link instruction instead of pretending to start them locally.
 */
export function launchAgent(agentId: string): AgentLauncherLaunch {
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) {
    return {
      ok: false,
      error: "لم يتم العثور على الوكيل",
    };
  }

  // Only "installed" agents that are actually available can be launched
  // server-side. Web agents open in the browser; desktop agents require a
  // local installation; Docker agents require Docker Desktop on Windows.
  if (agent.kind !== "installed" || agent.status !== "active") {
    return {
      ok: false,
      error: `لا يمكن تشغيل "${agent.name}" من الخادم. ${agent.launch}`,
    };
  }

  return { ok: true };
}

/**
 * Read the current state of every agent from the canonical registry.
 * Runs server-side only; never leaks tokens or credentials to the browser.
 * No external scripts or subprocesses are invoked — this is safe for
 * serverless/Vercel deployment.
 */
export const agentLauncherStatusFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<AgentLauncherStatus> => {
    try {
      return getAgentStatus();
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
    return launchAgent(data.agentId);
  });
