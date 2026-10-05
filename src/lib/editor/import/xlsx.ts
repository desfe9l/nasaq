/**
 * XLSX workbook → one editable NASAQ page per worksheet.
 *
 * NASAQ's native spreadsheet capability is a structured table, not a formula
 * engine. Worksheets therefore become native table objects (never screenshots);
 * the workbook order, sheet names, values, gaps and page-sized canvas survive.
 */

import { ImportBuilder } from "./shared";
import { parseXlsxWorkbook } from "../sheet-import";

export async function importXlsxBytes(
  bytes: Uint8Array,
  fileName: string,
  ids?: () => string,
): Promise<ReturnType<ImportBuilder["finish"]>> {
  const sheets = await parseXlsxWorkbook(bytes, fileName);
  const builder = new ImportBuilder("xlsx", fileName, ids);
  builder.note(
    "Excel",
    "partial",
    "كل ورقة عمل أصبحت صفحة بجدول نَسَق قابل للتحرير. صيغ الحسابات والتنسيق الخاص بالخلايا غير متاح في نموذج الجداول الحالي.",
  );
  for (const sheet of sheets) {
    // A workbook has no print size until the author chooses one. Start with a
    // readable landscape sheet and extend the artboard for long data tables.
    const rows = Math.max(1, sheet.rows.length);
    const cols = Math.max(1, sheet.cols);
    const width = Math.min(420, Math.max(210, 28 + cols * 17));
    const height = Math.min(8_000, Math.max(210, 32 + rows * 8));
    const page = builder.addPage(sheet.label || `ورقة ${builder.pages.length + 1}`, width, height);
    if (sheet.hidden) page.hidden = true;
    if (sheet.rows.length) {
      builder.table(
        page,
        { x: 12, y: 12, w: width - 24, h: Math.min(height - 24, Math.max(12, rows * 8)) },
        sheet.rows,
        sheet.label || "جدول Excel",
      );
    } else {
      builder.note(sheet.label || "ورقة عمل", "partial", "الورقة فارغة؛ أُنشئت صفحة بالمقاس المناسب ويمكن تحريرها في المحرر.");
    }
    if (sheet.rows.length >= 400 || sheet.cols >= 60) {
      builder.note(sheet.label || "ورقة عمل", "partial", "اقتصر الاستخراج على حد الجداول الحالي: ٤٠٠ صف و٦٠ عمودًا.");
    }
    if (sheet.hidden) {
      builder.note(sheet.label || "ورقة مخفية", "partial", "حُفظت حالة إخفاء ورقة العمل كصفحة مخفية في المستند.");
    }
  }
  return builder.finish();
}
