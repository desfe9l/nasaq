#!/usr/bin/env node
/**
 * AI server-function E2E — the two guarantees the editor AI tools depend on:
 *
 *   1. SIGNED OUT, every AI server function refuses the call with a real **401**
 *      and a stable `Unauthorized` message — not a 500 crash, and never a
 *      provider call. This is the guard that keeps Gemini (and the licence
 *      lookup) off the anonymous path.
 *   2. SIGNED IN, the call reaches the handler: either it returns a draft
 *      (`ok: true`, provider configured) or it fails in the typed, Arabic,
 *      diagnosable way the panels render (`ok: false` + `code`). An
 *      unconfigured environment must say `not_configured` — never a success
 *      shape, which would be the "fake result" failure mode.
 *
 * Wire format: TanStack Start server functions are `POST /_serverFn/<id>` with a
 * seroval-encoded `{ data }` body and `x-tsr-serverFn: true`. The ids are read
 * from the dev server's transformed client modules (`createClientRpc("…")`),
 * which is why this script talks to a running `npm run dev`; pass
 * `--ids=<file.json>` when checking a build whose client bundle you already
 * extracted ids from.
 *
 * Usage:
 *   node scripts/ai-e2e.mjs                 # http://127.0.0.1:8080
 *   AI_E2E_BASE=http://127.0.0.1:8080 node scripts/ai-e2e.mjs
 *   node scripts/ai-e2e.mjs --base=http://127.0.0.1:8080 --ids=ids.json
 *
 * Exit codes: 0 = every step passed, 1 = a step failed, 2 = server unreachable.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { toJSON } = require("seroval");

const argBase = process.argv.find((a) => a.startsWith("--base="));
const argIds = process.argv.find((a) => a.startsWith("--ids="));
const BASE = (argBase?.slice("--base=".length) || process.env.AI_E2E_BASE || "http://127.0.0.1:8080").replace(/\/$/, "");
const MODULES = ["/src/lib/ai/functions.ts", "/src/lib/ai/image-functions.ts"];
/** The functions this suite exercises, by export name in their source module. */
const FUNCTIONS_OF_INTEREST = [
  "generateReportDraftFn",
  "generateDesignBriefFn",
  "transformSelectionFn",
  "analyzeImageFn",
];

/** Provider-configured call input: the full `ReportDraftInput` contract. */
const REPORT_INPUT = {
  brief: "تقرير عن أداء الفريق الربع سنوي وأثره على خطة التحول الرقمي",
  audience: "الإدارة التنفيذية",
  tone: "official",
  language: "ar",
  maxSections: 4,
  reportType: "executive",
  detailLevel: "standard",
  pageTarget: 1,
  documentTitle: "تقرير الأداء الربع سنوي",
  documentContext: "",
};

let failures = 0;
let checks = 0;
const log = (...args) => console.log(...args);
const pass = (label) => {
  checks += 1;
  log(`  ok   ${label}`);
};
const fail = (label, detail) => {
  failures += 1;
  checks += 1;
  log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
};

/** Decode the base64 `{"file","export"}` id TanStack Start bakes into the client. */
function decodeFunctionId(id) {
  try {
    const parsed = JSON.parse(Buffer.from(id, "base64").toString("utf8"));
    const exportName = String(parsed.export ?? "");
    return { exportName: exportName.replace(/_createServerFn_handler$/, ""), file: parsed.file };
  } catch {
    return null;
  }
}

async function idsFromDevServer() {
  const found = new Map();
  for (const modulePath of MODULES) {
    const response = await fetch(`${BASE}${modulePath}`, { headers: { accept: "text/javascript" } });
    if (!response.ok) throw new Error(`${modulePath} → HTTP ${response.status}`);
    const source = await response.text();
    for (const match of source.matchAll(/createClientRpc\("([^"]+)"\)/g)) {
      const decoded = decodeFunctionId(match[1]);
      if (decoded) found.set(decoded.exportName, match[1]);
    }
  }
  return found;
}

async function callServerFn(id, data, cookies = []) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    "x-tsr-serverFn": "true",
    origin: BASE,
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
  };
  if (cookies.length) headers.cookie = cookies.join("; ");
  const response = await fetch(`${BASE}/_serverFn/${id}`, {
    method: "POST",
    headers,
    body: JSON.stringify(toJSON({ data })),
  });
  const setCookies = response.headers.getSetCookie?.() ?? [];
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    /* non-JSON body: keep the raw text for the failure detail */
  }
  return { status: response.status, setCookies, payload, text };
}

/**
 * Decode a TanStack Start response payload. Success bodies deserialize to
 * `{result}`; thrown errors arrive as a serialized `$TSR/Error` with the
 * original message. Returns `{ value, errorMessage }` and never throws.
 */
function decodeResponse(payload) {
  if (!payload || typeof payload !== "object") return { value: payload, errorMessage: "" };
  try {
    const { fromCrossJSON } = require("seroval");
    const value = fromCrossJSON(payload, { refs: new Map(), plugins: [] });
    if (value?.error instanceof Error) return { value, errorMessage: value.error.message };
    if (value?.error && typeof value.error.message === "string") {
      return { value, errorMessage: value.error.message };
    }
    return { value, errorMessage: "" };
  } catch {
    // Fallback: the `$TSR/Error` class reference needs the client's seroval
    // plugins to rebuild, but the wire JSON is still readable. A serialized
    // string is `{t:1,s:"…"}`, and an Error carries `{message:{t:1,s:"…"}}`.
    const seen = new Set();
    const walk = (value, depth) => {
      if (depth > 8 || value === null || typeof value !== "object" || seen.has(value)) return "";
      seen.add(value);
      const message = value.message;
      if (typeof message === "string") return message;
      if (message && typeof message === "object" && typeof message.s === "string") return message.s;
      for (const entry of Object.values(value)) {
        const found = walk(entry, depth + 1);
        if (found) return found;
      }
      return "";
    };
    return { value: payload, errorMessage: walk(payload, 0) };
  }
}

