import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";

// Test that the launcher script outputs valid JSON for status
describe("PSD export — agent launcher script", () => {
  it("outputs valid JSON for status command", () => {
    const result = execFileSync("node", ["scripts/agent-launcher.mjs", "status"], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    const parsed = JSON.parse(result);
    assert.ok(Array.isArray(parsed.agents));
    assert.ok(parsed.agents.length > 0);
    assert.ok(parsed.agents.some((a: any) => a.id === "cline"));
    assert.ok(parsed.agents.some((a: any) => a.id === "freebuff"));
    assert.ok(parsed.agents.some((a: any) => a.id === "arena"));
    assert.ok(parsed.agents.some((a: any) => a.id === "openhands"));
    assert.ok(parsed.agents.some((a: any) => a.id === "freebuff-desktop"));
  });

  it("each agent has required fields", () => {
    const result = execFileSync("node", ["scripts/agent-launcher.mjs", "status"], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    const parsed = JSON.parse(result);
    for (const agent of parsed.agents) {
      assert.ok(agent.id, "agent must have id");
      assert.ok(agent.name, "agent must have name");
      assert.ok(agent.kind, "agent must have kind");
      assert.ok(agent.status, "agent must have status");
      assert.ok(agent.description, "agent must have description");
      assert.ok(agent.launch, "agent must have launch");
      assert.ok(agent.windowsSetup, "agent must have windowsSetup");
      assert.ok(["installed", "web", "docker", "desktop"].includes(agent.kind));
      assert.ok(
        ["active", "not-installed", "web-only"].includes(agent.status),
        `unexpected status: ${agent.status}`
      );
    }
  });
});

describe("agent launcher status parsing", () => {
  it("parses valid JSON output correctly", () => {
    const result = execFileSync("node", ["scripts/agent-launcher.mjs", "status"], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    const parsed = JSON.parse(result);
    assert.ok(Array.isArray(parsed.agents), "agents should be an array");
    assert.ok(parsed.agents.length >= 5, "should have all 5 agents");
  });

  it("clagent is active", () => {
    const result = execFileSync("node", ["scripts/agent-launcher.mjs", "status"], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    const parsed = JSON.parse(result);
    const cline = parsed.agents.find((a: any) => a.id === "cline");
    assert.ok(cline, "cline agent should exist");
    assert.strictEqual(cline.status, "active", "cline should be active");
    assert.strictEqual(cline.kind, "installed", "cline should be installed");
  });

  it("openhand is not-installed", () => {
    const result = execFileSync("node", ["scripts/agent-launcher.mjs", "status"], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    const parsed = JSON.parse(result);
    const oh = parsed.agents.find((a: any) => a.id === "openhands");
    assert.ok(oh, "openhands agent should exist");
    assert.strictEqual(oh.status, "not-installed", "openhands should be not-installed");
    assert.strictEqual(oh.kind, "docker", "openhands should be docker kind");
  });
});

describe("server functions import", () => {
  it("agentLauncherStatusFn and agentLauncherLaunchFn are exported", async () => {
    const { agentLauncherStatusFn, agentLauncherLaunchFn } = await import(
      "./functions.ts"
    );
    assert.ok(typeof agentLauncherStatusFn === "function");
    assert.ok(typeof agentLauncherLaunchFn === "function");
  });
});
