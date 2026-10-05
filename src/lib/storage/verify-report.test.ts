import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { storageVerifyView, type StorageVerifyResultInput } from "./verify-report.ts";

function readyResult(): StorageVerifyResultInput {
  return {
    ok: true,
    configured: true,
    report: {
      configured: true,
      provider: "cloudflare-r2",
      bucketDefault: true,
      endpointSource: "R2_ACCOUNT_ID",
      missingVariables: [],
      steps: [
        { step: "configured", ok: true, detail: "cloudflare-r2" },
        { step: "upload", ok: true, detail: "bytes=24" },
        { step: "signed-url-read", ok: true, detail: "status=200 bytes=24 exact=true" },
        { step: "read", ok: true, detail: "bytes=24 exact=true" },
        { step: "delete", ok: true, detail: "gone=true" },
      ],
      ok: true,
    },
    metadata: {
      ok: true,
      steps: [
        { step: "db-tables", ok: true },
        { step: "db-metadata-insert+read", ok: true },
        { step: "db-metadata-delete", ok: true },
      ],
    },
  };
}

describe("storageVerifyView", () => {
  it("reports ready only when BOTH the object round trip and the metadata half pass", () => {
    const view = storageVerifyView(readyResult());
    assert.equal(view.state, "ready");
    assert.equal(view.rows.length, 8);
    assert.ok(view.headline.includes("الدورة الكاملة نجحت"));
    assert.deepEqual(view.missingVariables, []);
  });

  it("fails closed when any step failed, even if the object round trip passed", () => {
    const result = readyResult();
    if (result.ok) {
      result.metadata = { ...result.metadata, ok: false, steps: [...result.metadata.steps, { step: "db-metadata-delete", ok: false }] };
    }
    const view = storageVerifyView(result);
    assert.equal(view.state, "failed");
    assert.equal(view.rows.at(-1)?.ok, false);
  });

  it("also fails when a report step failed but metadata passed", () => {
    const result = readyResult();
    if (result.ok) {
      result.report = {
        ...result.report,
        ok: false,
        steps: result.report.steps.map((step) =>
          step.step === "signed-url-read" ? { ...step, ok: false, detail: "status=403" } : step,
        ),
      };
    }
    const view = storageVerifyView(result);
    assert.equal(view.state, "failed");
    const failed = view.rows.find((row) => row.key === "signed-url-read");
    assert.equal(failed?.ok, false);
    assert.equal(failed?.label, "قراءة عبر رابط موقّع");
  });

  it("surfaces the missing variable NAMES (never values) when storage is not configured", () => {
    const view = storageVerifyView({
      ok: false,
      reason: "not_configured",
      missingVariables: ["R2_ACCOUNT_ID (or a valid R2_ENDPOINT)", "R2_ACCESS_KEY_ID"],
    });
    assert.equal(view.state, "not_configured");
    assert.deepEqual(view.missingVariables, [
      "R2_ACCOUNT_ID (or a valid R2_ENDPOINT)",
      "R2_ACCESS_KEY_ID",
    ]);
    assert.deepEqual(view.rows, []);
  });

  it("keeps unknown failure reasons non-ready without inventing missing variables", () => {
    const view = storageVerifyView({ ok: false, reason: "forbidden" });
    assert.equal(view.state, "not_configured");
    assert.deepEqual(view.missingVariables, []);
    assert.ok(view.headline.includes("forbidden"));
  });

  it("labels every known step id in Arabic and falls back to the raw id for unknown ones", () => {
    const result = readyResult();
    if (result.ok) {
      result.report = {
        ...result.report,
        steps: [...result.report.steps, { step: "future-step", ok: true }],
      };
    }
    const view = storageVerifyView(result);
    const labels = Object.fromEntries(view.rows.map((row) => [row.key, row.label]));
    assert.equal(labels["upload"], "الرفع (PUT)");
    assert.equal(labels["delete"], "الحذف والتحقق من الاختفاء");
    assert.equal(labels["db-tables"], "جداول قاعدة البيانات");
    assert.equal(labels["future-step"], "future-step");
  });

  it("describes the bucket source and endpoint source without ever echoing values", () => {
    const result = readyResult();
    if (result.ok) {
      result.report = {
        ...result.report,
        bucketDefault: false,
        endpointSource: "R2_ENDPOINT",
      };
    }
    const view = storageVerifyView(result);
    const summary = Object.fromEntries(view.summary.map((chip) => [chip.label, chip.value]));
    assert.equal(summary["الـ endpoint"], "من R2_ENDPOINT (صريح)");
    assert.equal(summary["الحاوية"], "اسم مضبوط عبر R2_BUCKET_NAME");

    const defaulted = storageVerifyView(readyResult());
    const defaultSummary = Object.fromEntries(
      defaulted.summary.map((chip) => [chip.label, chip.value]),
    );
    assert.equal(defaultSummary["الحاوية"], "nasaq-sa (الافتراضي في الكود)");
    assert.equal(defaultSummary["المزوّد"], "cloudflare-r2");
  });
});
