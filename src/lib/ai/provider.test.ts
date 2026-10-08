import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeImage,
  extractGeminiText,
  generateDesignBrief,
  generateReportDraft,
  parseProviderJson,
  requestGemini,
  transformSelection,
} from "./provider.server.ts";

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

function withEnv(key: string, value: string | undefined) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return () => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  };
}

function geminiResponse(text: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, ...extra }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function geminiErrorResponse(status: number, errorBody: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: errorBody }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Gemini provider reports missing configuration without mocking a response", async () => {
  const restore = withEnv("GEMINI_API_KEY", undefined);
  try {
    await assert.rejects(generateReportDraft(input), /not_configured/);
  } finally {
    restore();
  }
});

test("Gemini provider sends the real server-side request and normalizes JSON", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body || "");
    return geminiResponse(JSON.stringify({
      title: "تقرير",
      summary: "ملخص",
      sections: [{ heading: "النتائج", body: "النص", bullets: [] }],
      nextSteps: [],
    }));
  };
  try {
    const draft = await generateReportDraft(input);
    assert.match(requestBody, /systemInstruction/);
    assert.match(requestBody, /gemini-2\.5-flash|نتائج الربع الثاني/);
    assert.equal(draft.sections[0]?.heading, "النتائج");
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("image analysis sends a validated inline image to Gemini vision", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body || "");
    return geminiResponse(JSON.stringify({ description: "مشهد مكتبي", recognizedText: "قرار", objects: ["طاولة"] }));
  };
  try {
    const result = await analyzeImage({ imageData: `data:image/png;base64,${"A".repeat(40)}`, language: "ar" });
    assert.equal(result.recognizedText, "قرار");
    assert.match(requestBody, /inlineData/);
    assert.match(requestBody, /image\/png|A{40}/);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("HTTP auth and invalid-model failures are differentiated", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  try {
    for (const [status, expected] of [[401, "provider_auth"], [404, "invalid_model"]] as const) {
      globalThis.fetch = async () => new Response("{}", { status });
      await assert.rejects(requestGemini({ system: "x", userParts: [{ text: "x" }], maxOutputTokens: 10 }), new RegExp(expected));
    }
    // 403 with generic body falls back to provider_auth
    globalThis.fetch = async () => new Response("{}", { status: 403 });
    await assert.rejects(requestGemini({ system: "x", userParts: [{ text: "x" }], maxOutputTokens: 10 }), /provider_auth/);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("403 with quota-exhausted body is classified as provider_quota not provider_auth", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => geminiErrorResponse(403, {
      code: 403,
      message: "Quota exhausted for this model",
      status: "PERMISSION_DENIED",
    });
    await assert.rejects(requestGemini({ system: "x", userParts: [{ text: "x" }], maxOutputTokens: 10 }), /provider_quota/);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("403 with billing/prepay exhaustion is classified as provider_billing", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => geminiErrorResponse(403, {
      code: 403,
      message: "Billing account has insufficient funds",
      status: "PERMISSION_DENIED",
    });
    await assert.rejects(requestGemini({ system: "x", userParts: [{ text: "x" }], maxOutputTokens: 10 }), /provider_billing/);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("429 with RESOURCE_EXHAUSTED status is classified as provider_rate", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => geminiErrorResponse(429, {
      code: 429,
      message: "Rate limit exceeded",
      status: "RESOURCE_EXHAUSTED",
    });
    await assert.rejects(requestGemini({ system: "x", userParts: [{ text: "x" }], maxOutputTokens: 10 }), /provider_rate/);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("401 with UNAUTHENTICATED status is classified as provider_auth", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => geminiErrorResponse(401, {
      code: 401,
      message: "API key not valid",
      status: "UNAUTHENTICATED",
    });
    await assert.rejects(requestGemini({ system: "x", userParts: [{ text: "x" }], maxOutputTokens: 10 }), /provider_auth/);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("402 with PAYMENT_REQUIRED is classified as provider_billing", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => geminiErrorResponse(402, {
      code: 402,
      message: "Payment required",
      status: "PAYMENT_REQUIRED",
    });
    await assert.rejects(requestGemini({ system: "x", userParts: [{ text: "x" }], maxOutputTokens: 10 }), /provider_billing/);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("400 with INVALID_ARGUMENT is classified as provider_error", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => geminiErrorResponse(400, {
      code: 400,
      message: "Invalid request",
      status: "INVALID_ARGUMENT",
    });
    await assert.rejects(requestGemini({ system: "x", userParts: [{ text: "x" }], maxOutputTokens: 10 }), /provider_error/);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("404 with NOT_FOUND is classified as invalid_model", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => geminiErrorResponse(404, {
      code: 404,
      message: "Model not found",
      status: "NOT_FOUND",
    });
    await assert.rejects(requestGemini({ system: "x", userParts: [{ text: "x" }], maxOutputTokens: 10 }), /invalid_model/);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("500/503 with INTERNAL/UNAVAILABLE is classified as provider_unavailable", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  try {
    for (const [status, errStatus] of [[500, "INTERNAL"], [503, "UNAVAILABLE"]] as const) {
      globalThis.fetch = async () => geminiErrorResponse(status, {
        code: status,
        message: "Internal error",
        status: errStatus,
      });
      await assert.rejects(requestGemini({ system: "x", userParts: [{ text: "x" }], maxOutputTokens: 10 }), /provider_unavailable/);
    }
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("429 and 5xx retry once, then return a safe provider code", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("busy", { status: 503 });
  };
  try {
    await assert.rejects(requestGemini({ system: "x", userParts: [{ text: "x" }], maxOutputTokens: 10 }), /provider_unavailable/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("provider_quota and provider_billing are permanent (no retry)", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return geminiErrorResponse(403, {
      code: 403,
      message: "Quota exhausted",
      status: "PERMISSION_DENIED",
    });
  };
  try {
    await assert.rejects(requestGemini({ system: "x", userParts: [{ text: "x" }], maxOutputTokens: 10 }), /provider_quota/);
    assert.equal(calls, 1, "provider_quota should not retry");
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("provider_auth is permanent (no retry)", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("{}", { status: 401 });
  };
  try {
    await assert.rejects(requestGemini({ system: "x", userParts: [{ text: "x" }], maxOutputTokens: 10 }), /provider_auth/);
    assert.equal(calls, 1, "provider_auth should not retry");
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("network failure and timeout are not reported as generic provider errors", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error("socket closed"); };
    await assert.rejects(requestGemini({ system: "x", userParts: [{ text: "x" }], maxOutputTokens: 10 }), /provider_unavailable/);

    globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true });
    });
    await assert.rejects(requestGemini({ system: "x", userParts: [{ text: "x" }], maxOutputTokens: 10, timeoutMs: 5 }), /provider_timeout/);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("caller cancellation stops the request and never retries", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
    calls += 1;
    init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    controller.abort();
  });
  try {
    await assert.rejects(requestGemini({ system: "x", userParts: [{ text: "x" }], maxOutputTokens: 10, signal: controller.signal }), /provider_aborted/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("empty candidates and safety blocks are explicit", () => {
  assert.throws(() => extractGeminiText({ candidates: [] }), /provider_empty/);
  assert.throws(() => extractGeminiText({ promptFeedback: { blockReason: "SAFETY" } }), /provider_blocked/);
  assert.throws(() => extractGeminiText({ candidates: [{ finishReason: "SAFETY" }] }), /provider_blocked/);
});

test("JSON parsing accepts fences and surrounding prose but rejects malformed and truncated JSON", () => {
  assert.deepEqual(parseProviderJson("```json\n{\"ok\":true}\n```"), { ok: true });
  assert.deepEqual(parseProviderJson("Here is the result: {\"ok\":true}. Thanks."), { ok: true });
  assert.throws(() => parseProviderJson("{\"ok\":true"), /provider_malformed/);
  assert.throws(() => parseProviderJson("not json"), /provider_malformed/);
});

test("design and selection responses remain contract-normalized and editable", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  const responses = [
    geminiResponse("prose {\"title\":\"عنوان\",\"pages\":99,\"format\":\"bad\"} tail"),
    geminiResponse("```text\n- بند أول | قيمة\n- بند ثان | قيمة\n```") ,
  ];
  globalThis.fetch = async () => responses.shift()!;
  try {
    const design = await generateDesignBrief({ prompt: "خطة", mode: "professional" });
    assert.equal(design.pages, 12);
    assert.equal(design.format, "a4-book");
    assert.equal(design.title, "عنوان");
    const selection = await transformSelection({ action: "table", text: "بيان 1\nبيان 2", instructions: "", language: "ar" });
    assert.match(selection, /بند أول/);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});
test("design brief system prompt enforces anti-monotony rules and the per-page layout contract", async () => {
  const restore = withEnv("GEMINI_API_KEY", "test-server-key");
  const previousFetch = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body || "");
    return geminiResponse(JSON.stringify({ title: "عنوان", pages: 3 }));
  };
  try {
    const brief = await generateDesignBrief({ prompt: "تقرير رسمي", mode: "professional" });
    // Anti-Monotony & Dynamic Layout Rules are part of the system prompt.
    assert.ok(requestBody.includes("ANTI-MONOTONY"), "system prompt must carry the anti-monotony rules");
    assert.ok(requestBody.includes("pageLayouts"), "system prompt must require per-page layout directives");
    assert.ok(requestBody.includes("hero-cover"), "page 1 must be a hero cover");
    assert.ok(requestBody.includes("asymmetric"), "asymmetric grids must be offered");
    assert.ok(requestBody.includes("multi-column"), "multi-column cards must be offered");
    assert.ok(requestBody.includes("60-30-10"), "the 60-30-10 palette rule must be stated");
    assert.ok(requestBody.includes("Never return the same layout pattern for two consecutive pages"));
    // The normalized brief carries one directive per page, hero cover first,
    // and no two consecutive pages share a pattern.
    assert.equal(brief.pageLayouts.length, 3);
    assert.equal(brief.pageLayouts[0].pattern, "hero-cover");
    assert.notEqual(brief.pageLayouts[1].pattern, brief.pageLayouts[2].pattern);
    for (const directive of brief.pageLayouts) {
      assert.ok([1, 2, 3].includes(directive.columns));
      assert.ok(directive.visualHierarchy.length > 0);
      assert.ok(directive.accentCards >= 0 && directive.accentCards <= 3);
    }
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});
