import assert from "node:assert/strict";
import test from "node:test";
import { analyzeImage, generateReportDraft } from "./provider.server.ts";

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

test("Gemini provider reports missing configuration without mocking a response", async () => {
  const previous = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(generateReportDraft(input), /not_configured/);
  if (previous === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previous;
});

test("Gemini provider sends the real server-side request and normalizes JSON", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-server-key";
  let requestBody = "";
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body || "");
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          title: "تقرير",
          summary: "ملخص",
          sections: [{ heading: "النتائج", body: "النص", bullets: [] }],
          nextSteps: [],
        }) }] } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const draft = await generateReportDraft(input);
    assert.match(requestBody, /systemInstruction/);
    assert.match(requestBody, /gemini-2\.5-flash|نتائج الربع الثاني/);
    assert.equal(draft.sections[0]?.heading, "النتائج");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test("image analysis sends the inline image to Gemini vision", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-server-key";
  let requestBody = "";
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body || "");
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          description: "مشهد مكتبي",
          recognizedText: "قرار",
          objects: ["طاولة"],
        }) }] } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const imageData = `data:image/png;base64,${"A".repeat(40)}`;
    const result = await analyzeImage({ imageData, language: "ar" });
    assert.equal(result.recognizedText, "قرار");
    assert.match(requestBody, /inlineData/);
    assert.match(requestBody, /data:image\/png|A{40}/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});