async function signUp() {
  const email = `ai-e2e-${Date.now().toString(36)}@example.com`;
  const response = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, password: "E2e-Password-12345", name: "مستخدم اختبار" }),
  });
  const cookies = (response.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
  if (!response.ok || cookies.length === 0) {
    throw new Error(`sign-up failed: HTTP ${response.status} ${await response.text()}`);
  }
  return { email, cookies };
}

async function main() {
  log(`[ai-e2e] base ${BASE}`);

  // --- resolve the server-function ids -------------------------------------
  let ids;
  if (argIds) {
    const file = JSON.parse(await (await import("node:fs/promises")).readFile(argIds.slice("--ids=".length), "utf8"));
    ids = new Map(Object.entries(file));
    log(`[ai-e2e] ids from ${argIds.slice("--ids=".length)} (${ids.size})`);
  } else {
    try {
      ids = await idsFromDevServer();
    } catch (error) {
      log(`[ai-e2e] cannot read the server-function ids: ${error.message}`);
      log("[ai-e2e] start `npm run dev` first, or pass --ids=<file.json>.");
      return 2;
    }
  }
  const missing = FUNCTIONS_OF_INTEREST.filter((name) => !ids.has(name));
  log(`[ai-e2e] found ${ids.size} functions${missing.length ? `, missing: ${missing.join(", ")}` : ""}`);
  if (missing.length) {
    fail("every expected AI server function is registered", `missing ${missing.join(", ")}`);
  }

  const reportId = ids.get("generateReportDraftFn");
  const imageId = ids.get("analyzeImageFn");

  // --- 1. signed out: 401, no provider call --------------------------------
  log("[ai-e2e] 1. signed out → the AI route must answer 401");
  if (!reportId) {
    fail("generateReportDraftFn has a server-function id");
  } else {
    const anon = await callServerFn(reportId, REPORT_INPUT);
    if (anon.status === 401) pass("report draft without a session → HTTP 401");
    else fail("report draft without a session → HTTP 401", `got HTTP ${anon.status}: ${anon.text.slice(0, 200)}`);
    const message = decodeResponse(anon.payload).errorMessage;
    if (/unauthorized/i.test(message)) pass(`rejection carries the stable message ("${message}")`);
    else fail("rejection carries the stable message", `got "${message}"`);
  }

  if (!imageId) {
    fail("analyzeImageFn has a server-function id");
  } else {
    const anon = await callServerFn(imageId, {
      imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      instruction: "استخرج النص",
      language: "ar",
    });
    if (anon.status === 401) pass("image analysis without a session → HTTP 401");
    else fail("image analysis without a session → HTTP 401", `got HTTP ${anon.status}: ${anon.text.slice(0, 200)}`);
  }

  // --- 2. signed in: the handler runs, and answers honestly ----------------
  log("[ai-e2e] 2. signed in → the handler must run and answer honestly");
  let account;
  try {
    account = await signUp();
    pass(`account created (${account.email})`);
  } catch (error) {
    fail("account created", error.message);
    return 1;
  }

  if (reportId) {
    const authed = await callServerFn(reportId, REPORT_INPUT, account.cookies);
    const decoded = decodeResponse(authed.payload);
    if (authed.status === 401 || authed.status === 403) {
      fail("authenticated report draft is not refused by the guard", `got HTTP ${authed.status}`);
    } else if (authed.status !== 200) {
      fail(
        "authenticated report draft → HTTP 200",
        `got HTTP ${authed.status}: ${decoded.errorMessage || authed.text.slice(0, 200)}`,
      );
    } else if (decoded.value?.result?.ok === true) {
      // Provider configured in this environment — the real contract must hold.
      const draft = decoded.value.result.draft;
      const sections = Array.isArray(draft?.sections) ? draft.sections : [];
      if (typeof draft?.title === "string" && draft.title.trim() && sections.length > 0) {
        pass(`real draft returned (${sections.length} sections) — provider is configured`);
      } else {
        fail("real draft has a title and at least one section", JSON.stringify(decoded.value).slice(0, 300));
      }
    } else if (typeof decoded.value?.result?.code === "string") {
      // No provider yet / licence / quota: must be a typed, Arabic, honest error.
      const code = decoded.value.result.code;
      const honest = ["not_configured", "license_required", "rate_limited", "invalid", "provider_error"].includes(code);
      if (honest && typeof decoded.value.result.message === "string" && decoded.value.result.message.trim()) {
        pass(`typed failure surfaced (code=${code}) — no fake success`);
      } else {
        fail("authenticated failure is typed and readable", JSON.stringify(decoded.value).slice(0, 300));
      }
      if (code === "not_configured") {
        log("       note: GEMINI_API_KEY is not set in this environment — the provider call was skipped by design.");
      }
    } else {
      fail("authenticated report draft answers with a typed result", JSON.stringify(decoded.value).slice(0, 300));
    }
  }

  log(`[ai-e2e] ${failures === 0 ? "all" : ""} ${checks - failures}/${checks} checks passed`.trim());
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[ai-e2e] unexpected failure: ${error?.stack ?? error}`);
    process.exit(2);
  });
