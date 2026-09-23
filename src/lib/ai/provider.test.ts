import assert from "node:assert/strict";
import test from "node:test";
import { generateReportDraft } from "./provider.server.ts";

const input = {
  brief: "نتائج الربع الثاني والتحديات",
  audience: "الإدارة",
  tone: "official" as const,
  language: "ar" as const,
  maxSections: 3,
  reportType: "performance" as const,
  detailLevel: "standard" as const,
  pageTarget: 1,
};

test("xAI provider reports missing configuration without mocking a response", async () => {
  const previous = process.env.XAI_API_KEY;
  delete process.env.XAI_API_KEY;
  await assert.rejects(generateReportDraft(input), /not_configured/);
  if (previous === undefined) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = previous;
});

test("xAI provider sends the real server-side request and normalizes JSON", async () => {
  const previousKey = process.env.XAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.XAI_API_KEY = "test-server-key";
  let authorization = "";
  globalThis.fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "تقرير",
                summary: "ملخص",
                sections: [{ heading: "النتائج", body: "النص", bullets: [] }],
                nextSteps: [],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const draft = await generateReportDraft(input);
    assert.equal(authorization, "Bearer test-server-key");
    assert.equal(draft.sections[0]?.heading, "النتائج");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = previousKey;
  }
});
