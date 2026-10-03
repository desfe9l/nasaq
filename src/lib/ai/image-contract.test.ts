import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeImageAnalysis,
  normalizeImageAnalysisInput,
} from "./image-contract.ts";

test("image analysis accepts bounded inline raster data only", () => {
  assert.deepEqual(
    normalizeImageAnalysisInput({
      imageData: `data:image/png;base64,${"A".repeat(40)}`,
      language: "en",
    }),
    {
      imageData: `data:image/png;base64,${"A".repeat(40)}`,
      language: "en",
    },
  );
  assert.equal(
    normalizeImageAnalysisInput({
      imageData: "https://example.com/photo.png",
      language: "ar",
    }),
    null,
  );
  assert.equal(
    normalizeImageAnalysisInput({
      imageData: `data:image/svg+xml;base64,${"A".repeat(40)}`,
      language: "ar",
    }),
    null,
  );
  assert.equal(
    normalizeImageAnalysisInput({
      imageData: `data:image/png;base64,${"A".repeat(2_000_004)}`,
      language: "ar",
    }),
    null,
  );
});

test("image analysis output is bounded and ignores malformed fields", () => {
  const result = normalizeImageAnalysis({
    description: "  اجتماع رسمي  ",
    recognizedText: "  قرار  ",
    objects: [" طاولة ", 2, "", "شخص"],
  });
  assert.deepEqual(result, {
    description: "اجتماع رسمي",
    recognizedText: "قرار",
    objects: ["طاولة", "شخص"],
  });
});
