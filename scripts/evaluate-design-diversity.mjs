/** Real-provider evaluation only. No fetch stubs, fake key, or local fallback.
 * Run: node --experimental-strip-types --import ./scripts/app-alias-register.mjs scripts/evaluate-design-diversity.mjs
 * Emits geometry metrics, never prompts with private data, provider text, or credentials.
 */
import { generateDesignBrief } from "../src/lib/ai/provider.server.ts";
import { executeDesignTwin } from "../src/lib/ai/design-twin.ts";
import { pageFingerprint } from "../src/lib/intelligence/layout-variety.ts";

const cases = [
  [
    "annual-report",
    "تقرير سنوي عن الاستدامة: عنوان أعلى اليمين ومساحة بيانات في عمود جانبي، لا تخترع أرقاماً.",
  ],
  [
    "exhibition",
    "دعوة معرض فنون: عنوان كبير في أسفل الصفحة ومساحة بيضاء واسعة أعلى الصفحة وتفاصيل الموعد كحقول فارغة.",
  ],
  [
    "greeting",
    "بطاقة تهنئة هادئة: عبارة في وسط الصفحة وتكوين هندسي خفيف بعيد عن الحواف، بلا غلاف تقرير.",
  ],
  [
    "executive",
    "موجز تنفيذي: نص القرار في عمود عريض على اليمين وشريط أولويات رأسي على اليسار، بلا صورة وسطية.",
  ],
  [
    "workshop",
    "ملصق ورشة كتابة: عنوان عريض ثم ثلاث مناطق متدرجة لمسار التعلم، مع حقول فارغة للموعد والمكان.",
  ],
];
const rows = [];
for (const [id, prompt] of cases) {
  try {
    const modelSink = { model: "" };
    const brief = await generateDesignBrief(
      { prompt, mode: "professional", requestedPages: 1 },
      {
        memoryNotes:
          "Prefer Arabic typography and generous whitespace. Preserve these preferences, not a fixed layout.",
        modelSink,
      },
    );
    const delivery = executeDesignTwin({ prompt, geminiBrief: brief });
    rows.push({
      id,
      status: "evaluated",
      model: modelSink.model,
      fingerprint: pageFingerprint(delivery.project.pages[0]),
      elements: delivery.project.pages[0].elements.map(
        ({ type, x, y, w, h }) => ({ type, x, y, w, h }),
      ),
      metrics: delivery.metrics,
    });
  } catch (error) {
    const known = new Set([
      "not_configured",
      "provider_error",
      "provider_auth",
      "provider_rate",
      "provider_quota",
      "provider_billing",
      "invalid_model",
      "invalid_composition",
    ]);
    rows.push({
      id,
      status: "blocked",
      reason: known.has(error.message)
        ? error.message
        : "provider_request_failed",
    });
  }
}
const evaluated = rows.filter((r) => r.status === "evaluated");
const distinct = new Set(evaluated.map((r) => r.fingerprint)).size;
console.log(
  JSON.stringify(
    {
      rows,
      distinctCompositions: distinct,
      passed:
        evaluated.length === 5 &&
        distinct === 5 &&
        evaluated.every((r) => r.metrics.valid && r.metrics.unresolved === 0),
    },
    null,
    2,
  ),
);
if (
  evaluated.length !== 5 ||
  distinct !== 5 ||
  evaluated.some((r) => !r.metrics.valid || r.metrics.unresolved)
)
  process.exitCode = 1;
