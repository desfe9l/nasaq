import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAgentStatus, launchAgent } from "./functions.ts";

describe("agent launcher status function", () => {
  it("returns editable agent status", () => {
    const result = getAgentStatus();
    assert.ok(result.ok, "status should be ok");
    assert.ok(Array.isArray(result.agents), "agents should be an array");
    assert.ok(result.agents.length > 0, "should have agents");
    assert.ok(result.agents.some((a: any) => a.id === "cline"));
    assert.ok(result.agents.some((a: any) => a.id === "freebuff"));
    assert.ok(result.agents.some((a: any) => a.id === "arena"));
    assert.ok(result.agents.some((a: any) => a.id === "openhands"));
    assert.ok(result.agents.some((a: any) => a.id === "freebuff-desktop"));
  });

  it("each agent has required fields", () => {
    const agents = [
      { id: "cline", kind: "installed", status: "not-installed", name: "Cline", description: "Cline agent" },
      { id: "freebuff", kind: "installed", status: "not-installed", name: "Freebuff", description: "Freebuff agent" },
      { id: "arena", kind: "web", status: "web-only", name: "Arena", description: "Arena agent" },
      { id: "openhands", kind: "docker", status: "not-installed", name: "OpenHands", description: "OpenHands agent" },
      { id: "freebuff-desktop", kind: "desktop", status: "not-installed", name: "Freebuff Desktop", description: "Freebuff Desktop agent" },
    ];

    for (const agent of agents) {
      assert.ok(agent.id, "agent must have id");
      assert.ok(agent.name, "agent must have name");
      assert.ok(agent.kind, "agent must have kind");
      assert.ok(agent.status, "agent must have status");
      assert.ok(agent.description, "agent must have description");
      assert.ok(["installed", "web", "docker", "desktop"].includes(agent.kind));
      assert.ok(
        ["active", "not-installed", "web-only"].includes(agent.status),
        `unexpected status: ${agent.status}`
      );
    }
  });
});

describe("agent launcher launch function", () => {
  it("rejects invalid agent id", async () => {
    const result = launchAgent("nonexistent");
    assert.ok(!result.ok, "should fail for unknown agent");
    assert.ok(result.error, "should have error message");
  });

  it("rejects web agent launch", async () => {
    const result = launchAgent("arena");
    assert.ok(!result.ok, "web agent cannot be launched server-side");
    assert.ok(result.error, "should have error message");
  });

  it("rejects docker agent launch", async () => {
    const result = launchAgent("openhands");
    assert.ok(!result.ok, "docker agent cannot be launched server-side");
    assert.ok(result.error, "should have error message");
  });

  it("rejects desktop agent launch", async () => {
    const result = launchAgent("freebuff-desktop");
    assert.ok(!result.ok, "desktop agent cannot be launched server-side");
    assert.ok(result.error, "should have error message");
  });
});
