import { createFileRoute } from "@tanstack/react-router";
import { ImportConvertPage } from "@/components/import/ImportConvertPage";

/**
 * /services/import — «استورد ونسّق»: خدمة الاستيراد والتحويل العامة.
 *
 * سطح منتج أول veřejný (ليس استوديوً للقوالبのみ): يستقبل الزائر دون تسجيل
 * دخول للاستعراض والتعرّف على الصيغ، ويتيح التحويل لذوي الجلسات الموثقة ممن
 * يحملون حق «استيراد البيانات» من التراخيص الحالية (تجريبي، احترافي، مدى
 * الحياة). كل التحويل يمرّ عبر أنبوبة الاستيراد الموحّدة
 * (@/lib/editor/import/run) — لا أنبوبة ثانية، ولا نموذج اشتراك موازٍ.
 */
export const Route = createFileRoute("/services/import")({
  ssr: false,
  head: () => ({
    meta: [{ title: "استورد ونسّق — استيراد وتحويل الملفات | نَسَق NASAQ" }],
  }),
  component: ImportConvertPage,
});
